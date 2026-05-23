# AI Assistance Guidelines

## Project Overview

Slack app that renders Markdown files shared in Slack messages as styled HTML pages. Single Deno HTTP server handling Slack events, OAuth, Markdown rendering, and page serving.

## Architecture

- **`main.ts`** — single HTTP entry point: Slack interactive components, OAuth install/callback, `/render/:id` serving, landing page, debug endpoint
- **`renderer.ts`** — Markdown → HTML (`marked`) and HTML → Slack mrkdwn (`htmlToSlack`)
- **`oauth.ts`** — OAuth v2 flow: install URL generation and token callback handling
- **`slack-api.ts`** — Slack API client: `callApi`, `conversations.history`, `chat.postEphemeral`, `views.open`, `files.info`
- **`templates/render.html`** — HTML template loaded at startup
- **Deno KV** — stores render results (1h TTL) and OAuth tokens

## Key Files

| File | Purpose |
|---|---|
| `main.ts` | HTTP server, Slack event handling, OAuth routing, debug |
| `renderer.ts` | `renderMarkdown()`, `htmlToSlack()` |
| `slack-api.ts` | `SlackApi` class wrapping Slack Web API |
| `oauth.ts` | `OAuthHandler` for Slack OAuth v2 flow |
| `renderer_test.ts` | Tests for both renderer functions |
| `templates/render.html` | Page template (highlight.js, Mermaid, KaTeX) |

## Commands

- `deno task test` — fmt check + lint + test suite
- `deno task start` — run dev server (requires env vars)

## Testing

Tests in `renderer_test.ts` cover:
- `renderMarkdown` — formatting, code, tables, mermaid, links, lists, task lists, strikethrough, images, blockquotes, HR, empty input, line breaks
- `htmlToSlack` — inline formatting conversion, block-level conversion, entity decoding, whitespace collapse, length limit, `<pre>` tags, nested formatting

## Conventions

- No comments in source code
- Deno with TypeScript
- `marked` 15.x for Markdown parsing (GFM enabled, `breaks: true`)
- `htmlToSlack` converts rendered HTML to Slack mrkdwn for previews
- All async operations use top-level await or explicit `.catch()`
- Console.error used for server-side logging
- Prefer `assertStringIncludes` and `assertEquals` from `@std/assert`
- When adding new Markdown syntax support, add to both `renderMarkdown` tests and `htmlToSlack` tests
- Exported from `main.ts`: `kv` (Deno KV handle), `AuthData` interface
- Slack request signature verification uses `X-Slack-Signature` with HMAC-SHA256
