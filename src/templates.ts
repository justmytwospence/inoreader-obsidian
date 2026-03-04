import { ArticleData, HighlightData } from "./types";
import { htmlToMarkdown, escapeYaml } from "./utils";

export interface TemplateSettings {
	articleTemplate: string;
	dailyNoteEntryTemplate: string;
	frontmatterFields: string[];
	includeContent: boolean;
}

// --- Default Templates ---

const DEFAULT_ARTICLE_TEMPLATE = `---
{{frontmatter}}
---

# {{title}}

**Author**: {{author}} | **Source**: [{{feed_title}}]({{feed_url}}) | **Date**: {{published_date}}
**Link**: [{{url}}]({{url}})

<!-- inoreader-highlights -->

{{highlights}}

<!-- /inoreader-highlights -->
{{#if content}}

---

## Article Content

{{content}}
{{/if}}
`;

const DEFAULT_DAILY_NOTE_ENTRY_TEMPLATE = `- [{{title}}]({{url}}) | {{feed_title}}{{#if highlight_count}} | {{highlight_count}} highlights{{/if}}
{{#each highlights}}
  > {{this.text}}{{#if this.note}}
  > **Note**: {{this.note}}{{/if}}
{{/each}}`;

// --- Rendering Functions ---

export function renderArticleFile(data: ArticleData, settings: TemplateSettings): string {
	const template = settings.articleTemplate || DEFAULT_ARTICLE_TEMPLATE;
	const frontmatter = buildFrontmatter(data, settings.frontmatterFields);
	const highlightsBlock = data.highlights
		.map((h) => renderHighlightBlock(h))
		.join("\n\n");
	const content = settings.includeContent ? htmlToMarkdown(data.htmlContent) : "";

	return applyTemplate(template, {
		frontmatter,
		title: data.title,
		author: data.author,
		url: data.url,
		feed_title: data.feedTitle,
		feed_url: data.feedUrl,
		published_date: data.publishedDate.slice(0, 10),
		highlights: highlightsBlock,
		content,
		highlight_count: String(data.highlights.length),
		tags: data.tags.map((t) => `"${t}"`).join(", "),
		id: data.id,
	}, data.highlights);
}

export function renderHighlightBlock(h: HighlightData): string {
	let block = `<!-- hl:${h.id} -->\n> ${h.text}`;
	if (h.note) {
		block += `\n>\n> **Note**: ${h.note}`;
	}
	return block;
}

export function renderDailyNoteEntry(data: ArticleData, settings: TemplateSettings): string {
	const template = settings.dailyNoteEntryTemplate || DEFAULT_DAILY_NOTE_ENTRY_TEMPLATE;

	return applyTemplate(template, {
		title: data.title,
		url: data.url,
		author: data.author,
		feed_title: data.feedTitle,
		feed_url: data.feedUrl,
		published_date: data.publishedDate.slice(0, 10),
		highlight_count: String(data.highlights.length),
		tags: data.tags.join(", "),
		id: data.id,
	}, data.highlights);
}

// --- Template Engine ---

function applyTemplate(
	template: string,
	vars: Record<string, string>,
	highlights: HighlightData[],
): string {
	let result = template;

	// Handle {{#each highlights}} blocks
	const eachRegex = /\{\{#each highlights\}\}([\s\S]*?)\{\{\/each\}\}/g;
	result = result.replace(eachRegex, (_, itemTemplate: string) => {
		if (highlights.length === 0) return "";
		return highlights
			.map((h) => {
				let rendered = itemTemplate;
				rendered = rendered.replace(/\{\{this\.text\}\}/g, h.text);
				rendered = rendered.replace(/\{\{this\.note\}\}/g, h.note || "");
				rendered = rendered.replace(/\{\{this\.id\}\}/g, String(h.id));
				rendered = rendered.replace(/\{\{this\.addedOn\}\}/g, h.addedOn);
				// Handle {{#if this.note}} conditionals
				rendered = rendered.replace(
					/\{\{#if this\.note\}\}([\s\S]*?)\{\{\/if\}\}/g,
					h.note ? "$1" : "",
				);
				return rendered;
			})
			.join("\n");
	});

	// Handle {{#if VAR}} conditionals
	result = result.replace(
		/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
		(_, key: string, content: string) => {
			const val = vars[key] ?? "";
			// Truthy: non-empty string, non-zero number string
			if (val && val !== "0") return content;
			return "";
		},
	);

	// Replace {{variable}} placeholders
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
	}

	return result;
}

function buildFrontmatter(data: ArticleData, fields: string[]): string {
	const include = new Set(fields);
	const lines: string[] = [];

	if (include.has("title")) lines.push(`title: "${escapeYaml(data.title)}"`);
	if (include.has("author")) lines.push(`author: "${escapeYaml(data.author)}"`);
	if (include.has("url")) lines.push(`url: "${data.url}"`);
	if (include.has("published")) lines.push(`published: ${data.publishedDate.slice(0, 10)}`);
	if (include.has("feed")) lines.push(`feed: "${escapeYaml(data.feedTitle)}"`);
	if (include.has("tags") && data.tags.length > 0) {
		lines.push(`tags: [${data.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`);
	}

	// Always include inoreader_id for dedup
	lines.push(`inoreader_id: "${data.id}"`);

	return lines.join("\n");
}
