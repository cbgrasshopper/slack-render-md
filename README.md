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
- **Ephemeral reply** — the rendered link is shown only to the user who triggered the action

## How It Works

```
User clicks "Render Markdown" on a message with a .md file
        │
        ▼
┌────────────────────────┐
│ Slack Message Shortcut │  triggers/render_md_trigger.ts
└────────┬───────────────┘
         │
         ▼
┌────────────────────────┐
│ Slack Function         │  functions/render_md.ts
│                        │
│ 1. Fetch message via   │
│    conversations.history
│ 2. Find .md file       │
│ 3. Download raw content│
│ 4. POST to renderer    │
│ 5. Reply with button   │
└────────┬───────────────┘
         │  POST /api/render
         ▼
┌────────────────────────┐
│ Web Renderer (Deno)    │  web/main.ts
│                        │
│ • Renders Markdown →   │
│   HTML (marked)        │
│ • Stores in Deno KV    │
│   (1-hour TTL)         │
│ • Serves at            │
│   /render/{id}         │
└────────┬───────────────┘
         │  Deployed to Deno Deploy
         ▼
   slack-render-md.deno.dev
```

The project has two parts:

1. **Slack App** — a [Deno Slack SDK](https://deno.land/x/deno_slack_sdk) app with a message shortcut trigger, a workflow, and a function that fetches Markdown files from Slack and sends them to the renderer.
2. **Web Renderer** — a Deno HTTP server (designed for [Deno Deploy](https://deno.com/deploy)) that converts Markdown to HTML using [marked](https://marked.js.org/), stores the result in Deno KV with a 1-hour TTL, and serves it as a styled webpage.

## Prerequisites

- [Deno](https://deno.com/) 1.40+
- [Slack CLI](https://api.slack.com/automation/cli) — for developing and deploying the Slack app
- A [Slack workspace](https://slack.com/get-started) where you can install apps

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/your-username/slack-render-md.git
cd slack-render-md
```

The project uses Deno, which resolves dependencies at runtime. No install step is needed.

### 2. Configure environment

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `RENDERER_URL` | URL of the web renderer service (defaults to `http://localhost:8080` for local dev) |
| `SLACK_BOT_TOKEN` | Slack bot token (set automatically by Slack when running via `slack run`) |

### 3. Start the web renderer locally

```bash
deno task start:web
```

This starts the renderer at `http://localhost:8080`.

### 4. Run the Slack app locally

In a separate terminal:

```bash
slack run
```

This starts the Slack function runner and connects it to your Slack workspace. The trigger will be available as a message shortcut.

### 5. Create the trigger

The first time you run the app, create the trigger so it appears in Slack:

```bash
slack trigger create --trigger-definition triggers/render_md_trigger.ts
```

## Usage

1. In Slack, find any message that contains a Markdown file (`.md` or `.markdown` extension).
2. Hover over the message, open the **More actions** menu (three dots), and select **Render Markdown file**.
3. The app sends you an ephemeral message with a button: **Open rendered Markdown**.
4. Click the button to view the rendered HTML page with syntax highlighting, diagrams, and math.

## Project Structure

```
├── .github/workflows/
│   └── deploy-web.yml        # Deploys web renderer to Deno Deploy
├── .slack/
│   ├── config.json           # Slack CLI project config
│   └── hooks.json            # Slack CLI hooks
├── functions/
│   └── render_md.ts          # Slack function: fetches .md from Slack, POSTs to renderer
├── triggers/
│   └── render_md_trigger.ts  # Message shortcut trigger definition
├── web/
│   ├── deps.ts               # External dependency re-exports
│   ├── main.ts               # HTTP server: /api/render + /render/:id + /
│   ├── renderer.ts           # Markdown → HTML conversion (marked + smartypants)
│   ├── renderer_test.ts      # Tests for the renderer
│   └── templates/
│       └── render.html       # HTML template with highlight.js, Mermaid, KaTeX
├── workflows/
│   └── render_md_workflow.ts # Workflow definition
├── .env.example              # Environment variable template
├── deno.jsonc                # Deno configuration, tasks, dependencies
└── manifest.ts               # Slack app manifest
```

## Testing

```bash
deno task test
```

This runs `deno fmt --check`, `deno lint`, and the test suite. Tests cover:
- Basic formatting (headings, bold, italic)
- Code blocks with language classes
- Table rendering
- Mermaid code blocks
- Links (open in new tab)
- Lists and task lists
- Strikethrough

## Deployment

### Web Renderer (Deno Deploy)

The renderer is automatically deployed to Deno Deploy via GitHub Actions on every push to `main` that changes files in `web/` or `deno.jsonc`. Manual deployment:

```bash
deno task deploy:web
```

This requires the [Deno Deploy CLI](https://deno.com/deploy/docs/deployctl) (`deployctl`) and a Deno Deploy project named `slack-render-md`.

### Slack App

Deploy the Slack app with:

```bash
slack deploy
```

This packages the manifest, functions, workflows, and triggers and deploys them to Slack's infrastructure.

## Configuration

### Outgoing Domains

The app manifest allows outgoing traffic to these domains:
- `render-md.deno.dev` — the web renderer
- `slack.com` — Slack API
- `cdn.jsdelivr.net` — KaTeX, Mermaid CDN resources

### Bot Scopes

- `channels:history` — read channel messages
- `groups:history` — read private channel messages
- `im:history` — read direct messages
- `mpim:history` — read group direct messages
- `files:read` — read file metadata and content
- `chat:write` — send messages
- `chat:write.public` — send messages to public channels

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | [Deno](https://deno.com/) |
| Slack SDK | [deno-slack-sdk](https://deno.land/x/deno_slack_sdk) |
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
