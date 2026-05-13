import { App } from "obsidian";

// Secrets are stored in vault-scoped localStorage (via App.saveLocalStorage)
// rather than data.json so they don't travel with Obsidian Sync / iCloud /
// Dropbox / git copies of the vault.

const KEYS = {
	clientSecret: "inoreader-sync:clientSecret",
	accessToken: "inoreader-sync:accessToken",
	refreshToken: "inoreader-sync:refreshToken",
	tokenExpiresAt: "inoreader-sync:tokenExpiresAt",
} as const;

export interface Secrets {
	clientSecret: string;
	accessToken: string;
	refreshToken: string;
	tokenExpiresAt: number;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function loadSecrets(app: App): Secrets {
	return {
		clientSecret: asString(app.loadLocalStorage(KEYS.clientSecret)),
		accessToken: asString(app.loadLocalStorage(KEYS.accessToken)),
		refreshToken: asString(app.loadLocalStorage(KEYS.refreshToken)),
		tokenExpiresAt: asNumber(app.loadLocalStorage(KEYS.tokenExpiresAt)),
	};
}

export function saveSecrets(app: App, secrets: Partial<Secrets>): void {
	if (secrets.clientSecret !== undefined) app.saveLocalStorage(KEYS.clientSecret, secrets.clientSecret);
	if (secrets.accessToken !== undefined) app.saveLocalStorage(KEYS.accessToken, secrets.accessToken);
	if (secrets.refreshToken !== undefined) app.saveLocalStorage(KEYS.refreshToken, secrets.refreshToken);
	if (secrets.tokenExpiresAt !== undefined) app.saveLocalStorage(KEYS.tokenExpiresAt, secrets.tokenExpiresAt);
}
