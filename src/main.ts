import { Notice, Plugin } from "obsidian";
import { InoreaderAPI } from "./api";
import { SyncEngine } from "./sync";
import { OAuthTokens } from "./types";
import {
	InoreaderSyncSettings,
	DEFAULT_SETTINGS,
	InoreaderSyncSettingTab,
} from "./settings";

const REDIRECT_URI = "obsidian://inoreader-sync-auth";

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
					new Notice("Inoreader: No authorization code received");
					return;
				}
				if (state !== this.oauthState) {
					new Notice("Inoreader: Authentication failed (state mismatch)");
					return;
				}

				try {
					const tokens = await this.api.exchangeCode(code, REDIRECT_URI);
					this.settings.accessToken = tokens.accessToken;
					this.settings.refreshToken = tokens.refreshToken;
					this.settings.tokenExpiresAt = tokens.expiresAt;
					this.settings.isConnected = true;
					await this.saveSettings();
					new Notice("Inoreader: Connected successfully");
				} catch (e) {
					console.error("Inoreader OAuth error:", e);
					new Notice("Inoreader: Authentication failed - " + (e as Error).message);
				}
			},
		);

		// Commands
		this.addCommand({
			id: "inoreader-sync",
			name: "Sync",
			callback: () => this.runSync(false),
		});

		this.addCommand({
			id: "inoreader-full-resync",
			name: "Full resync",
			callback: () => this.runSync(true),
		});

		this.addCommand({
			id: "inoreader-connect",
			name: "Connect to Inoreader",
			callback: () => this.startOAuthFlow(),
		});

		this.addCommand({
			id: "inoreader-disconnect",
			name: "Disconnect from Inoreader",
			callback: () => this.disconnect(),
		});

		// Ribbon icon
		this.addRibbonIcon("rss", "Sync Inoreader", () => {
			this.runSync(false);
		});

		// Auto sync
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStartup && this.settings.isConnected) {
				window.setTimeout(() => this.runSync(false), 5000);
			}
			this.setupSyncInterval();
		});
	}

	onunload(): void {
		this.clearSyncInterval();
	}

	// --- API Initialization ---

	private initApi(): void {
		this.api = new InoreaderAPI(
			this.settings.clientId,
			this.settings.clientSecret,
			{
				accessToken: this.settings.accessToken,
				refreshToken: this.settings.refreshToken,
				expiresAt: this.settings.tokenExpiresAt,
			},
			async (tokens: OAuthTokens) => {
				this.settings.accessToken = tokens.accessToken;
				this.settings.refreshToken = tokens.refreshToken;
				this.settings.tokenExpiresAt = tokens.expiresAt;
				await this.saveSettings();
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
			new Notice("Inoreader: Not connected. Configure in settings.");
			return;
		}
		if (!this.settings.clientId || !this.settings.clientSecret) {
			new Notice("Inoreader: Client ID and Secret required. Configure in settings.");
			return;
		}
		try {
			await this.syncEngine.sync(fullResync);
		} catch (e) {
			console.error("Inoreader sync error:", e);
			new Notice("Inoreader: Sync failed - " + (e as Error).message);
		}
	}

	// --- OAuth ---

	startOAuthFlow(): void {
		if (!this.settings.clientId || !this.settings.clientSecret) {
			new Notice("Inoreader: Enter Client ID and Secret first in settings.");
			return;
		}
		this.oauthState = Math.random().toString(36).substring(2, 15);
		const authUrl = this.api.getAuthUrl(REDIRECT_URI, this.oauthState);
		window.open(authUrl);
		new Notice("Inoreader: Opening browser for authentication...");
	}

	disconnect(): void {
		this.settings.accessToken = "";
		this.settings.refreshToken = "";
		this.settings.tokenExpiresAt = 0;
		this.settings.isConnected = false;
		this.api.updateTokens({ accessToken: "", refreshToken: "", expiresAt: 0 });
		this.saveSettings();
		this.clearSyncInterval();
		new Notice("Inoreader: Disconnected");
	}

	// --- Sync Interval ---

	setupSyncInterval(): void {
		this.clearSyncInterval();
		if (this.settings.syncIntervalMinutes > 0 && this.settings.isConnected) {
			const ms = this.settings.syncIntervalMinutes * 60 * 1000;
			this.syncIntervalId = window.setInterval(() => this.runSync(false), ms);
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
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		// Migrate syncTag -> syncTags (pre-0.9.0)
		if (loaded && typeof (loaded as any).syncTag === "string" && (loaded as any).syncTag.trim()) {
			if (!this.settings.syncTags || this.settings.syncTags.length === 0) {
				this.settings.syncTags = [(loaded as any).syncTag.trim()];
			}
		}
		// Migrate syncSource -> syncAnnotations (pre-0.9.0)
		if (loaded && (loaded as any).syncSource) {
			const old = (loaded as any).syncSource;
			if (old === "annotated") {
				this.settings.syncAnnotations = true;
			} else if (old === "tagged") {
				this.settings.syncAnnotations = false;
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
