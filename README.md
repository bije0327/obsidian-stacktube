# StackTube for Obsidian

Sync your **YouTube knowledge notes** straight into your Obsidian vault.

[StackTube](https://stacktube.io) monitors the YouTube channels you care about, runs each new video through an AI pipeline (Gemini + Claude), and turns it into a structured, searchable note. This plugin pulls those finished notes into your vault as plain Markdown — no lock‑in, you own the files.

> Videos stream by. Knowledge should stack up.

---

## What it does

- **Pulls** AI‑structured notes from the StackTube API into your vault on a schedule (or on demand).
- Writes clean Markdown with **YAML frontmatter** (`video_id`, `channel`, `title`, `video_url`, `published_at`, `language`, `tags`) so Dataview, graph view, and search just work.
- **No duplicates** — each video is written once, identified by `video_id`.
- **Resumes** where it left off after a restart.
- Your notes are ordinary `.md` files. Nothing is locked to this plugin.

This plugin is a thin client: all analysis happens on the StackTube server. The plugin only fetches and writes files.

---

## Requirements

- A [StackTube](https://stacktube.io) account with at least one monitored channel and some analyzed videos.
- A StackTube **API key** (Settings → Obsidian → *Create new key*). The key is shown once — copy it somewhere safe.

---

## Install

### From the Community Plugins (recommended, once approved)
1. Obsidian → **Settings → Community plugins → Browse**.
2. Search **“StackTube”**, install, and enable.

### Beta install via BRAT
1. Install the **BRAT** community plugin.
2. BRAT → *Add beta plugin* → `bije0327/obsidian-stacktube`.
3. Enable **StackTube** in Community plugins.

### Manual install
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/bije0327/obsidian-stacktube/releases).
2. Copy them into `<your vault>/.obsidian/plugins/stacktube/`.
3. Reload Obsidian and enable **StackTube** in Community plugins.

---

## Setup

1. Open **Settings → StackTube**.
2. Paste your **API key**.
3. (Optional) Adjust **Server URL** (default `https://stacktube.io`), **Notes folder** (default `StackTube`), and **Sync interval** (minutes; `0` = manual only).
4. Click **연결 테스트 / Test connection** — you should see a success notice with your plan.
5. Run **StackTube: Sync new notes** from the command palette, or wait for the next automatic sync.

Notes land in `<folder>/<channel>/<YYYY-MM-DD>-<title>.md`.

---

## Privacy & data ownership

The plugin talks only to the server URL you configure (StackTube by default), authenticated with your API key. It writes plain Markdown files into your vault — readable, portable, and yours. Your API key is stored locally in the plugin's `data.json` and is never logged.

---

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # type-check + production build → main.js
node --import tsx test/run.ts   # (or bundle test/run.ts) E2E against a mock server
```

See `test/run.ts` for the end‑to‑end harness (pagination, dedup, watermark resume, frontmatter, filename safety).

---

## License

MIT © unstackd
