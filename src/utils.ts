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

/**
 * Convert HTML to Markdown.
 * Uses Obsidian's built-in htmlToMarkdown if available, otherwise a basic fallback.
 */
export function htmlToMarkdown(html: string): string {
	if (typeof (window as any).htmlToMarkdown === "function") {
		return (window as any).htmlToMarkdown(html);
	}
	// Basic fallback
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<\/li>/gi, "\n")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<\/h[1-6]>/gi, "\n\n")
		.replace(/<h([1-6])[^>]*>/gi, (_, level) => "#".repeat(parseInt(level)) + " ")
		.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
		.replace(/<(strong|b)>(.*?)<\/\1>/gi, "**$2**")
		.replace(/<(em|i)>(.*?)<\/\1>/gi, "*$2*")
		.replace(/<code>(.*?)<\/code>/gi, "`$1`")
		.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) =>
			content.trim().split("\n").map((line: string) => `> ${line}`).join("\n")
		)
		.replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, "![$1]")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
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
	let result = format.replace(/\[([^\]]*)\]/g, (_, content) => {
		literals.push(content);
		return `\x00${literals.length - 1}\x00`;
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
	result = result.replace(/\x00(\d+)\x00/g, (_, idx) => literals[parseInt(idx, 10)]);

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
