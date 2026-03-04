import { App, Notice, TFile, normalizePath } from "obsidian";
import { InoreaderAPI } from "./api";
import { InoreaderArticle, ArticleData, HighlightData } from "./types";
import { InoreaderSyncSettings } from "./settings";
import { TemplateSettings, renderArticleFile, renderHighlightBlock, renderDailyNoteEntry } from "./templates";
import { sanitizeFilename, htmlToMarkdown, formatDate, shortHash } from "./utils";

export class SyncEngine {
	private app: App;
	private api: InoreaderAPI;
	private settings: InoreaderSyncSettings;
	private saveSettings: () => Promise<void>;

	constructor(
		app: App,
		api: InoreaderAPI,
		settings: InoreaderSyncSettings,
		saveSettings: () => Promise<void>,
	) {
		this.app = app;
		this.api = api;
		this.settings = settings;
		this.saveSettings = saveSettings;
	}

	async sync(fullResync: boolean = false): Promise<number> {
		const sinceTimestamp = fullResync ? 0 : this.settings.lastSyncTimestamp;
		const streamId = this.getStreamId();

		new Notice("Inoreader: Fetching articles...");

		let articles: InoreaderArticle[];
		try {
			articles = await this.api.fetchArticles(streamId, {
				sinceTimestamp: sinceTimestamp || undefined,
				annotations: this.settings.includeAnnotations,
			});
		} catch (e) {
			const msg = (e as Error).message;
			if (msg.includes("403") || msg.includes("401")) {
				throw new Error("Authentication failed. Try reconnecting in settings.");
			}
			throw e;
		}

		if (articles.length === 0) {
			new Notice("Inoreader: No new articles to sync");
			return 0;
		}

		// Filter already-synced
		const syncedSet = new Set(this.settings.syncedArticleIds);
		let toProcess = fullResync
			? articles
			: articles.filter((a) => !syncedSet.has(a.id));

		// Filter to only highlighted if setting is on
		if (this.settings.onlyHighlighted) {
			toProcess = toProcess.filter(
				(a) => a.annotations && a.annotations.length > 0,
			);
		}

		if (toProcess.length === 0) {
			new Notice("Inoreader: No new articles to sync");
			return 0;
		}

		new Notice(`Inoreader: Processing ${toProcess.length} articles...`);

		let synced = 0;
		for (const article of toProcess) {
			try {
				const data = this.transformArticle(article);
				await this.writeArticleFile(data);
				if (this.settings.appendToPeriodicNote) {
					await this.appendToPeriodicNote(data);
				}
				synced++;
			} catch (e) {
				console.error(`Inoreader: failed to process "${article.title}"`, e);
			}
		}

		// Update sync state
		this.settings.lastSyncTimestamp = Math.floor(Date.now() / 1000);
		const newIds = toProcess.map((a) => a.id);
		this.settings.syncedArticleIds = [
			...newIds,
			...this.settings.syncedArticleIds,
		].slice(0, 5000);
		await this.saveSettings();

		new Notice(`Inoreader: Synced ${synced} articles`);
		return synced;
	}

	private getStreamId(): string {
		switch (this.settings.syncSource) {
			case "starred":
				return "user/-/state/com.google/starred";
			case "annotated":
				return "user/-/state/com.google/annotated";
			case "tagged":
				return `user/-/label/${this.settings.syncTag}`;
			case "all":
				return "user/-/state/com.google/reading-list";
		}
	}

	private transformArticle(article: InoreaderArticle): ArticleData {
		const highlights: HighlightData[] = (article.annotations ?? []).map(
			(ann) => ({
				id: ann.id,
				text: ann.text,
				note: ann.note ?? "",
				addedOn: new Date(ann.added_on * 1000).toISOString(),
			}),
		);

		const tags = article.categories
			.filter((c) => c.includes("/label/"))
			.map((c) => c.split("/label/").pop() ?? "");

		const isStarred = article.categories.some((c) =>
			c.includes("state/com.google/starred"),
		);

		return {
			id: article.id,
			title: article.title || "Untitled",
			author: article.author ?? "Unknown",
			url: article.canonical?.[0]?.href ?? article.alternate?.[0]?.href ?? "",
			publishedDate: new Date(article.published * 1000).toISOString(),
			feedTitle: article.origin?.title ?? "",
			feedUrl: article.origin?.htmlUrl ?? "",
			tags,
			highlights,
			htmlContent: article.summary?.content ?? "",
			isStarred,
		};
	}

	private getTemplateSettings(): TemplateSettings {
		return {
			articleTemplate: this.settings.articleTemplate,
			dailyNoteEntryTemplate: this.settings.dailyNoteEntryTemplate,
			frontmatterFields: this.settings.frontmatterFields,
			includeContent: this.settings.includeContent,
		};
	}

	// --- Article File Writing ---

	private async writeArticleFile(data: ArticleData): Promise<void> {
		const rawFilename = this.renderFilename(this.settings.filenameTemplate, data);
		const filename = sanitizeFilename(rawFilename);
		const folderPath = normalizePath(this.settings.articleFolder);
		let filePath = normalizePath(`${folderPath}/${filename}.md`);

		await this.ensureFolderExists(folderPath);

		// Handle filename collisions
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			// Check if it's the same article by reading frontmatter
			const content = await this.app.vault.read(existingFile);
			const isSameArticle = content.includes(`inoreader_id: "${data.id}"`);

			if (isSameArticle) {
				if (this.settings.updateBehavior === "overwrite") {
					const newContent = renderArticleFile(data, this.getTemplateSettings());
					await this.app.vault.modify(existingFile, newContent);
				} else {
					await this.appendNewHighlights(existingFile, data);
				}
				return;
			}

			// Different article, same title -- add hash suffix
			filePath = normalizePath(
				`${folderPath}/${filename} (${shortHash(data.id)}).md`,
			);
		}

