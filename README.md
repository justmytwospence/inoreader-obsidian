# Inoreader Sync

Sync highlights, annotations, and articles from [Inoreader](https://www.inoreader.com/) into your Obsidian vault.

## Features

- **Sync annotated articles** -- articles you've highlighted or annotated in Inoreader get their own markdown files with highlights as blockquotes and notes as plain text
- **Sync by tag** -- select which Inoreader tags to sync; each tag gets its own subfolder
- **Periodic note integration** -- optionally append article entries to your daily or weekly notes, compatible with both the Daily Notes core plugin and Periodic Notes community plugin
- **Incremental sync** -- only fetches new articles since your last sync, respecting Inoreader API rate limits
- **Customizable templates** -- configure article file and periodic note entry templates with Handlebars-like syntax
- **Configurable frontmatter** -- choose which metadata fields to include (title, author, URL, published date, feed, tags)
- **Duplicate detection** -- tracks synced article IDs and highlight IDs to prevent duplicates across re-syncs
- **Full article content** -- optionally include the full article body converted from HTML to markdown

## Requirements

- An [Inoreader](https://www.inoreader.com/) account
- An Inoreader developer application (Client ID and Client Secret) -- create one at [Inoreader Developer Console](https://www.inoreader.com/developers)
- Inoreader Pro plan for annotation/highlight support

## Setup

1. Install the plugin from Obsidian's Community Plugins browser
2. Create an Inoreader developer application at the [Inoreader Developer Console](https://www.inoreader.com/developers)
   - Set the redirect URI to `obsidian://inoreader-sync-auth`
3. Open the plugin settings in Obsidian
4. Enter your Client ID and Client Secret
5. Click "Connect to Inoreader" and complete the OAuth flow in your browser
6. Configure which articles to sync (annotated, tagged, or both)
7. Click "Sync" or use the ribbon icon to trigger your first sync

## Folder structure

Synced articles are organized under your configured output folder (default: `Inoreader/`):

```
Inoreader/
  annotations/
    Article Title.md
  tags/
    Tag Name/
      Another Article.md
```

## Template variables

### Article files

`{{title}}`, `{{author}}`, `{{url}}`, `{{feed_title}}`, `{{feed_url}}`, `{{published_date}}`, `{{highlights}}`, `{{content}}`, `{{highlight_count}}`, `{{tags}}`, `{{frontmatter}}`, `{{id}}`

### Periodic note entries

`{{title}}`, `{{url}}`, `{{author}}`, `{{feed_title}}`, `{{published_date}}`, `{{highlight_count}}`, `{{tags}}`, `{{id}}`

Use `{{#each highlights}}...{{/each}}` to iterate highlights, with `{{this.text}}`, `{{this.note}}`, `{{this.id}}`, `{{this.addedOn}}` inside the loop. Use `{{#if variable}}...{{/if}}` for conditional sections.

## Commands

- **Sync new articles** -- incremental sync since last run
- **Full resync** -- re-fetch and re-process all articles
- **Connect to Inoreader** -- start the OAuth authentication flow
- **Disconnect from Inoreader** -- clear stored credentials

## License

[MIT](LICENSE)
