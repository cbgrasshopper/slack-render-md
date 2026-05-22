import { renderMarkdown } from "./renderer.ts";

const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CLIENT_ID = Deno.env.get("SLACK_CLIENT_ID") || "";
const SLACK_CLIENT_SECRET = Deno.env.get("SLACK_CLIENT_SECRET") || "";
const RENDERER_BASE = Deno.env.get("RENDERER_BASE") ||
  "https://slack-render-md.aliveonline.deno.net";

const kv = await Deno.openKv();
const RENDER_TTL = 60 * 60 * 1000;

interface RenderEntry {
  filename: string;
  html: string;
  created: number;
}

interface AuthData {
  botToken: string;
  userToken: string;
  userId: string;
  teamId: string;
}

const HTML_TEMPLATE = await Deno.readTextFile(
  new URL("./templates/render.html", import.meta.url),
);

function callSlackApi(
  token: string,
  method: string,
  data: Record<string, unknown>,
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    body.set(key, String(value));
  }
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

interface MdFile {
  name: string;
}

async function findMdFiles(payload: Record<string, unknown>): Promise<MdFile[]> {
  function isMd(f: Record<string, unknown>): boolean {
    return typeof f.name === "string" &&
      (f.name.endsWith(".md") || f.name.endsWith(".markdown"));
  }

  const message = payload.message as Record<string, unknown> | undefined;

  const channelId = ((payload.channel as Record<string, unknown>)?.id as string) ||
    (payload.channel_id as string) || "";
  const messageTs = (payload.message_ts as string) || (message?.ts as string) || "";

  if (!channelId || !messageTs) return [];

  const resp = await callSlackApi(SLACK_BOT_TOKEN, "conversations.history", {
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

  const mdFiles = msgFiles.filter(isMd);
  console.error("Found md files:", mdFiles.length);
  for (const f of mdFiles) {
    console.error("File:", JSON.stringify({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      filetype: f.filetype,
      hasPreview: !!f.preview,
      previewLen: (f.preview as string)?.length,
      hasUrlPrivate: !!f.url_private,
      urlPrivate: (f.url_private as string)?.substring(0, 80),
      hasUrlDownload: !!f.url_private_download,
      urlDownload: (f.url_private_download as string)?.substring(0, 80),
      urlPrivateFull: f.url_private,
      urlDownloadFull: f.url_private_download,
    }));
  }

  return mdFiles.map((f) => ({ name: f.name as string }));
}

async function downloadFileContent(
  fileId: string,
  userToken: string,
): Promise<string | null> {
  // Try user token with files.info
  const infoResp = await callSlackApi(userToken, "files.info", { file: fileId });
  const info = await infoResp.json();
  if (info.ok) {
    // Log all file fields to find content-bearing ones
    console.error("files.info file keys:", Object.keys(info.file).join(", "));

    // Check various content fields
    const fileContent = info.file?.content as string | undefined;
    const filePlainText = info.file?.plain_text as string | undefined;
    const filePreviewHighlight = info.file?.preview_highlight as string | undefined;
    if (fileContent) {
      console.error("files.info has 'content' field, len:", fileContent.length);
      return fileContent;
    }
    if (filePlainText) {
      console.error("files.info has 'plain_text' field, len:", filePlainText.length);
      return filePlainText;
    }
    // preview_highlight contains the full content as HTML-highlighted text
    if (filePreviewHighlight) {
      console.error("preview_highlight len:", filePreviewHighlight.length);
      // Strip HTML tags to get plain text content, decode entities
      const plainText = filePreviewHighlight
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      console.error("Extracted text length:", plainText.length);
      return plainText;
    }

    const preview = info.file?.preview as string | undefined;
    if (preview) return preview;
  }
  console.error("files.info with user token failed:", info.error);

  // Fall back: try CDN download with user token using url_private
  if (info.ok) {
    const url = info.file?.url_private_download || info.file?.url_private;
    if (url) {
      console.error("Trying CDN fallback with user token");
      const cdnResp = await fetch(`${url}?token=${userToken}`);
      if (cdnResp.ok) {
        const text = await cdnResp.text();
        if (!text.startsWith("<!DOCTYPE") && !text.startsWith("<html")) {
          return text;
        }
      }
    }
  }

  return null;
}

async function renderOneFile(
  fileName: string,
  fileId: string,
  userToken: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const content = await downloadFileContent(fileId, userToken);

  if (!content) {
    return { ok: false, error: `Could not get content for "${fileName}".` };
  }

  const html = await renderMarkdown(content, fileName);
  const id = crypto.randomUUID();

  const entry: RenderEntry = { filename: fileName, html, created: Date.now() };
  await kv.set(["renders", id], entry, { expireIn: RENDER_TTL });

  return { ok: true, id };
}

async function getAuthForUser(userId: string): Promise<AuthData | null> {
  const result = await kv.get<AuthData>(["auth", userId]);
  return result.value;
}

async function respond(
  payload: Record<string, unknown>,
  text: string,
  blocks: unknown[],
): Promise<void> {
  const responseUrl = payload.response_url as string | undefined;
  if (responseUrl) {
    const resp = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks, response_type: "ephemeral" }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("response_url error:", resp.status, body);
    }
    return;
  }

  const user = payload.user as Record<string, unknown> | undefined;
  const channel = payload.channel as Record<string, unknown> | undefined;
  const userId = (user?.id as string) || "";
  const channelId = (channel?.id as string) || "";

  const resp = await callSlackApi(SLACK_BOT_TOKEN, "chat.postEphemeral", {
    channel: channelId,
    user: userId,
    text,
    blocks,
  });
  const data = await resp.json();
  if (!data.ok) {
    console.error("chat.postEphemeral error:", data);
  }
}

