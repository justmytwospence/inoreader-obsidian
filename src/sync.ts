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
		if (!this.settings.syncAnnotations && this.settings.syncTags.length === 0) {
			new Notice("Inoreader: Please enable annotations or select tags in settings");
			return 0;
		}

		const sinceTimestamp = fullResync ? 0 : this.settings.lastSyncTimestamp;
		const processedInRun = new Set<string>();
		let totalSynced = 0;

		new Notice("Inoreader: Fetching articles...");

		// Sync annotated articles
		if (this.settings.syncAnnotations) {
			const folder = normalizePath(`${this.settings.articleFolder}/annotations`);
			try {
				totalSynced += await this.syncSingleStream(
					"user/-/state/com.google/annotated",
					folder,
					sinceTimestamp,
					fullResync,
					processedInRun,
				);
			} catch (e) {
				console.error("Inoreader: failed to sync annotations", e);
				new Notice("Inoreader: Failed to sync annotations");
			}
		}

		// Sync each selected tag
		for (const tagName of this.settings.syncTags) {
			const folderName = sanitizeFilename(tagName);
			const folder = normalizePath(`${this.settings.articleFolder}/tags/${folderName}`);
			try {
				totalSynced += await this.syncSingleStream(
					`user/-/label/${tagName}`,
					folder,
					sinceTimestamp,
					fullResync,
					processedInRun,
				);
			} catch (e) {
				console.error(`Inoreader: failed to sync tag "${tagName}"`, e);
				new Notice(`Inoreader: Failed to sync tag "${tagName}"`);
			}
		}

		// Update sync state
		this.settings.lastSyncTimestamp = Math.floor(Date.now() / 1000);
		await this.saveSettings();

		if (totalSynced === 0) {
			new Notice("Inoreader: No new articles to sync");
		} else {
			new Notice(`Inoreader: Synced ${totalSynced} articles`);
		}
		return totalSynced;
	}

	private async syncSingleStream(
		streamId: string,
		folderPath: string,
		sinceTimestamp: number,
		fullResync: boolean,
		crossDedup: Set<string>,
	): Promise<number> {
		let articles: InoreaderArticle[];
		try {
			articles = await this.api.fetchArticles(streamId, {
				sinceTimestamp: sinceTimestamp || undefined,
				annotations: this.settings.includeAnnotations || this.settings.onlyHighlighted,
			});
		} catch (e) {
			const msg = (e as Error).message;
			if (msg.includes("403") || msg.includes("401")) {
				throw new Error("Authentication failed. Try reconnecting in settings.");
			}
			throw e;
		}

		if (articles.length === 0) return 0;

		// Filter already-synced (persistent)
		const syncedSet = new Set(this.settings.syncedArticleIds);
		let toProcess = fullResync
			? articles
			: articles.filter((a) => !syncedSet.has(a.id));

		// Filter already processed in this run (cross-source dedup)
		toProcess = toProcess.filter((a) => !crossDedup.has(a.id));

		// Filter to only highlighted if setting is on
		if (this.settings.onlyHighlighted) {
			toProcess = toProcess.filter(
				(a) => a.annotations && a.annotations.length > 0,
			);
		}

		if (toProcess.length === 0) return 0;

		let synced = 0;
		for (const article of toProcess) {
			try {
				const data = this.transformArticle(article);
				await this.writeArticleFile(data, folderPath);
				if (this.settings.appendToPeriodicNote) {
					await this.appendToPeriodicNote(data);
				}
				crossDedup.add(article.id);
				synced++;
			} catch (e) {
				console.error(`Inoreader: failed to process "${article.title}"`, e);
			}
		}

		// Update persistent dedup list
		const newIds = toProcess.map((a) => a.id);
		this.settings.syncedArticleIds = [
			...newIds,
			...this.settings.syncedArticleIds,
		].slice(0, 5000);

		return synced;
	}

	private transformArticle(article: InoreaderArticle): ArticleData {
		const highlights: HighlightData[] = (article.annotations ?? []).map(
			(ann) => ({
				id: ann.id,
				text: (ann.text ?? "").trim(),
				note: (ann.note ?? "").trim(),
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

	private async writeArticleFile(data: ArticleData, folder?: string): Promise<void> {
		const rawFilename = this.renderFilename(this.settings.filenameTemplate, data);
		const filename = sanitizeFilename(rawFilename);
		const folderPath = normalizePath(folder ?? this.settings.articleFolder);
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

		// Extract existing highlight IDs from frontmatter
		const existingHlIds = new Set<number>();
		const hlIdsMatch = existingContent.match(/^highlight_ids:\s*\[([\s\S]*?)\]/m);
		if (hlIdsMatch) {
			const ids = hlIdsMatch[1].split(",").map((s) => parseInt(s.trim(), 10));
			for (const id of ids) {
				if (!isNaN(id)) existingHlIds.add(id);
			}
		}

		const newHighlights = data.highlights.filter(
			(h) => !existingHlIds.has(h.id),
		);

		if (newHighlights.length === 0) return;

		const rendered = newHighlights
			.map((h) => renderHighlightBlock(h))
			.join("\n\n");

		// Update highlight_ids in frontmatter
		const allIds = [...existingHlIds, ...newHighlights.map((h) => h.id)];
		const newIdsLine = `highlight_ids: [${allIds.join(", ")}]`;
		let updated = existingContent;
		if (hlIdsMatch) {
			updated = updated.replace(/^highlight_ids:\s*\[([\s\S]*?)\]/m, newIdsLine);
		} else {
			// Insert highlight_ids before the closing ---
			const fmEnd = updated.indexOf("\n---", 1);
			if (fmEnd !== -1) {
				updated = updated.slice(0, fmEnd) + "\n" + newIdsLine + updated.slice(fmEnd);
			}
		}

		// Insert highlights based on position setting
		const fmEndFull = updated.indexOf("\n---", 1);
		const bodyStart = fmEndFull !== -1 ? updated.indexOf("\n", fmEndFull + 1) + 1 : 0;

		if (this.settings.highlightInsertPosition === "prepend") {
			updated = updated.slice(0, bodyStart) + "\n" + rendered + "\n" + updated.slice(bodyStart);
		} else {
			updated = updated.trimEnd() + "\n\n" + rendered + "\n";
		}

		await this.app.vault.modify(file, updated);
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
			if (data.url && content.includes(`](${data.url})`)) return;

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
