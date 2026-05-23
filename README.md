# slack-render-md

A Slack app that renders Markdown files shared in Slack messages as rich, styled HTML pages with syntax highlighting, Mermaid diagrams, and math formula support.

## Features

- **GitHub-Flavored Markdown** — tables, task lists, strikethrough, headings, lists, and more
- **Syntax Highlighting** — code blocks highlighted by [highlight.js](https://highlightjs.org/) with language auto-detection
- **Mermaid Diagrams** — render flowcharts, sequence diagrams, Gantt charts, and more from `` ```mermaid `` fenced code blocks
- **KaTeX Math** — inline (`$...$`) and display (`$$...$$`) math expressions rendered by [KaTeX](https://katex.org/)
- **Smart Typography** — curly quotes, em-dashes, and ellipses via `marked-smartypants`
- **Light/Dark Mode** — automatic theme switching based on system preference
- **Links open in new tab** — all links get `target="_blank"` and `rel="noopener noreferrer"`
- **Lazy-loaded images** — images use `loading="lazy"` for performance
- **Modal popups** — results and errors are shown in modals, not ephemeral messages
- **OAuth flow** — users install the app to grant `files:read` scope for downloading file contents

## How It Works

```
User clicks "Render Markdown" on a message with a .md file
        │
        ▼
┌──────────────────────────────────┐
│ Single Deno HTTP server          │  main.ts
│                                  │
│ 1. Receive Slack shortcut        │
│    (message action payload)      │
│ 2. Look up user OAuth token      │
│    from Deno KV                  │
│ 3. Extract .md files from        │
│    payload.message.files         │
│    (no conversations.history     │
│    needed — works anywhere)      │
│ 4. Download file content via     │
│    files.info + CDN (or preview  │
│    text fallback)                │
│ 5. Render Markdown → HTML via    │
│    marked; convert preview to    │
│    Slack mrkdwn                  │
│ 6. Store raw Markdown in Deno KV │
│    (1h TTL; auto-chunked into    │
│    60KB pieces for large files)  │
│ 7. Open Slack modal with         │
│    preview and "Open rendered"   │
│    link                          │
└────────┬─────────────────────────┘
         │  /render/{id}
         ▼
   Re-render Markdown → HTML on demand
         │
         ▼
   serve styled page (highlight.js,
   Mermaid, KaTeX)
```

The entire app is a single Deno HTTP server that handles:
- **Slack Events** — interactive component payloads (message shortcuts)
- **OAuth** — install flow with `oauth.v2.access`
- **Rendering** — Markdown → HTML conversion, on-demand for every page load
- **Serving** — renders Markdown with a styled template (highlight.js, Mermaid, KaTeX)

## Prerequisites

- [Deno](https://deno.com/) 1.40+
- A [Slack workspace](https://slack.com/get-started) where you can install apps
- A Slack app with Interactivity, OAuth, and the `files:read` user scope enabled

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/your-username/slack-render-md.git
cd slack-render-md
```

The project uses Deno, which resolves dependencies at runtime. No install step is needed.

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) |
| `SLACK_CLIENT_ID` | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Slack app client secret |
| `RENDERER_BASE` | Public base URL (defaults to `https://slack-render-md.aliveonline.deno.net`) |

### 3. Run locally

```bash
deno task start
```

This starts the server at `http://localhost:8080`.

For local development with Slack, use [ngrok](https://ngrok.com/) or a similar tunnel to expose your local server, then configure the Slack app's Request URL to point to your tunnel.

### 4. Configure your Slack App

In the [Slack API dashboard](https://api.slack.com/apps):

1. Create a new app (or use an existing one)
2. Enable **Interactivity & Shortcuts** → add a **Message Shortcut** with callback ID `render_md_file`
3. Add **OAuth & Permissions** — set Redirect URL to `https://your-domain/slack/oauth_redirect`
4. Add bot scopes: `chat:write`, `channels:history`, `groups:history`, `im:history`, `mpim:history`
5. Add user scope: `files:read`
6. Copy the **Bot Token**, **Client ID**, and **Client Secret** to your `.env`

### 5. Deploy to Deno Deploy

```bash
deno task deploy
```

Or push to `main` — the GitHub Actions workflow deploys automatically.

## Usage

1. In Slack, find any message that contains a Markdown file (`.md` or `.markdown` extension).
2. Hover over the message, open the **More actions** menu (three dots), and select **Render Markdown file**.
3. If you haven't installed the app, you'll be prompted to install (grants `files:read` for downloading files).
4. If multiple `.md` files are attached, a modal picker shows each file with a **Render** button — click one to render that file.
5. The app opens a modal with a plain-text preview and a link to open the full rendered Markdown.
6. Click the link to view the rendered HTML page with syntax highlighting, diagrams, and math.
7. The app does **not** need to be invited to channels or DMs — it works from any message action menu.

## Project Structure

```
├── .github/workflows/
│   └── deploy.yml            # Deploy to Deno Deploy
├── templates/
│   └── render.html           # HTML template with highlight.js, Mermaid, KaTeX
├── main.ts                   # Single HTTP server (Slack events, OAuth, rendering)
├── main_test.ts              # Tests for KV storage
├── renderer.ts               # Markdown → HTML + HTML → Slack mrkdwn
├── renderer_test.ts          # Tests for renderer
├── .env.example              # Environment variable template
├── deno.jsonc                # Deno configuration, tasks, dependencies
└── AGENTS.md                 # AI assistance guidelines
```

## Testing

```bash
deno task test
```

This runs `deno fmt --check`, `deno lint`, and the test suite. Tests cover:

| Module | Tests |
|---|---|
| `renderMarkdown` | Basic formatting, code blocks, tables, mermaid, links, lists, task lists, strikethrough, images, blockquotes, HR, headings |
| `htmlToSlack` | Bold, italic, strikethrough, code, links, headings, paragraphs, line breaks, lists, HR, blockquotes, HTML entities, whitespace collapse, length limit, empty input |
| KV storage | Inline content, chunked content (over 60KB), empty string, boundary values, unicode, missing key |

## Configuration

### Bot Scopes

- `chat:write` — send messages (required for fallback ephemeral replies)
- `files:read` (user scope) — download file contents via CDN

> `channels:history`, `groups:history`, `im:history`, and `mpim:history` are **not required** for the primary flow — the app reads `.md` files directly from the message action payload. They're only needed as a fallback if Slack changes the payload format.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | [Deno](https://deno.com/) |
| Markdown Parser | [marked](https://marked.js.org/) 15.x |
| Smart Typography | [marked-smartypants](https://www.npmjs.com/package/marked-smartypants) |
| Syntax Highlighting | [highlight.js](https://highlightjs.org/) 11.x |
| Diagrams | [Mermaid](https://mermaid.js.org/) 10.x |
| Math | [KaTeX](https://katex.org/) 0.16.x |
| Markdown CSS | [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) |
| Persistence | [Deno KV](https://deno.com/kv) |
| Hosting | [Deno Deploy](https://deno.com/deploy) |

## License

[MIT](LICENSE)
