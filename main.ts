import { renderMarkdown } from "./renderer.ts";

const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") || "";
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

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string,
): Promise<boolean> {
  const sigBaseString = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(sigBaseString);

  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${hashHex}`;
  return timingSafeEqual(encoder.encode(expected), encoder.encode(signature));
}

function callSlackApi(
  method: string,
  data: Record<string, unknown>,
): Promise<Response> {
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
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

  const entry: RenderEntry = { filename: filename || "document.md", html, created: Date.now() };
  await kv.set(["renders", id], entry, { expireIn: RENDER_TTL });

  return Response.json({ id });
}

async function handleFileAction(payload: Record<string, unknown>): Promise<void> {
  const user = payload.user as Record<string, unknown> | undefined;
  const channel = payload.channel as Record<string, unknown> | undefined;
  const message = payload.message as Record<string, unknown> | undefined;

  // Files can be at payload.file (file actions) or payload.message.files (message shortcuts)
  let file = payload.file as Record<string, unknown> | undefined;
  if (!file && message) {
    const files = message.files as Record<string, unknown>[] | undefined;
    if (files && files.length > 0) {
      file = files.find((f) =>
        typeof f.name === "string" &&
        (f.name.endsWith(".md") || f.name.endsWith(".markdown"))
      );
    }
  }

  if (!file) return;

  const fileName = (file.name as string) || "document.md";
  const fileId = file.id as string;
  const userId = (user?.id as string) || "";
  const channelId = (channel?.id as string) || "";

  const fileInfoResp = await callSlackApi("files.info", { file: fileId });
  const fileInfo = await fileInfoResp.json();

  if (!fileInfo.ok) {
    await callSlackApi("chat.postEphemeral", {
      channel: channelId,
      user: userId,
      text: `Could not get file info for "${fileName}".`,
    });
    return;
  }

  const downloadUrl = fileInfo.file?.url_private_download || fileInfo.file?.url_private;
  if (!downloadUrl) {
    await callSlackApi("chat.postEphemeral", {
      channel: channelId,
      user: userId,
      text: `Could not get download URL for "${fileName}".`,
    });
    return;
  }

  const fileContentResp = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });

  if (!fileContentResp.ok) {
    await callSlackApi("chat.postEphemeral", {
      channel: channelId,
      user: userId,
      text: `Failed to download "${fileName}".`,
    });
    return;
  }

  const fileContent = await fileContentResp.text();
  const html = await renderMarkdown(fileContent, fileName);
  const id = crypto.randomUUID();

  const entry: RenderEntry = { filename: fileName, html, created: Date.now() };
  await kv.set(["renders", id], entry, { expireIn: RENDER_TTL });

  const renderUrl = RENDERER_BASE
    ? `${RENDERER_BASE}/render/${id}`
    : `/render/${id}`;

  await callSlackApi("chat.postEphemeral", {
    channel: channelId,
    user: userId,
    text: `Rendered "${fileName}"`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Rendered:* ${fileName}` },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open rendered Markdown" },
            url: renderUrl,
            action_id: "open_rendered",
          },
        ],
      },
    ],
  });
}

function handleOAuthInstall(): Response {
  if (!SLACK_CLIENT_ID) {
    return new Response("App not configured for OAuth install", { status: 501 });
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
  const rawBody = await req.text();

  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (SLACK_SIGNING_SECRET && !(await verifySlackRequest(rawBody, timestamp, signature))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;

  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload") || "";
    payload = JSON.parse(payloadStr);
  } else {
    payload = JSON.parse(rawBody);
  }

  // URL verification challenge
  if (payload.type === "url_verification") {
    return new Response(payload.challenge as string, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Handle file shortcuts & actions
  if (
    payload.type === "shortcut" &&
    (payload.callback_id === "render_md_file")
  ) {
    handleFileAction(payload);
    return new Response("", { status: 200 });
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

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/slack/events") {
    return await handleSlackRequest(req);
  }

  if (url.pathname === "/slack/install") {
    return handleOAuthInstall();
  }

  if (url.pathname === "/slack/oauth_redirect") {
    return await handleOAuthCallback(url);
  }

  if (url.pathname === "/api/render") {
    return await handleRenderApi(req);
  }

  if (url.pathname.startsWith("/render/")) {
    const id = url.pathname.split("/").pop() || "";
    return await handleViewRender(id);
  }

  return handleHome();
});
