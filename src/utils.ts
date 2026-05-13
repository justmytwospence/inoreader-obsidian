import { htmlToMarkdown as obsidianHtmlToMarkdown } from "obsidian";

/**
 * Sanitize a string for use as a filename.
 * Removes characters invalid on Windows, macOS, and Linux.
 */
export function sanitizeFilename(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
}

export function htmlToMarkdown(html: string): string {
	return obsidianHtmlToMarkdown(html);
}

/**
 * Format a Date to a string based on a format pattern.
 * Supports: gggg (ISO week year), YYYY, MM, DD, WW, ww, Q
 */
export function formatDate(date: Date, format: string): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const week = getISOWeek(date);
	const weekStr = String(week).padStart(2, "0");
	const quarter = String(Math.floor(date.getMonth() / 3) + 1);

	// Extract bracket-escaped literals before token replacement
	const literals: string[] = [];
	const PLACEHOLDER = "";
	let result = format.replace(/\[([^\]]*)\]/g, (_match, content: string) => {
		literals.push(content);
		return `${PLACEHOLDER}${literals.length - 1}${PLACEHOLDER}`;
	});

	// ISO week-numbering year (must replace before YYYY to avoid partial match)
	if (result.includes("gggg")) {
		result = result.replace("gggg", String(getISOWeekYear(date)));
	}

	result = result
		.replace("YYYY", String(y))
		.replace("MM", m)
		.replace("DD", d);

	// ISO week number (uppercase and lowercase)
	result = result.replace("WW", weekStr);
	result = result.replace("ww", weekStr);

	// Quarter
	result = result.replace("Q", quarter);

	// Restore bracket-escaped literals
	const placeholderRegex = new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g");
	result = result.replace(placeholderRegex, (_match, idx: string) => literals[parseInt(idx, 10)]);

	return result;
}

function getISOWeek(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getISOWeekYear(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	return d.getUTCFullYear();
}

/**
 * Generate a short hash from a string for filename dedup.
 */
export function shortHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0;
	}
	return Math.abs(hash).toString(36).slice(0, 6);
}

/**
 * Escape a string for use in YAML frontmatter values.
 */
export function escapeYaml(s: string): string {
	return s.replace(/"/g, '\\"').replace(/\n/g, " ");
}
