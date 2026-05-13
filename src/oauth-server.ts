// Desktop-only: spin up a localhost HTTP server to receive the OAuth
// callback. The OAuth code is exchanged entirely between the user's
// browser and the user's machine — nothing transits any third party.
//
// Node's `http` module is intentionally imported here. The plugin only
// calls into this file from code paths gated on Platform.isDesktop, so
// the mobile bundle never executes this require().
/* eslint-disable import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef */

import type { IncomingMessage, Server, ServerResponse } from "http";

export interface CallbackResult {
	code: string;
	state: string;
}

export class OAuthCallbackServer {
	private server: Server | null = null;
	private timeout: number | null = null;

	/**
	 * Listen on 127.0.0.1:port for a single GET to /callback, resolve
	 * with the parsed code+state, and shut down. Rejects on listen
	 * error, missing params, timeout, or stop().
	 */
	listen(port: number, timeoutMs: number): Promise<CallbackResult> {
		const http = require("http") as typeof import("http");

		return new Promise<CallbackResult>((resolve, reject) => {
			const server = http.createServer(
				(req: IncomingMessage, res: ServerResponse) => {
					if (!req.url) {
						res.writeHead(400).end();
						return;
					}
					const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
					if (reqUrl.pathname !== "/callback") {
						res.writeHead(404).end();
						return;
					}

					const code = reqUrl.searchParams.get("code");
					const state = reqUrl.searchParams.get("state");
					const oauthError = reqUrl.searchParams.get("error");

					if (oauthError) {
						this.respondHtml(
							res,
							"Authentication failed",
							`Inoreader returned an error: <code>${escapeHtml(
								oauthError,
							)}</code>. You can close this tab.`,
						);
						this.cleanup();
						reject(new Error(`Inoreader: ${oauthError}`));
						return;
					}

					if (!code || !state) {
						this.respondHtml(
							res,
							"Missing parameters",
							"The redirect URL did not include the expected OAuth parameters. You can close this tab.",
						);
						this.cleanup();
						reject(new Error("Missing code or state in callback"));
						return;
					}

					this.respondHtml(
						res,
						"Authentication received",
						"You can close this tab and return to Obsidian.",
					);
					this.cleanup();
					resolve({ code, state });
				},
			);

			server.on("error", (err) => {
				this.cleanup();
				reject(err);
			});

			server.listen(port, "127.0.0.1", () => {
				this.server = server;
				this.timeout = window.setTimeout(() => {
					this.cleanup();
					reject(new Error("OAuth callback timed out"));
				}, timeoutMs);
			});
		});
	}

	stop(): void {
		this.cleanup();
	}

	private cleanup(): void {
		if (this.timeout !== null) {
			window.clearTimeout(this.timeout);
			this.timeout = null;
		}
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}

	private respondHtml(res: ServerResponse, title: string, body: string): void {
		const html =
			"<!DOCTYPE html><html><head><meta charset='utf-8'>" +
			`<title>${escapeHtml(title)}</title>` +
			"<style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;" +
			"max-width:540px;margin:4em auto;padding:0 1.5em;line-height:1.55;}" +
			"code{background:#eee;padding:0.1em 0.35em;border-radius:3px;}</style>" +
			`</head><body><h1>${escapeHtml(title)}</h1><p>${body}</p></body></html>`;
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(html);
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
