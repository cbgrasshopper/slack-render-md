import { renderMarkdown } from "./renderer.ts";

const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CLIENT_ID = Deno.env.get("SLACK_CLIENT_ID") || "";
const SLACK_CLIENT_SECRET = Deno.env.get("SLACK_CLIENT_SECRET") || "";
const RENDERER_BASE = Deno.env.get("RENDERER_BASE") || "";

const kv = await Deno.openKv();
const RENDER_TTL = 60 * 60 * 1000;

interface RenderEntry {
  filename: string;
  html: string;
  created: number;
}

const HTML_TEMPLATE = await Deno.readTextFile(
  new URL("./templates/render.html", import.meta.url),
);

function callSlackApi(
  method: string,
  data: Record<string, unknown>,
): Promise<Response> {
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

async function handleRenderApi(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { filename, download_url, token } = body;

  if (!download_url || typeof download_url !== "string") {
    return Response.json({ error: "Missing 'download_url' field" }, {
      status: 400,
    });
  }

  const fileResponse = await fetch(download_url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!fileResponse.ok) {
    return Response.json({
      error: `Failed to download file: ${fileResponse.status}`,
    }, { status: 502 });
  }

  const content = await fileResponse.text();
  const html = await renderMarkdown(content, filename || "document.md");
  const id = crypto.randomUUID();

  const entry: RenderEntry = {
    filename: filename || "document.md",
    html,
    created: Date.now(),
  };
  await kv.set(["renders", id], entry, { expireIn: RENDER_TTL });

  return Response.json({ id });
}

interface MdFile {
  name: string;
  downloadUrl: string;
}

async function findMdFiles(payload: Record<string, unknown>): Promise<MdFile[]> {
  function isMd(f: Record<string, unknown>): boolean {
    return typeof f.name === "string" &&
      (f.name.endsWith(".md") || f.name.endsWith(".markdown"));
  }

  function toMdFile(f: Record<string, unknown>): MdFile {
    return {
      name: f.name as string,
      downloadUrl: (f.url_private_download || f.url_private) as string,
    };
  }

  // Check payload.file (file actions)
  if (payload.file) {
    const f = payload.file as Record<string, unknown>;
    if (isMd(f) && (f.url_private_download || f.url_private)) {
      return [toMdFile(f)];
    }
  }

  // Check payload.message.files (some payloads include files)
  const message = payload.message as Record<string, unknown> | undefined;
  if (message?.files) {
    const files = message.files as Record<string, unknown>[];
    const found = files.filter(isMd).filter((f) => f.url_private_download || f.url_private);
    if (found.length > 0) return found.map(toMdFile);
  }

  // Fetch message via API to get file download URLs
  const channelId = ((payload.channel as Record<string, unknown>)?.id as string) ||
    (payload.channel_id as string) || "";
  const messageTs = (payload.message_ts as string) || (message?.ts as string) || "";

  if (!channelId || !messageTs) return [];

  const resp = await callSlackApi("conversations.history", {
    channel: channelId,
    latest: messageTs,
    limit: 1,
    inclusive: true,
  });
  const data = await resp.json();

  if (!data.ok || !data.messages || data.messages.length === 0) {
    console.error("conversations.history failed:", data);
    return [];
  }

  const msgFiles = data.messages[0].files as Record<string, unknown>[] | undefined;
  if (!msgFiles) return [];

  return msgFiles
    .filter(isMd)
    .filter((f) => f.url_private_download || f.url_private)
    .map(toMdFile);
}

async function renderOneFile(
  file: MdFile,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!file.downloadUrl) {
    return { ok: false, error: `No download URL for "${file.name}".` };
  }

  const fileContentResp = await fetch(file.downloadUrl, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });

  if (!fileContentResp.ok) {
    console.error("File download failed:", file.downloadUrl, fileContentResp.status);
    return { ok: false, error: `Failed to download "${file.name}".` };
  }

  const fileContent = await fileContentResp.text();
  const html = await renderMarkdown(fileContent, file.name);
  const id = crypto.randomUUID();

  const entry: RenderEntry = { filename: file.name, html, created: Date.now() };
  await kv.set(["renders", id], entry, { expireIn: RENDER_TTL });

  return { ok: true, id };
}

async function respond(
  payload: Record<string, unknown>,
  text: string,
  blocks: unknown[],
): Promise<void> {
  // Prefer response_url when available (message shortcuts provide it)
  const responseUrl = payload.response_url as string | undefined;
  if (responseUrl) {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks, response_type: "ephemeral" }),
    });
    return;
  }

  const user = payload.user as Record<string, unknown> | undefined;
  const channel = payload.channel as Record<string, unknown> | undefined;
  const userId = (user?.id as string) || "";
  const channelId = (channel?.id as string) || "";

  await callSlackApi("chat.postEphemeral", {
    channel: channelId,
    user: userId,
    text,
    blocks,
  });
}

