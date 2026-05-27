# AI Assistance Guidelines

## Project Overview

Slack app that renders Markdown files shared in Slack messages as styled HTML pages. Single Deno HTTP server handling Slack events, OAuth, Markdown rendering, and page serving.

## Architecture

- **`main.ts`** — single HTTP entry point: Slack interactive components, OAuth install/callback, `/render/:id` serving, landing page, debug endpoint
- **`renderer.ts`** — Markdown → HTML (`marked`) and HTML → Slack mrkdwn (`htmlToSlack`)
- **`oauth.ts`** — OAuth v2 flow: install URL generation and token callback handling
- **`slack-api.ts`** — Slack API client: `callApi`, `conversations.history`, `views.open`, `views.update`
- **`templates/render.html`** — HTML template loaded at startup
- **Deno KV** — stores render metadata (1h TTL) and OAuth tokens; content over 60KB is chunked across multiple KV keys at `["rc", id, i]`

## Key Files

| File | Purpose |
|---|---|
| `main.ts` | HTTP server, Slack event handling, OAuth routing, debug |
| `renderer.ts` | `renderMarkdown()`, `htmlToSlack()` |
| `slack-api.ts` | `SlackApi` class wrapping Slack Web API |
| `oauth.ts` | `OAuthHandler` for Slack OAuth v2 flow |
| `renderer_test.ts` | 41 tests for both renderer functions |
| `main_test.ts` | 8 tests for KV content storage/retrieval |
| `templates/render.html` | Page template (highlight.js, Mermaid, KaTeX) |

## Commands

- `deno task test` — fmt check + lint + test suite
- `deno task start` — run dev server (requires env vars)

## Testing

### renderer_test.ts (41 tests)

- `renderMarkdown` — formatting, code, tables, mermaid, links, lists, task lists, strikethrough, images, blockquotes, HR, empty input, line breaks
- `htmlToSlack` — inline formatting conversion, block-level conversion, entity decoding, whitespace collapse, length limit, `<pre>` tags, nested formatting

### main_test.ts (8 tests)

- `storeRenderContent` / `loadRenderContent` — small inline, large chunked (>64KB), empty string, boundary at chunk size, just over boundary, unicode content, missing key

## Key Behaviors

- **File detection**: `findMdFiles` extracts `.md` files from `payload.message.files` directly (message actions include the full message). Falls back to `conversations.history` only when `payload.message` is absent. This means the bot does NOT need `channels:history`/`im:history` etc. for the primary flow — it works in any channel or DM without being invited.
- **Error display**: All errors and messages are shown as modal popups (`views.open`) instead of ephemeral messages.
- **KV storage**: Markdown content is stored raw (not pre-rendered HTML). Content ≤60KB is stored inline at `["rc", id]`. Larger content is split into 60KB chunks at `["rc", id, i]` with a `{ chunkCount: N }` manifest at `["rc", id]`. All use the 1h TTL. On demand, `handleViewRender` reads the content and calls `renderMarkdown` to produce HTML.
- **Multi-file flow**: When multiple `.md` files are attached, a modal picker shows per-file `Render` buttons (no submit button). Clicking a button renders that file and replaces the modal content in-place via `views.update`.
- **OAuth**: `oauth.ts` imports `{ kv }` and `type { AuthData }` from `./main.ts` with `import type` to avoid circular import issues.
- **SLACK_SIGNING_SECRET**: optional; when set, `verifySlackRequest` enforces HMAC-SHA256. Bot must be installed with `files:read` bot scope for file downloads. File content is fetched via CDN URL from the payload (no `files.info` call), so the bot works in any channel without being invited.

## Conventions

- No comments in source code
- Deno with TypeScript
- `marked` 15.x for Markdown parsing (GFM enabled, `breaks: true`)
- `htmlToSlack` converts rendered HTML to Slack mrkdwn for previews (2000-char max)
- All async operations use top-level await or explicit `.catch()`
- Console.error used for server-side logging
- Prefer `assertStringIncludes` and `assertEquals` from `@std/assert`
- When adding new Markdown syntax support, add to both `renderMarkdown` tests and `htmlToSlack` tests
- Exported from `main.ts`: `kv` (Deno KV handle), `AuthData` interface, `storeRenderContent`, `loadRenderContent`
- Slack request signature verification uses `X-Slack-Signature` with HMAC-SHA256
