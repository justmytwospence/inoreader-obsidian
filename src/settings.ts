import { App, PluginSettingTab, Setting } from "obsidian";
import type InoreaderSyncPlugin from "./main";

export type NoteType = "daily" | "weekly";
export type UpdateBehavior = "append" | "overwrite";
export type InsertPosition = "append" | "prepend";

export interface InoreaderSyncSettings {
	// Auth
	clientId: string;
	clientSecret: string;
	accessToken: string;
	refreshToken: string;
	tokenExpiresAt: number;
	isConnected: boolean;

	// Sync source
	syncAnnotations: boolean;
	syncTagsEnabled: boolean;
	syncTags: string[];
	includeAnnotations: boolean;

	// Article files
	articleFolder: string;
	filenameTemplate: string;
	articleTemplate: string;
	includeContent: boolean;
	highlightInsertPosition: InsertPosition;
	frontmatterFields: string[];

	// Daily/weekly notes
	appendToPeriodicNote: boolean;
	periodicNoteType: NoteType;
	periodicNoteFolder: string;
	periodicNoteDateFormat: string;
	periodicNoteHeading: string;
	dailyNoteEntryTemplate: string;

	// Sync behavior
	syncOnStartup: boolean;
	syncIntervalMinutes: number;
	updateBehavior: UpdateBehavior;

	// Internal state
	lastSyncTimestamp: number;
	syncedArticleIds: string[];
}

export const DEFAULT_SETTINGS: InoreaderSyncSettings = {
	clientId: "",
	clientSecret: "",
	accessToken: "",
	refreshToken: "",
	tokenExpiresAt: 0,
	isConnected: false,

	syncAnnotations: true,
	syncTagsEnabled: false,
	syncTags: [],
	includeAnnotations: true,

	articleFolder: "Inoreader",
	filenameTemplate: "{{title}}",
	articleTemplate: "",
	includeContent: false,
	highlightInsertPosition: "append",
	frontmatterFields: ["title", "author", "url", "published", "feed", "tags"],

	appendToPeriodicNote: false,
	periodicNoteType: "daily",
	periodicNoteFolder: "",
	periodicNoteDateFormat: "YYYY-MM-DD",
	periodicNoteHeading: "## Inoreader",
	dailyNoteEntryTemplate: "",

	syncOnStartup: false,
	syncIntervalMinutes: 0,
	updateBehavior: "append",

	lastSyncTimestamp: 0,
	syncedArticleIds: [],
};

export class InoreaderSyncSettingTab extends PluginSettingTab {
	plugin: InoreaderSyncPlugin;