async function handleFileAction(
  payload: Record<string, unknown>,
): Promise<void> {
  console.error("=== handleFileAction called ===");

  const user = payload.user as Record<string, unknown> | undefined;
  const channel = payload.channel as Record<string, unknown> | undefined;
  const userId = (user?.id as string) || "";
  const channelId = (channel?.id as string) || "";

  console.error("user:", userId, "channel:", channelId);

  if (!channelId || !userId) {
    console.error("Missing channel or user");
    return;
  }

  // Look up auth data for this user
  const auth = await getAuthForUser(userId);
  const userToken = auth?.userToken || "";
  if (!userToken) {
    await respond(
      payload,
      "Please install the app first via <https://slack-render-md.aliveonline.deno.net/slack/install|this link>.",
      [],
    );
    return;
  }

  const mdFiles = await findMdFiles(payload);
  console.error("Found .md files:", mdFiles.length);

  if (mdFiles.length === 0) {
    await respond(payload, "No Markdown files (.md) found in this message.", []);
    return;
  }

  // Get file IDs from the message
  const message = payload.message as Record<string, unknown> | undefined;
  const messageTs = (payload.message_ts as string) || (message?.ts as string) || "";

  const historyResp = await callSlackApi(SLACK_BOT_TOKEN, "conversations.history", {
    channel: channelId,
    latest: messageTs,
    limit: 1,
    inclusive: true,
  });
  const historyData = await historyResp.json();
  const msgFiles = historyData.ok ? (historyData.messages?.[0]?.files as Record<string, unknown>[] | undefined) : undefined;

  const results = await Promise.all(
    (msgFiles || []).map((f) => renderOneFile(f.name as string, f.id as string, userToken)),
  );

  const okResults = results.filter((r): r is { ok: true; id: string } => r.ok);
  const errors = results.filter((r): r is { ok: false; error: string } => !r.ok);

  console.error("okResults:", okResults.length, "errors:", errors.length);

  if (okResults.length === 0 && errors.length > 0) {
    const text = errors.map((e) => `\u274c ${e.error}`).join("\n");
    await respond(payload, text, []);
    return;
  }

  const blocks: unknown[] = [];

  const renderLinks = okResults.map((r) => {
    const renderUrl = `${RENDERER_BASE}/render/${r.id}`;
    return `<${renderUrl}|Open rendered file>`;
  }).join("\n");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: okResults.length === 1
        ? `*Rendered:*\n${renderLinks}`
        : `*Rendered ${okResults.length} Markdown files:*\n${renderLinks}`,
    },
  });

  if (errors.length > 0) {
    blocks.push({
      type: "context",
      elements: errors.map((e) => ({
        type: "mrkdwn",
        text: `\u26a0\ufe0f ${e.error}`,
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

  const botScopes = [
    "chat:write",
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ].join(",");

  const userScopes = ["files:read"].join(",");

  const url =
    `https://slack.com/oauth/v2/authorize` +
    `?client_id=${SLACK_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent("https://slack-render-md.aliveonline.deno.net/slack/oauth_redirect")}` +
    `&scope=${botScopes}` +
    `&user_scope=${userScopes}`;

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
    return new Response(`OAuth failed: ${data.error}`, { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  // Store auth data
  const auth: AuthData = {
    botToken: data.access_token as string,
    userToken: (data.authed_user?.access_token as string) || "",
    userId: (data.authed_user?.id as string) || "",
    teamId: data.team?.id as string || "",
  };

  if (auth.userId && auth.userToken) {
    await kv.set(["auth", auth.userId], auth);
  }

  // Update env-level bot token if we got one
  if (auth.botToken && !SLACK_BOT_TOKEN) {
    // Note: this only works for the current process; env var is not persisted
    // In production, the user should set SLACK_BOT_TOKEN from the dashboard
  }

  return new Response(
    "\u2705 slack-render-md installed successfully! You can close this window and try the shortcut again.",
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handleSlackRequest(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("ssl_check") === "1") {
      return new Response("OK", { status: 200 });
    }
    return new Response("OK", { status: 200 });
  }

  const rawBody = await req.text();

  if (rawBody.trim() === "ssl_check=1") {
    return new Response("OK", { status: 200 });
  }

  if (
    req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
  ) {
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

    if (payload.callback_id === "render_md_file") {
      handleFileAction(payload).catch((err) =>
        console.error("handleFileAction error:", err)
      );
    }
    return new Response("", { status: 200 });
  }

  try {
    const payload = JSON.parse(rawBody);
    if (payload.type === "url_verification") {
      return new Response(payload.challenge, {
        headers: { "Content-Type": "text/plain" },
      });
    }
  } catch {
    // ignore non-JSON bodies
  }

  return new Response("OK", { status: 200 });
}

async function handleViewRender(id: string): Promise<Response> {
  const result = await kv.get<RenderEntry>(["renders", id]);

  if (!result.value) {
    return new Response("Render not found or expired", { status: 404 });
  }

  const { filename, html } = result.value;
  const page = HTML_TEMPLATE.replaceAll("{{TITLE}}", () => filename).replace(
    "{{CONTENT}}",
    () => html,
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
    <li>\u2705 GFM tables, task lists, strikethrough</li>
    <li>\u2705 Mermaid diagrams</li>
    <li>\u2705 LaTeX math (KaTeX)</li>
    <li>\u2705 Syntax highlighting</li>
  </ul>
  <hr style="margin:2rem 0"/>
  <p><a href="/slack/install">Install App</a></p>
  <small>slack-render-md &middot; Deno Deploy</small>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleDebug(): Promise<Response> {
  let tokenInfo = "unknown";
  if (SLACK_BOT_TOKEN) {
    const resp = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    tokenInfo = JSON.stringify(await resp.json());
  }

  const info = {
    status: "ok",
    env: {
      hasBotToken: !!SLACK_BOT_TOKEN,
      botTokenPrefix: SLACK_BOT_TOKEN ? SLACK_BOT_TOKEN.substring(0, 10) + "..." : "",
      hasClientId: !!SLACK_CLIENT_ID,
      hasClientSecret: !!SLACK_CLIENT_SECRET,
      rendererBase: RENDERER_BASE,
    },
    authTest: tokenInfo,
  };

  return Response.json(info);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/debug") {
    return await handleDebug();
  }

  if (path.startsWith("/slack/events")) {
    return await handleSlackRequest(req);
  }

  if (path === "/slack/install") {
    return await handleOAuthInstall();
  }

  if (path === "/slack/oauth_redirect") {
    return await handleOAuthCallback(url);
  }

  if (path.startsWith("/render/")) {
    const id = path.split("/").pop() || "";
    return await handleViewRender(id);
  }

  return handleHome();
});