		// Check the hash-suffixed path too
		const hashFile = this.app.vault.getAbstractFileByPath(filePath);
		if (hashFile instanceof TFile) {
			if (this.settings.updateBehavior === "overwrite") {
				const newContent = renderArticleFile(data, this.getTemplateSettings());
				await this.app.vault.modify(hashFile, newContent);
			} else {
				await this.appendNewHighlights(hashFile, data);
			}
			return;
		}

		// New file
		const content = renderArticleFile(data, this.getTemplateSettings());
		await this.app.vault.create(filePath, content);
	}

	private async appendNewHighlights(file: TFile, data: ArticleData): Promise<void> {
		if (data.highlights.length === 0) return;

		const existingContent = await this.app.vault.read(file);

		// Find existing highlight IDs
		const existingHlIds = new Set<number>();
		const hlIdRegex = /%% hl:(\d+) %%/g;
		let match;
		while ((match = hlIdRegex.exec(existingContent)) !== null) {
			existingHlIds.add(parseInt(match[1], 10));
		}

		const newHighlights = data.highlights.filter(
			(h) => !existingHlIds.has(h.id),
		);

		if (newHighlights.length === 0) return;

		const rendered = newHighlights
			.map((h) => renderHighlightBlock(h))
			.join("\n\n");

		const SECTION_END = "%% /inoreader-highlights %%";
		const insertionPoint = existingContent.indexOf(SECTION_END);

		if (insertionPoint === -1) {
			await this.app.vault.modify(file, existingContent + "\n\n" + rendered);
		} else {
			const updated =
				existingContent.slice(0, insertionPoint) +
				rendered +
				"\n\n" +
				existingContent.slice(insertionPoint);
			await this.app.vault.modify(file, updated);
		}
	}

	// --- Periodic Note Appending ---

	private async appendToPeriodicNote(data: ArticleData): Promise<void> {
		const { folder, format } = this.resolvePeriodicNoteConfig();
		const dateStr = formatDate(new Date(), format);
		const filePath = normalizePath(
			folder ? `${folder}/${dateStr}.md` : `${dateStr}.md`,
		);

		const entry = renderDailyNoteEntry(data, this.getTemplateSettings());
		const heading = this.settings.periodicNoteHeading;

		const existingFile = this.app.vault.getAbstractFileByPath(filePath);

		if (existingFile instanceof TFile) {
			const content = await this.app.vault.read(existingFile);

			// Dedup by URL
			if (data.url && content.includes(data.url)) return;

			const headingIdx = content.indexOf(heading);

			if (headingIdx !== -1) {
				// Find end of heading line
				const afterHeading = content.indexOf("\n", headingIdx);
				const insertAt = afterHeading !== -1 ? afterHeading + 1 : content.length;
				const updated =
					content.slice(0, insertAt) +
					"\n" + entry + "\n" +
					content.slice(insertAt);
				await this.app.vault.modify(existingFile, updated);
			} else {
				// Heading not found; append at end
				await this.app.vault.modify(
					existingFile,
					content + "\n\n" + heading + "\n\n" + entry,
				);
			}
		} else {
			// Create new periodic note
			if (folder) await this.ensureFolderExists(folder);
			const content = `${heading}\n\n${entry}\n`;
			await this.app.vault.create(filePath, content);
		}
	}

	private resolvePeriodicNoteConfig(): { folder: string; format: string } {
		// If user specified explicit values, use them
		if (this.settings.periodicNoteFolder || this.settings.periodicNoteDateFormat !== "YYYY-MM-DD") {
			return {
				folder: this.settings.periodicNoteFolder,
				format: this.settings.periodicNoteDateFormat || "YYYY-MM-DD",
			};
		}

		// Try to read from Periodic Notes community plugin
		const periodicNotes = (this.app as any).plugins?.plugins?.["periodic-notes"];
		if (periodicNotes?.enabled) {
			const pnSettings = periodicNotes.settings;
			if (this.settings.periodicNoteType === "daily" && pnSettings?.daily?.enabled) {
				return {
					folder: pnSettings.daily.folder || "",
					format: pnSettings.daily.format || "YYYY-MM-DD",
				};
			}
			if (this.settings.periodicNoteType === "weekly" && pnSettings?.weekly?.enabled) {
				return {
					folder: pnSettings.weekly.folder || "",
					format: pnSettings.weekly.format || "YYYY-[W]WW",
				};
			}
		}

		// Try to read from Daily Notes core plugin
		const dailyNotes = (this.app as any).internalPlugins?.plugins?.["daily-notes"];
		if (dailyNotes?.enabled && this.settings.periodicNoteType === "daily") {
			const config = dailyNotes.instance?.options;
			if (config) {
				return {
					folder: config.folder || "",
					format: config.format || "YYYY-MM-DD",
				};
			}
		}

		// Defaults
		return {
			folder: "",
			format: this.settings.periodicNoteType === "weekly" ? "YYYY-[W]WW" : "YYYY-MM-DD",
		};
	}

	// --- Helpers ---

	private renderFilename(template: string, data: ArticleData): string {
		return template
			.replace(/\{\{title\}\}/g, data.title)
			.replace(/\{\{author\}\}/g, data.author)
			.replace(/\{\{date\}\}/g, data.publishedDate.slice(0, 10))
			.replace(/\{\{feed\}\}/g, data.feedTitle);
	}

	private async ensureFolderExists(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const parts = normalized.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}