	constructor(app: App, plugin: InoreaderSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("inoreader-sync-settings");

		// --- Connection ---
		new Setting(containerEl).setName("Connection").setHeading();

		const statusEl = containerEl.createDiv("connection-status");
		if (this.plugin.settings.isConnected) {
			statusEl.addClass("connected");
			statusEl.setText("Connected");
		} else {
			statusEl.addClass("disconnected");
			statusEl.setText("Not connected");
		}

		new Setting(containerEl)
			.setName("Client ID")
			.setDesc("From your Inoreader developer application")
			.addText((text) =>
				text
					.setPlaceholder("Enter client ID")
					.setValue(this.plugin.settings.clientId)
					.onChange(async (value) => {
						this.plugin.settings.clientId = value;
						this.plugin.api.updateCredentials(value, this.plugin.settings.clientSecret);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Client Secret")
			.setDesc("From your Inoreader developer application")
			.addText((text) => {
				text
					.setPlaceholder("Enter client secret")
					.setValue(this.plugin.settings.clientSecret)
					.onChange(async (value) => {
						this.plugin.settings.clientSecret = value;
						this.plugin.api.updateCredentials(this.plugin.settings.clientId, value);
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Connect")
			.setDesc("Authenticate with Inoreader via OAuth")
			.addButton((btn) =>
				btn
					.setButtonText(this.plugin.settings.isConnected ? "Reconnect" : "Connect to Inoreader")
					.onClick(() => this.plugin.startOAuthFlow()),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Disconnect")
					.setWarning()
					.setDisabled(!this.plugin.settings.isConnected)
					.onClick(async () => {
						this.plugin.disconnect();
						this.display();
					}),
			);

		// --- Manual Sync ---
		new Setting(containerEl)
			.setName("Sync now")
			.setDesc("Manually trigger a sync with Inoreader")
			.addButton((btn) =>
				btn
					.setButtonText("Sync")
					.setCta()
					.setDisabled(!this.plugin.settings.isConnected)
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Syncing...");
						try {
							await this.plugin.runSync(false);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Sync");
							this.display();
						}
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Full resync")
					.setDisabled(!this.plugin.settings.isConnected)
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Resyncing...");
						try {
							await this.plugin.runSync(true);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Full resync");
							this.display();
						}
					}),
			);

		// --- Sync Source ---
		new Setting(containerEl).setName("Sync source").setHeading();

		new Setting(containerEl)
			.setName("Sync annotated articles")
			.setDesc("Sync articles you've highlighted or annotated in Inoreader")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncAnnotations)
					.onChange(async (value) => {
						this.plugin.settings.syncAnnotations = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.syncAnnotations) {
			const annotationSub = containerEl.createDiv("subsettings");
			new Setting(annotationSub)
				.setName("Include annotations")
				.setDesc("Include highlight text and notes in article files (requires Inoreader Pro)")
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.includeAnnotations)
						.onChange(async (value) => {
							this.plugin.settings.includeAnnotations = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Sync tagged articles")
			.setDesc("Sync articles by tag -- each tag gets its own subfolder")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncTagsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.syncTagsEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.syncTagsEnabled) {
			const tagSub = containerEl.createDiv("subsettings");
			new Setting(tagSub).setName("Your Inoreader tags").setHeading();

			const tagContainer = tagSub.createDiv("tag-selection-container");
			if (this.plugin.settings.isConnected) {
				this.renderTagToggles(tagContainer);
			} else {
				new Setting(tagContainer)
					.setName("Tag names")
					.setDesc("Connect to Inoreader to see your tags, or enter tag names manually (one per line)")
					.addTextArea((text) => {
						text
							.setPlaceholder("Read Later\nResearch")
							.setValue(this.plugin.settings.syncTags.join("\n"))
							.onChange(async (value) => {
								this.plugin.settings.syncTags = value
									.split("\n")
									.map((t) => t.trim())
									.filter((t) => t.length > 0);
								await this.plugin.saveSettings();
							});
						text.inputEl.rows = 5;
					});
			}
		}

		// --- Article Files ---
		new Setting(containerEl).setName("Article files").setHeading();

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Folder where article files are created")
			.addText((text) =>
				text
					.setPlaceholder("Inoreader")
					.setValue(this.plugin.settings.articleFolder)
					.onChange(async (value) => {
						this.plugin.settings.articleFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Filename template")
			.setDesc("Variables: {{title}}, {{author}}, {{date}}, {{feed}}")
			.addText((text) =>
				text
					.setPlaceholder("{{title}}")
					.setValue(this.plugin.settings.filenameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.filenameTemplate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("New highlight position")
			.setDesc("Where to insert new highlights when re-syncing an existing article")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("append", "Append to end")
					.addOption("prepend", "Prepend to top")
					.setValue(this.plugin.settings.highlightInsertPosition)
					.onChange(async (value: string) => {
						this.plugin.settings.highlightInsertPosition = value as InsertPosition;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Include full article content")
			.setDesc("Convert article HTML to markdown and append below highlights")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeContent)
					.onChange(async (value) => {
						this.plugin.settings.includeContent = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Article template")
			.setDesc(
				"Custom template for article files. Leave empty for default. " +
				"Variables: {{title}}, {{author}}, {{url}}, {{feed_title}}, {{feed_url}}, " +
				"{{published_date}}, {{highlights}}, {{content}}, {{highlight_count}}, " +
				"{{tags}}, {{frontmatter}}, {{id}}",
			)
			.addTextArea((text) => {
				text
					.setPlaceholder("Leave empty for default template")
					.setValue(this.plugin.settings.articleTemplate)
					.onChange(async (value) => {
						this.plugin.settings.articleTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 12;
				text.inputEl.cols = 50;
			});

		// Frontmatter fields
		const fmFields = ["title", "author", "url", "published", "feed", "tags"];
		new Setting(containerEl)
			.setName("Frontmatter fields")
			.setDesc("Which metadata fields to include in frontmatter (inoreader_id is always included)");

		for (const field of fmFields) {
			new Setting(containerEl)
				.setName(`  ${field}`)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.frontmatterFields.includes(field))
						.onChange(async (value) => {
							if (value) {
								if (!this.plugin.settings.frontmatterFields.includes(field)) {
									this.plugin.settings.frontmatterFields.push(field);
								}
							} else {
								this.plugin.settings.frontmatterFields =
									this.plugin.settings.frontmatterFields.filter((f) => f !== field);
							}
							await this.plugin.saveSettings();
						}),
				);
		}

		// --- Periodic Notes ---
		new Setting(containerEl).setName("Periodic notes").setHeading();

		new Setting(containerEl)
			.setName("Append to periodic notes")
			.setDesc("Add entries to your daily or weekly notes when syncing")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.appendToPeriodicNote)
					.onChange(async (value) => {
						this.plugin.settings.appendToPeriodicNote = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.appendToPeriodicNote) {
			const periodicSub = containerEl.createDiv("subsettings");

			new Setting(periodicSub)
				.setName("Note type")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("daily", "Daily notes")
						.addOption("weekly", "Weekly notes")
						.setValue(this.plugin.settings.periodicNoteType)
						.onChange(async (value: string) => {
							this.plugin.settings.periodicNoteType = value as NoteType;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(periodicSub)
				.setName("Folder")
				.setDesc("Leave empty to auto-detect from Daily Notes or Periodic Notes plugin")
				.addText((text) =>
					text
						.setPlaceholder("Auto-detect")
						.setValue(this.plugin.settings.periodicNoteFolder)
						.onChange(async (value) => {
							this.plugin.settings.periodicNoteFolder = value;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(periodicSub)
				.setName("Date format")
				.setDesc("Leave empty to auto-detect. Supports YYYY, MM, DD, WW")
				.addText((text) =>
					text
						.setPlaceholder("YYYY-MM-DD")
						.setValue(this.plugin.settings.periodicNoteDateFormat)
						.onChange(async (value) => {
							this.plugin.settings.periodicNoteDateFormat = value;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(periodicSub)
				.setName("Heading")
				.setDesc("Heading to append entries under in the periodic note")
				.addText((text) =>
					text
						.setPlaceholder("## Inoreader")
						.setValue(this.plugin.settings.periodicNoteHeading)
						.onChange(async (value) => {
							this.plugin.settings.periodicNoteHeading = value;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(periodicSub)
				.setName("Entry template")
				.setDesc(
					"Template for each entry appended to periodic notes. Leave empty for default. " +
					"Variables: {{title}}, {{url}}, {{author}}, {{feed_title}}, {{published_date}}, " +
					"{{highlight_count}}, {{#each highlights}}...{{/each}}",
				)
				.addTextArea((text) => {
					text
						.setPlaceholder("Leave empty for default template")
						.setValue(this.plugin.settings.dailyNoteEntryTemplate)
						.onChange(async (value) => {
							this.plugin.settings.dailyNoteEntryTemplate = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.rows = 8;
					text.inputEl.cols = 50;
				});
		}

		// --- Sync Behavior ---
		new Setting(containerEl).setName("Sync behavior").setHeading();

		new Setting(containerEl)
			.setName("Sync on startup")
			.setDesc("Automatically sync when Obsidian opens")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.syncOnStartup = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync interval")
			.setDesc("How often to automatically sync (0 = manual only)")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("0", "Manual only")
					.addOption("15", "Every 15 minutes")
					.addOption("30", "Every 30 minutes")
					.addOption("60", "Every hour")
					.addOption("360", "Every 6 hours")
					.addOption("720", "Every 12 hours")
					.addOption("1440", "Every 24 hours")
					.setValue(String(this.plugin.settings.syncIntervalMinutes))
					.onChange(async (value) => {
						this.plugin.settings.syncIntervalMinutes = parseInt(value, 10);
						await this.plugin.saveSettings();
						this.plugin.setupSyncInterval();
					}),
			);

		new Setting(containerEl)
			.setName("Update behavior")
			.setDesc("How to handle articles that already have a file")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("append", "Append new highlights only")
					.addOption("overwrite", "Overwrite entire file")
					.setValue(this.plugin.settings.updateBehavior)
					.onChange(async (value: string) => {
						this.plugin.settings.updateBehavior = value as UpdateBehavior;
						await this.plugin.saveSettings();
					}),
			);

		// --- Sync State ---
		new Setting(containerEl).setName("Sync state").setHeading();

		const lastSync = this.plugin.settings.lastSyncTimestamp;
		const lastSyncStr = lastSync
			? new Date(lastSync * 1000).toLocaleString()
			: "Never";

		new Setting(containerEl)
			.setName("Last sync")
			.setDesc(lastSyncStr);

		new Setting(containerEl)
			.setName("Reset sync state")
			.setDesc("Clear sync history to re-sync everything on next sync")
			.addButton((btn) =>
				btn
					.setButtonText("Reset")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.lastSyncTimestamp = 0;
						this.plugin.settings.syncedArticleIds = [];
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	private async renderTagToggles(container: HTMLElement): Promise<void> {
		const loadingEl = container.createEl("p", { text: "Loading tags..." });

		try {
			const response = await this.plugin.api.getTagList();
			loadingEl.remove();

			const userTags = response.tags
				.filter((t) => t.id.includes("/label/"))
				.map((t) => ({
					id: t.id,
					label: t.id.split("/label/").pop() ?? t.id,
				}));

			if (userTags.length === 0) {
				container.createEl("p", {
					text: "No tags found in your Inoreader account.",
					cls: "setting-item-description",
				});
				return;
			}

			const selectedSet = new Set(this.plugin.settings.syncTags);

			for (const tag of userTags) {
				new Setting(container)
					.setName(`  ${tag.label}`)
					.addToggle((toggle) =>
						toggle
							.setValue(selectedSet.has(tag.label))
							.onChange(async (value) => {
								if (value) {
									if (!this.plugin.settings.syncTags.includes(tag.label)) {
										this.plugin.settings.syncTags.push(tag.label);
									}
								} else {
									this.plugin.settings.syncTags =
										this.plugin.settings.syncTags.filter((t) => t !== tag.label);
								}
								await this.plugin.saveSettings();
							}),
					);
			}
		} catch (e) {
			loadingEl.remove();
			console.error("Inoreader: Failed to fetch tags", e);

			new Setting(container)
				.setName("Tag names")
				.setDesc("Could not fetch tags. Enter tag names manually, one per line.")
				.addTextArea((text) => {
					text
						.setPlaceholder("Read Later\nResearch")
						.setValue(this.plugin.settings.syncTags.join("\n"))
						.onChange(async (value) => {
							this.plugin.settings.syncTags = value
								.split("\n")
								.map((t) => t.trim())
								.filter((t) => t.length > 0);
							await this.plugin.saveSettings();
						});
					text.inputEl.rows = 5;
				});
		}
	}
}
