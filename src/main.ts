import { Notice, Plugin } from "obsidian";
import { InoreaderAPI } from "./api";
import { SyncEngine } from "./sync";
import { OAuthTokens } from "./types";
import {
	InoreaderSyncSettings,
	DEFAULT_SETTINGS,
	InoreaderSyncSettingTab,
} from "./settings";
import { loadSecrets, saveSecrets } from "./secrets";

const REDIRECT_URI = "obsidian://inoreader-sync-auth";

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

		// OAuth protocol handler
		this.registerObsidianProtocolHandler(
			"inoreader-sync-auth",
			async (params) => {
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
					const tokens = await this.api.exchangeCode(code, REDIRECT_URI);
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
		this.oauthState = Math.random().toString(36).substring(2, 15);
		const authUrl = this.api.getAuthUrl(REDIRECT_URI, this.oauthState);
		window.open(authUrl);
		new Notice("Opening browser for Inoreader authentication...");
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