async function handleFileAction(
  payload: Record<string, unknown>,
): Promise<void> {
  console.error("=== handleFileAction called ===");
  console.error("Payload keys:", Object.keys(payload).join(", "));
  console.error("callback_id:", payload.callback_id);

  const user = payload.user as Record<string, unknown> | undefined;
  const channel = payload.channel as Record<string, unknown> | undefined;
  const userId = (user?.id as string) || "";
  const channelId = (channel?.id as string) || "";

  console.error("user:", userId, "channel:", channelId);

  if (!channelId || !userId) {
    console.error("Missing channel or user");
    return;
  }

  const mdFiles = await findMdFiles(payload);

  console.error("Found .md files:", mdFiles.length);

  if (mdFiles.length === 0) {
    await respond(payload, "No Markdown files (.md) found in this message.", []);
    return;
  }

  const results = await Promise.all(mdFiles.map(renderOneFile));

  const okResults = results.filter((r): r is { ok: true; id: string } => r.ok);
  const errors = results.filter((r): r is { ok: false; error: string } => !r.ok);

  console.error("okResults:", okResults.length, "errors:", errors.length);

  if (okResults.length === 0 && errors.length > 0) {
    const text = errors.map((e) => `❌ ${e.error}`).join("\n");
    await respond(payload, text, []);
    return;
  }

  const blocks: unknown[] = [];

  if (okResults.length === 1) {
    const idx = okResults[0];
    const file = mdFiles[results.indexOf(idx)];
    const renderUrl = RENDERER_BASE
      ? `${RENDERER_BASE}/render/${idx.id}`
      : `/render/${idx.id}`;

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Rendered:* ${file.name}` },
    });
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "Open rendered Markdown" },
        url: renderUrl,
        action_id: "open_rendered",
      }],
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Rendered ${okResults.length} Markdown files:*`,
      },
    });

    const elements: unknown[] = [];
    okResults.forEach((r, i) => {
      const file = mdFiles[results.indexOf(r)];
      const renderUrl = RENDERER_BASE
        ? `${RENDERER_BASE}/render/${r.id}`
        : `/render/${r.id}`;

      elements.push({
        type: "button",
        text: { type: "plain_text", text: `${file.name}` },
        url: renderUrl,
        action_id: `open_${i}`,
      });
    });
    blocks.push({ type: "actions", elements });
  }

  if (errors.length > 0) {
    blocks.push({
      type: "context",
      elements: errors.map((e) => ({
        type: "mrkdwn",
        text: `⚠️ ${e.error}`,
      })),
    });
  }

  await respond(payload, `Rendered ${okResults.length} Markdown file(s)`, blocks);
}

function handleOAuthInstall(): Response {
  if (!SLACK_CLIENT_ID) {
    return new Response("App not configured for OAuth install", {
      status: 501,
    });
  }

  const scopes = [
    "files:read",
    "chat:write",
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ].join(",");

  const url =
    `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=${scopes}&user_scope=`;

  return Response.redirect(url, 302);
}

async function handleOAuthCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
    }),
  });

  const data = await resp.json();
  if (!data.ok) {
    return new Response(`OAuth failed: ${data.error}`, { status: 500 });
  }

  return new Response(
    "✅ slack-render-md installed successfully! You can close this window.",
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handleSlackRequest(req: Request): Promise<Response> {
  // Handle GET requests for URL verification
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("ssl_check") === "1") {
      return new Response("OK", { status: 200 });
    }
    return new Response("OK", { status: 200 });
  }

  const rawBody = await req.text();

  // Handle SSL verification (POST with ssl_check=1)
  if (rawBody.trim() === "ssl_check=1") {
    return new Response("OK", { status: 200 });
  }

  // Handle form-encoded payload (message shortcuts, actions)
  if (
    req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
  ) {
    console.error("Form-encoded request body:", rawBody.substring(0, 200));

    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      return new Response("OK", { status: 200 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return new Response("OK", { status: 200 });
    }

    console.error("Payload type:", payload.type, "callback:", payload.callback_id);

    if (payload.callback_id === "render_md_file") {
      handleFileAction(payload).catch((err) =>
        console.error("handleFileAction error:", err)
      );
    }
    return new Response("", { status: 200 });
  }

  // Handle JSON body (Events API, url_verification)
  try {
    const payload = JSON.parse(rawBody);

    if (payload.type === "url_verification") {
      return new Response(payload.challenge, {
        headers: { "Content-Type": "text/plain" },
      });
    }
  } catch {
    // ignore parse errors
  }

  return new Response("OK", { status: 200 });
}

async function handleViewRender(id: string): Promise<Response> {
  const result = await kv.get<RenderEntry>(["renders", id]);

  if (!result.value) {
    return new Response("Render not found or expired", { status: 404 });
  }

  const { filename, html } = result.value;
  const page = HTML_TEMPLATE.replace("{{TITLE}}", filename).replace(
    "{{CONTENT}}",
    html,
  );

  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleHome(): Response {
  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto;text-align:center;margin-top:4rem">
  <h1>slack-render-md</h1>
  <p>Renders Markdown files shared in Slack as rich HTML pages.</p>
  <ul style="list-style:none;padding:0;margin-top:1rem">
    <li>✅ GFM tables, task lists, strikethrough</li>
    <li>✅ Mermaid diagrams</li>
    <li>✅ LaTeX math (KaTeX)</li>
    <li>✅ Syntax highlighting</li>
  </ul>
  <hr style="margin:2rem 0"/>
  <small>slack-render-md &middot; Deno Deploy</small>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleDebug(): Response {
  const info = {
    status: "ok",
    env: {
      hasBotToken: !!SLACK_BOT_TOKEN,
      botTokenPrefix: SLACK_BOT_TOKEN ? SLACK_BOT_TOKEN.substring(0, 10) + "..." : "",
      hasClientId: !!SLACK_CLIENT_ID,
      hasClientSecret: !!SLACK_CLIENT_SECRET,
      rendererBase: RENDERER_BASE,
    },
  };

  return Response.json(info);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/debug") {
    return handleDebug();
  }

  // Any request to /slack/* goes to the Slack handler
  if (path.startsWith("/slack/events")) {
    return await handleSlackRequest(req);
  }

  if (path === "/slack/install") {
    return handleOAuthInstall();
  }

  if (path === "/slack/oauth_redirect") {
    return await handleOAuthCallback(url);
  }

  if (path === "/api/render") {
    return await handleRenderApi(req);
  }

  if (path.startsWith("/render/")) {
    const id = path.split("/").pop() || "";
    return await handleViewRender(id);
  }

  return handleHome();
});
