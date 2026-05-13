import { App, Modal, Setting } from "obsidian";

export interface PasteResult {
	code: string;
	state: string;
}

/**
 * Mobile fallback: after authenticating in the browser, the redirect
 * lands on a page that fails to load (because no localhost server is
 * running on the device). The user copies the URL from the browser's
 * address bar and pastes it here; we parse code and state out of it.
 */
export class OAuthPasteModal extends Modal {
	private result: PasteResult | null = null;
	private inputValue = "";

	constructor(
		app: App,
		private onSubmit: (result: PasteResult) => void,
		private onCancel: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Paste Inoreader redirect URL" });
		contentEl.createEl("p", {
			text:
				"After authenticating in your browser you'll be redirected to a URL " +
				"that won't load (it points at a localhost address that doesn't exist " +
				"on this device). Copy the full URL from your browser's address bar " +
				"and paste it below.",
		});

		new Setting(contentEl)
			.setName("Redirect URL")
			.setDesc("Looks like http://127.0.0.1:42819/callback?code=…&state=…")
			.addTextArea((text) => {
				text.inputEl.rows = 3;
				text.inputEl.addClass("inoreader-paste-input");
				text.onChange((value) => {
					this.inputValue = value;
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Submit")
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	private submit(): void {
		const parsed = parseCallbackInput(this.inputValue);
		if (!parsed) {
			const { contentEl } = this;
			let err = contentEl.querySelector<HTMLElement>(".inoreader-paste-error");
			if (!err) {
				err = contentEl.createEl("p", { cls: "inoreader-paste-error" });
			}
			err.setText("Could not find code and state in the input. Paste the full URL.");
			return;
		}
		this.result = parsed;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.result) {
			this.onSubmit(this.result);
		} else {
			this.onCancel();
		}
	}
}

export function parseCallbackInput(input: string): PasteResult | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	// Try parsing as a full URL first, then as a bare query string.
	let params: URLSearchParams | null = null;
	try {
		params = new URL(trimmed).searchParams;
	} catch {
		const qIdx = trimmed.indexOf("?");
		const queryPart = qIdx >= 0 ? trimmed.slice(qIdx + 1) : trimmed;
		try {
			params = new URLSearchParams(queryPart);
		} catch {
			return null;
		}
	}

	const code = params.get("code");
	const state = params.get("state");
	if (!code || !state) return null;
	return { code, state };
}
