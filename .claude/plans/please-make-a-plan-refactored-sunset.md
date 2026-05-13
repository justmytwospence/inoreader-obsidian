# Fix Inoreader OAuth Redirect URI (Issue #1)

## Context

Inoreader's developer console no longer accepts custom-scheme redirect URIs like `obsidian://inoreader-sync-auth` — it requires `http://` or `https://`. The plugin currently hardcodes the custom scheme at `src/main.ts:12`, which means new users (and any existing user who needs to re-register their Inoreader app) cannot complete OAuth setup. Reported as [issue #1](https://github.com/justmytwospence/inoreader-obsidian/issues/1).

The plugin is `isDesktopOnly: false`, so the fix must work on both desktop and mobile. That rules out Node http servers and Electron BrowserWindow tricks. The remaining viable approach is a **client-side bouncer page** hosted on HTTPS that 302/JS-redirects back into `obsidian://...`, preserving the OAuth flow as-is for Obsidian's protocol handler.

Goal: make new sign-ups work again, with as little friction as possible for existing users whose Inoreader app registrations still work.

## Approach: HTTPS bouncer on GitHub Pages, with the redirect URI exposed as a setting

A static `callback.html` lives in this repo's `docs/` folder. GitHub Pages serves it for free at `https://justmytwospence.github.io/inoreader-obsidian/callback.html`. The page is self-contained client-side HTML: it reads `window.location.search`, builds `obsidian://inoreader-sync-auth?<same params>`, and navigates the user's browser to it. No server-side handling of the OAuth code, no third-party calls, no logging. From Obsidian's perspective the protocol handler at `inoreader-sync-auth` still receives `code` and `state` exactly as before.

The redirect URI becomes a setting (default: the GitHub Pages URL) so existing users whose `obsidian://...` registrations still work can override it back without re-registering their Inoreader app.

### Why this approach (verification notes)

