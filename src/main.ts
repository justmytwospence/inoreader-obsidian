import { Notice, Platform, Plugin } from "obsidian";
import { InoreaderAPI } from "./api";
import { SyncEngine } from "./sync";
import { OAuthTokens } from "./types";
import {
	InoreaderSyncSettings,
	DEFAULT_SETTINGS,
	InoreaderSyncSettingTab,
} from "./settings";
import { loadSecrets, saveSecrets } from "./secrets";
import { OAuthCallbackServer } from "./oauth-server";
import { OAuthPasteModal } from "./oauth-paste-modal";

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

function parseLocalhostPort(redirectUri: string): number | null {
	let url: URL;
	try {
		url = new URL(redirectUri);
	} catch {
		return null;
	}
	if (url.protocol !== "http:") return null;
	if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
	const port = parseInt(url.port, 10);
	if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
	return port;
}

// A "bouncer" URL is one whose page is responsible for issuing the
// obsidian:// navigation itself. Recognised hosts are this project's
// GitHub Pages site and any user-owned fork on github.io. For these,
// the plugin just opens the browser; the page handles the bounce
// and the protocol handler completes the flow.
function isKnownBouncerUrl(redirectUri: string): boolean {
	let url: URL;
	try {
		url = new URL(redirectUri);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	return (
		url.hostname.endsWith(".github.io") &&
		url.pathname.startsWith("/inoreader-obsidian/")
	);
}

type LegacySettings = Partial<InoreaderSyncSettings> & {
	// Pre-0.18 fields that lived in data.json before secrets moved to localStorage.
	clientSecret?: string;
	accessToken?: string;
	refreshToken?: string;
	tokenExpiresAt?: number;
	// Pre-0.17 source-selection fields.
	syncAnnotations?: boolean;
	syncTags?: string[];
	syncTagsEnabled?: boolean;
	periodicNoteTag?: string;
	syncTag?: string;
	syncSource?: "annotated" | "tagged";
};

export default class InoreaderSyncPlugin extends Plugin {
	settings: InoreaderSyncSettings;
	api: InoreaderAPI;
	syncEngine: SyncEngine;
	private syncIntervalId: number | null = null;
	private oauthState: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.initApi();

		this.addSettingTab(new InoreaderSyncSettingTab(this.app, this));

		// OAuth protocol handler (used when the redirect URI is obsidian://…,
		// e.g. for users who registered the legacy custom-scheme URI with
		// their Inoreader app and chose to keep using it).
		this.registerObsidianProtocolHandler(
			"inoreader-sync-auth",
			(params) => {
				void this.handleOAuthCallback({
					code: params.code ?? "",
					state: params.state ?? "",
				});
			},
		);

		// Commands
		this.addCommand({
			id: "sync",
			name: "Sync",
			callback: () => this.runSync(false),
		});

		this.addCommand({
			id: "full-resync",
			name: "Full resync",
			callback: () => this.runSync(true),
		});

		this.addCommand({
			id: "connect",
			name: "Connect",
			callback: () => this.startOAuthFlow(),
		});

		this.addCommand({
			id: "disconnect",
			name: "Disconnect",
			callback: () => this.disconnect(),
		});

		// Ribbon icon
		this.addRibbonIcon("rss", "Sync", () => {
			void this.runSync(false);
		});

		// Auto sync
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup && this.settings.isConnected) {
				this.registerInterval(
					window.setTimeout(() => void this.runSync(false), 5000),
				);
			}
			this.setupSyncInterval();
		});
	}

	onunload(): void {
		this.clearSyncInterval();
	}

	// --- API Initialization ---

	private initApi(): void {
		const secrets = loadSecrets(this.app);
		this.api = new InoreaderAPI(
			this.settings.clientId,
			secrets.clientSecret,
			{
				accessToken: secrets.accessToken,
				refreshToken: secrets.refreshToken,
				expiresAt: secrets.tokenExpiresAt,
			},
			(tokens: OAuthTokens) => {
				saveSecrets(this.app, {
					accessToken: tokens.accessToken,
					refreshToken: tokens.refreshToken,
					tokenExpiresAt: tokens.expiresAt,
				});
			},
		);
		this.syncEngine = new SyncEngine(
			this.app,
			this.api,
			this.settings,
			() => this.saveSettings(),
		);
	}

	// --- Sync ---

	async runSync(fullResync: boolean): Promise<void> {
		if (!this.settings.isConnected) {
			new Notice("Not connected to Inoreader. Configure in settings.");
			return;
		}
		if (!this.settings.clientId || !loadSecrets(this.app).clientSecret) {
			new Notice("Inoreader client ID and secret required. Configure in settings.");
			return;
		}
		try {
			await this.syncEngine.sync(fullResync);
		} catch (e) {
			console.error("Inoreader sync error:", e);
			new Notice("Sync failed: " + (e as Error).message);
		}
	}

	// --- OAuth ---

	startOAuthFlow(): void {
		if (!this.settings.clientId || !loadSecrets(this.app).clientSecret) {
			new Notice("Enter Inoreader client ID and secret first in settings.");
			return;
		}
		const redirectUri = this.settings.redirectUri;
		if (!redirectUri) {
			new Notice("Redirect URI is empty. Set it in plugin settings.");
			return;
		}
		this.oauthState = Math.random().toString(36).substring(2, 15);
		const authUrl = this.api.getAuthUrl(redirectUri, this.oauthState);

		// Four callback mechanisms depending on the configured redirect URI:
		//   obsidian://…              — Obsidian protocol handler picks it up directly.
		//   https://…bouncer pattern  — HTTPS page on Pages bounces to obsidian://;
		//                               protocol handler picks it up.
		//   http://127.0.0.1:PORT     — desktop: localhost HTTP server captures the
		//                               callback; mobile: paste modal (no server on mobile).
		//   anything else (https://…) — paste modal: user authenticates in browser,
		//                               pastes the redirect URL back into Obsidian.
		if (redirectUri.startsWith("obsidian://") || isKnownBouncerUrl(redirectUri)) {
			window.open(authUrl);
			new Notice("Opening browser for Inoreader authentication...");
			return;
		}

		const localhostPort = parseLocalhostPort(redirectUri);
		if (localhostPort !== null) {
			if (Platform.isDesktop) {
				void this.runLocalhostFlow(localhostPort, authUrl);
				return;
			}
			// Mobile can't run a server; fall through to paste flow.
		}

		this.runPasteFlow(authUrl);
	}

	private async runLocalhostFlow(port: number, authUrl: string): Promise<void> {
		const server = new OAuthCallbackServer();
		const waitForCallback = server.listen(port, OAUTH_TIMEOUT_MS);
		window.open(authUrl);
		new Notice("Opening browser for Inoreader authentication...");
		try {
			const result = await waitForCallback;
			await this.handleOAuthCallback(result);
		} catch (e) {
			server.stop();
			console.error("Inoreader OAuth error:", e);
			new Notice("Authentication failed: " + (e as Error).message);
		}
	}

	private runPasteFlow(authUrl: string): void {
		window.open(authUrl);
		new Notice("Authenticate in your browser, then paste the redirect URL.");
		new OAuthPasteModal(
			this.app,
			(result) => {
				void this.handleOAuthCallback(result);
			},
			() => {
				new Notice("Authentication cancelled.");
			},
		).open();
	}

	private async handleOAuthCallback(params: { code: string; state: string }): Promise<void> {
		const { code, state } = params;
		if (!code) {
			new Notice("No authorization code received from Inoreader");
			return;
		}
		if (state !== this.oauthState) {
			new Notice("Authentication failed (state mismatch)");
			return;
		}
		try {
			const tokens = await this.api.exchangeCode(code, this.settings.redirectUri);
			saveSecrets(this.app, {
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				tokenExpiresAt: tokens.expiresAt,
			});
			this.settings.isConnected = true;
			await this.saveSettings();
			new Notice("Connected to Inoreader");
		} catch (e) {
			console.error("Inoreader OAuth error:", e);
			new Notice("Authentication failed: " + (e as Error).message);
		}
	}

	disconnect(): void {
		saveSecrets(this.app, { accessToken: "", refreshToken: "", tokenExpiresAt: 0 });
		this.settings.isConnected = false;
		this.api.updateTokens({ accessToken: "", refreshToken: "", expiresAt: 0 });
		void this.saveSettings();
		this.clearSyncInterval();
		new Notice("Disconnected from Inoreader");
	}

	// --- Sync Interval ---

	setupSyncInterval(): void {
		this.clearSyncInterval();
		if (this.settings.syncIntervalMinutes > 0 && this.settings.isConnected) {
			const ms = this.settings.syncIntervalMinutes * 60 * 1000;
			this.syncIntervalId = window.setInterval(() => void this.runSync(false), ms);
			this.registerInterval(this.syncIntervalId);
		}
	}

	private clearSyncInterval(): void {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	// --- Settings ---

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as LegacySettings | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		if (loaded) {
			// Migrate pre-0.18.0: secrets moved from data.json to localStorage.
			const legacySecrets: Parameters<typeof saveSecrets>[1] = {};
			if (typeof loaded.clientSecret === "string" && loaded.clientSecret) legacySecrets.clientSecret = loaded.clientSecret;
			if (typeof loaded.accessToken === "string" && loaded.accessToken) legacySecrets.accessToken = loaded.accessToken;
			if (typeof loaded.refreshToken === "string" && loaded.refreshToken) legacySecrets.refreshToken = loaded.refreshToken;
			if (typeof loaded.tokenExpiresAt === "number" && loaded.tokenExpiresAt) legacySecrets.tokenExpiresAt = loaded.tokenExpiresAt;
			if (Object.keys(legacySecrets).length > 0) {
				saveSecrets(this.app, legacySecrets);
				await this.saveData(this.settings);
			}

			// Migrate pre-0.17.0: global source settings → per-output source settings
			if (loaded.syncAnnotations !== undefined && loaded.articleFilesIncludeAnnotations === undefined) {
				this.settings.articleFilesEnabled = true;
				this.settings.articleFilesIncludeAnnotations = loaded.syncAnnotations;
			}
			if (loaded.syncTags !== undefined && loaded.articleFilesTags === undefined) {
				this.settings.articleFilesTags = loaded.syncTagsEnabled ? loaded.syncTags : [];
			}
			if (loaded.periodicNoteTag !== undefined && loaded.periodicNoteTags === undefined) {
				this.settings.periodicNoteTags = loaded.periodicNoteTag ? [loaded.periodicNoteTag] : [];
			}

			// Migrate pre-0.9.0: syncTag → articleFilesTags
			if (typeof loaded.syncTag === "string" && loaded.syncTag.trim()) {
				if (this.settings.articleFilesTags.length === 0) {
					this.settings.articleFilesTags = [loaded.syncTag.trim()];
				}
			}
			// Migrate pre-0.9.0: syncSource → articleFilesIncludeAnnotations
			if (loaded.syncSource === "annotated") {
				this.settings.articleFilesIncludeAnnotations = true;
			} else if (loaded.syncSource === "tagged") {
				this.settings.articleFilesIncludeAnnotations = false;
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
