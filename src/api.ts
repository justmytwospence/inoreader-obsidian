import { requestUrl, RequestUrlResponse } from "obsidian";
import {
	InoreaderArticle,
	InoreaderStreamContentsResponse,
	InoreaderUserInfo,
	InoreaderTagListResponse,
	InoreaderSubscriptionListResponse,
	InoreaderUnreadCountResponse,
	OAuthTokens,
} from "./types";

const BASE_URL = "https://www.inoreader.com/reader/api/0";
const OAUTH_AUTH_URL = "https://www.inoreader.com/oauth2/auth";
const OAUTH_TOKEN_URL = "https://www.inoreader.com/oauth2/token";

export class InoreaderAPI {
	private clientId: string;
	private clientSecret: string;
	private tokens: OAuthTokens;
	private onTokenRefresh: (tokens: OAuthTokens) => Promise<void>;

	constructor(
		clientId: string,
		clientSecret: string,
		tokens: OAuthTokens,
		onTokenRefresh: (tokens: OAuthTokens) => Promise<void>,
	) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.tokens = tokens;
		this.onTokenRefresh = onTokenRefresh;
	}

	updateCredentials(clientId: string, clientSecret: string): void {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	updateTokens(tokens: OAuthTokens): void {
		this.tokens = tokens;
	}

	get isAuthenticated(): boolean {
		return !!this.tokens.accessToken;
	}

	// --- OAuth Flow ---

	getAuthUrl(redirectUri: string, state: string): string {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "read",
			state,
		});
		return `${OAUTH_AUTH_URL}?${params.toString()}`;
	}

	async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
		const resp = await requestUrl({
			url: OAUTH_TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				redirect_uri: redirectUri,
				client_id: this.clientId,
				client_secret: this.clientSecret,
				grant_type: "authorization_code",
			}).toString(),
		});
		const data = resp.json;
		this.tokens = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
		};
		await this.onTokenRefresh(this.tokens);
		return this.tokens;
	}

	private async refreshTokenIfNeeded(): Promise<void> {
		if (!this.tokens.refreshToken) return;
		// Refresh 5 minutes before expiry
		if (this.tokens.expiresAt > 0 && Date.now() < this.tokens.expiresAt - 300_000) return;

		const resp = await requestUrl({
			url: OAUTH_TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				grant_type: "refresh_token",
				refresh_token: this.tokens.refreshToken,
			}).toString(),
		});
		const data = resp.json;
		this.tokens = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token ?? this.tokens.refreshToken,
			expiresAt: Date.now() + data.expires_in * 1000,
		};
		await this.onTokenRefresh(this.tokens);
	}

	// --- Core Request ---

	private async request(
		path: string,
		params?: Record<string, string>,
		method: "GET" | "POST" = "GET",
		body?: string,
	): Promise<RequestUrlResponse> {
		await this.refreshTokenIfNeeded();
		const url = new URL(`${BASE_URL}${path}`);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				url.searchParams.set(k, v);
			}
		}
		return requestUrl({
			url: url.toString(),
			method,
			headers: {
				Authorization: `Bearer ${this.tokens.accessToken}`,
				...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
			},
			body,
		});
	}

	// --- API Methods ---

	async getUserInfo(): Promise<InoreaderUserInfo> {
		const resp = await this.request("/user-info");
		return resp.json;
	}

	async getTagList(): Promise<InoreaderTagListResponse> {
		const resp = await this.request("/tag/list", { output: "json" });
		return resp.json;
	}

	async getSubscriptionList(): Promise<InoreaderSubscriptionListResponse> {
		const resp = await this.request("/subscription/list", { output: "json" });
		return resp.json;
	}

	async getUnreadCounts(): Promise<InoreaderUnreadCountResponse> {
		const resp = await this.request("/unread-count", { output: "json" });
		return resp.json;
	}

	/**
	 * Fetch articles from a stream with full pagination support.
	 * Uses continuation tokens and stops when no more pages exist
	 * or the safety cap is reached.
	 */
	async fetchArticles(
		streamId: string,
		options: {
			sinceTimestamp?: number;
			maxItems?: number;
			annotations?: boolean;
			excludeRead?: boolean;
		} = {},
	): Promise<InoreaderArticle[]> {
		const allArticles: InoreaderArticle[] = [];
		let continuation: string | undefined;
		const maxItems = options.maxItems ?? 1000;

		do {
			const params: Record<string, string> = {
				n: "100",
				output: "json",
			};
			if (options.annotations) params.annotations = "1";
			if (options.sinceTimestamp) params.ot = String(options.sinceTimestamp);
			if (options.excludeRead) {
				params.xt = "user/-/state/com.google/read";
			}
			if (continuation) params.c = continuation;

			const resp = await this.request(
				`/stream/contents/${encodeURIComponent(streamId)}`,
				params,
			);
			const data: InoreaderStreamContentsResponse = resp.json;
			allArticles.push(...data.items);
			continuation = data.continuation;

			if (allArticles.length >= maxItems) break;
		} while (continuation);

		return allArticles;
	}

	/**
	 * Add or remove tags on articles.
	 */
	async editTag(
		articleIds: string[],
		addTag?: string,
		removeTag?: string,
	): Promise<void> {
		const params = new URLSearchParams();
		for (const id of articleIds) {
			params.append("i", id);
		}
		if (addTag) params.set("a", addTag);
		if (removeTag) params.set("r", removeTag);

		await this.request("/edit-tag", undefined, "POST", params.toString());
	}

	/**
	 * Mark all articles in a stream as read.
	 */
	async markAllAsRead(streamId: string, timestamp?: number): Promise<void> {
		const params = new URLSearchParams({ s: streamId });
		if (timestamp) params.set("ts", String(timestamp));
		await this.request("/mark-all-as-read", undefined, "POST", params.toString());
	}
}
