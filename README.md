# Inoreader Sync

Sync highlights, annotations, and articles from [Inoreader](https://www.inoreader.com/) into your Obsidian vault.

## Features

- **Sync annotated articles** -- articles you've highlighted or annotated in Inoreader get their own markdown files with highlights as blockquotes and notes as plain text
- **Sync by tag** -- select which Inoreader tags to sync; each tag gets its own subfolder
- **Periodic note integration** -- optionally append or prepend article entries to your daily, weekly, monthly, quarterly, or yearly notes with an optional heading
- **Incremental sync** -- only fetches new articles since your last sync, with rate limit detection
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
   - Set the redirect URI to `https://justmytwospence.github.io/inoreader-obsidian/callback.html`
   - This is a static page hosted by this repository that bounces back into Obsidian via the `obsidian://` protocol. Inoreader no longer accepts custom-scheme redirect URIs directly. The URL is configurable in plugin settings if you want to host your own bouncer.
3. Open the plugin settings in Obsidian
4. Enter your Client ID and Client Secret
5. Click "Connect" and complete the OAuth flow in your browser
6. Configure which articles to sync (annotated, tagged, or both)
7. Click "Sync" or use the ribbon icon to trigger your first sync

### Upgrading from 0.18.0 or earlier

The redirect URI default changed in 0.18.1. Previously the plugin used `obsidian://inoreader-sync-auth`, but Inoreader's developer console now rejects custom URI schemes for new app registrations ([#1](https://github.com/justmytwospence/inoreader-obsidian/issues/1)).

If your existing Inoreader app registration with `obsidian://inoreader-sync-auth` is still working, you have two options:
- **Keep the old setup:** open plugin settings and set "Redirect URI" back to `obsidian://inoreader-sync-auth`. Nothing else changes.
- **Switch to the new default:** edit your Inoreader app at the developer console, change its redirect URI to `https://justmytwospence.github.io/inoreader-obsidian/callback.html`, then reconnect from plugin settings.

## Folder structure

Synced articles are organized under your configured output folder (default: `Inoreader/`):

```
Inoreader/
  Annotations/
    Article Title.md
  Tags/
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

- **Sync** -- fetch new annotations and tagged articles
- **Full resync** -- re-fetch and rewrite all articles (use after changing templates or settings)
- **Connect** -- start the OAuth authentication flow
- **Disconnect** -- clear stored credentials

## License

[MIT](LICENSE)