- `registerObsidianProtocolHandler` is the documented OAuth callback primitive for Obsidian plugins ([API ref](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerObsidianProtocolHandler)). The bouncer doesn't change how Obsidian receives the callback — it just changes what URL the OAuth provider sees.
- Existing precedent in the community-plugin marketplace: the [`obsidian-link`](https://github.com/iamjjanga-ouo/obsidian-link) plugin uses the same HTTPS→`obsidian://` bouncer pattern and was accepted upstream ([obsidian-releases PR #9385](https://github.com/obsidianmd/obsidian-releases/pull/9385)).
- `eslint-plugin-obsidianmd` has no rule that flags external HTTPS redirect URIs, redirect bouncers, or protocol handlers (checked all installed rules).
- GitHub Pages: free, HTTPS-only, 1 GB site limit, 100 GB/month bandwidth — comfortably above what an OAuth callback page needs. Not an "open redirector" in the OWASP sense because the destination is hardcoded in the page, not derived from a query parameter.
- No CSP / CORS issues for this use case: the page receives a top-level browser navigation from Inoreader and emits a same-tab `window.location.href` to `obsidian://...`. No XHR, no iframe, no cross-origin requests.

## Files to Modify / Add

### `docs/callback.html` (new)
Self-contained HTML+JS bouncer. Minimal style. Requirements:
- No external resources (no analytics, no fonts, no CDN scripts).
- Inline JS reads `window.location.search`, validates it has `code` + `state`, builds `obsidian://inoreader-sync-auth?<original query>` and sets `window.location.href`.
- Shows a fallback "Click here to open Obsidian" link in case the browser blocks the auto-redirect (some browsers require a user gesture for protocol handlers).
- Shows a short explanation of what happened ("Authenticating with Inoreader — you should be redirected to Obsidian shortly.") so the page is intelligible if the redirect fails.
- HTML is committed *unminified* so anyone can read and audit it before authorising the redirect.

### `src/settings.ts`
- Add `redirectUri: string` to `InoreaderSyncSettings`.
- Add to `DEFAULT_SETTINGS`: `redirectUri: "https://justmytwospence.github.io/inoreader-obsidian/callback.html"`.
- In the settings UI, add a new control under the existing Connection section after the client ID/secret fields. Label: "Redirect URI". Description: "Register this exact URL with your Inoreader developer application. Only change this if you registered a different URL when you created the app." Type: text input.

### `src/main.ts`
- Delete the `const REDIRECT_URI = "obsidian://inoreader-sync-auth";` at line 12.
- Replace its two usages (`api.getAuthUrl(REDIRECT_URI, ...)` in `startOAuthFlow`, `api.exchangeCode(code, REDIRECT_URI)` in the protocol handler) with `this.settings.redirectUri`.
- **Keep `registerObsidianProtocolHandler("inoreader-sync-auth", ...)` unchanged** — the bouncer page redirects to `obsidian://inoreader-sync-auth?...` so the same handler still fires.
- Validate `this.settings.redirectUri` is non-empty at the start of `startOAuthFlow`; if empty, show a Notice telling the user to set it in settings.

### `README.md`
- Update the **Setup** section step 2: "Set the redirect URI to **`https://justmytwospence.github.io/inoreader-obsidian/callback.html`** (this URL is configurable in plugin settings — see Advanced setup below)."
- Add a short **Upgrade notes (0.18.0 → 0.18.1)** subsection explaining why the redirect URI changed (Inoreader no longer accepts custom schemes) and what existing users with working `obsidian://inoreader-sync-auth` registrations should do (either update their Inoreader app to the new URL, or set the plugin setting back to `obsidian://inoreader-sync-auth`).

### `manifest.json`, `package.json`, `versions.json`
- Bump `version` to `0.18.1` in `manifest.json` and `package.json`.
- Add `"0.18.1": "1.8.7"` to `versions.json`.

## Manual step (cannot automate from here)

Enable GitHub Pages in repo Settings → Pages: source = `main` branch, folder = `/docs`. This makes `https://justmytwospence.github.io/inoreader-obsidian/callback.html` resolvable. Do this **before** publishing 0.18.1 — otherwise the default redirect URI is dead and the plugin is more broken than before. I will write the page in `docs/`, push it on a branch, and remind you to flip the Pages toggle before merging.

## What I'm Not Changing

- The protocol handler `inoreader-sync-auth` and its state-validation logic — the bouncer preserves all params, so this works unchanged.
- The token exchange — same `redirect_uri` parameter goes to Inoreader's token endpoint (now matches whatever was used at authorize time, because we read both from `this.settings.redirectUri`).
- `isDesktopOnly` stays `false` — the bouncer works on both platforms.

## Verification

1. **Local typecheck and lint:** `npm run build` clean.
2. **Static-page audit:** open `docs/callback.html` directly in a browser with a fake query string (`?code=abc&state=xyz`) and confirm it tries to navigate to `obsidian://inoreader-sync-auth?code=abc&state=xyz`. Manually inspect that the page has no outbound network calls.
3. **End-to-end on desktop, default URI:**
   - Push the branch, wait for the Pages deploy to go green.
   - In a test Inoreader app, register `https://justmytwospence.github.io/inoreader-obsidian/callback.html` as the only redirect URI.
   - Connect from the plugin → authorize in browser → bouncer fires → Obsidian opens → token exchange succeeds → "Connected to Inoreader" notice.
4. **End-to-end on mobile** (if possible): same flow on iOS or Android Obsidian. The bouncer should `window.location.href = "obsidian://..."` which mobile OSes honour.
5. **Backwards-compatibility check:** set the redirect URI setting back to `obsidian://inoreader-sync-auth`, register that with an Inoreader app, confirm the flow still works for users who had the old setup.
6. **State-mismatch path:** open a stale callback URL (with a state that doesn't match the in-memory `this.oauthState`) and confirm the "Authentication failed (state mismatch)" notice fires.
