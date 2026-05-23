import { htmlToSlack, renderMarkdown } from "./renderer.ts";
import { SlackApi } from "./slack-api.ts";
import { OAuthHandler } from "./oauth.ts";

const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") || "";
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") || "";
const SLACK_CLIENT_ID = Deno.env.get("SLACK_CLIENT_ID") || "";
const SLACK_CLIENT_SECRET = Deno.env.get("SLACK_CLIENT_SECRET") || "";
const RENDERER_BASE = Deno.env.get("RENDERER_BASE") ||
  "https://slack-render-md.aliveonline.deno.net";

export const kv = await Deno.openKv();
const RENDER_TTL_MS = 60 * 60 * 1000;

export interface AuthData {
  botToken: string;
  userToken: string;
  userId: string;
  teamId: string;
}

interface RenderEntry {
  filename: string;
  preview: string;
  created: number;
}

const CONTENT_CHUNK_SIZE = 60000;

async function storeRenderContent(
  id: string,
  content: string,
): Promise<void> {
  if (content.length <= CONTENT_CHUNK_SIZE) {
    await kv.set(["rc", id], content, { expireIn: RENDER_TTL_MS });
    return;
  }

  const chunkCount = Math.ceil(content.length / CONTENT_CHUNK_SIZE);
  await kv.set(["rc", id], { chunkCount }, { expireIn: RENDER_TTL_MS });
  for (let i = 0; i < chunkCount; i++) {
    await kv.set(
      ["rc", id, i],
      content.slice(i * CONTENT_CHUNK_SIZE, (i + 1) * CONTENT_CHUNK_SIZE),
      { expireIn: RENDER_TTL_MS },
    );
  }
}

async function loadRenderContent(
  id: string,
): Promise<string | null> {
  const meta = await kv.get<string | { chunkCount: number }>(["rc", id]);
  if (!meta.value) return null;
  if (typeof meta.value === "string") return meta.value;
  if (typeof meta.value === "object" && "chunkCount" in meta.value) {
    const parts: string[] = [];
    for (let i = 0; i < meta.value.chunkCount; i++) {
      const chunk = await kv.get<string>(["rc", id, i]);
      if (chunk.value === null) return null;
      parts.push(chunk.value);
    }
    return parts.join("");
  }
  return null;
}

interface SlackFile {
  id: string;
  name: string;
  mimetype?: string;
  filetype?: string;
  preview?: string;
  url_private?: string;
  url_private_download?: string;
}

interface SlackPayload {
  type?: string;
  trigger_id?: string;
  response_url?: string;
  callback_id?: string;
  channel?: { id?: string; name?: string };
  channel_id?: string;
  user?: { id?: string; name?: string };
  message?: { ts?: string; files?: SlackFile[] };
  message_ts?: string;
}

interface MdFile {
  name: string;
  id: string;
}

interface RenderOk {
  ok: true;
  id: string;
  preview: string;
  filename: string;
}

interface RenderErr {
  ok: false;
  error: string;
}

type RenderResult = RenderOk | RenderErr;

type SlackPayloadRecord = Record<string, unknown>;

const HTML_TEMPLATE = await Deno.readTextFile(
  new URL("./templates/render.html", import.meta.url),
);

const slackApi = new SlackApi(SLACK_BOT_TOKEN);
const oauthHandler = new OAuthHandler(SLACK_CLIENT_ID, SLACK_CLIENT_SECRET);

async function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string,
): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) return true;
  if (!timestamp || !signature) {
    console.error("verifySlackRequest: missing timestamp or signature");
    return false;
  }

  const parts = signature.split("=");
  if (parts[0] !== "v0" || !parts[1]) {
    console.error("verifySlackRequest: invalid signature format");
    return false;
  }

  const expectedSig = parts[1];
  const base = `v0:${timestamp}:${body}`;

  let computedSig: string;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SLACK_SIGNING_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(base),
    );
    computedSig = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (e) {
    console.error("verifySlackRequest: HMAC computation failed", e);
    return false;
  }

  if (expectedSig.length !== computedSig.length) {
    console.error("verifySlackRequest: signature length mismatch");
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= expectedSig.charCodeAt(i) ^ computedSig.charCodeAt(i);
  }
  if (mismatch) {
    console.error(
      "verifySlackRequest: signature mismatch",
      {
        expectedPrefix: expectedSig.slice(0, 8),
        computedPrefix: computedSig.slice(0, 8),
      },
    );
    return false;
  }

  return true;
}

async function findMdFiles(
  payload: SlackPayloadRecord,
): Promise<MdFile[]> {
  function isMd(f: SlackFile): boolean {
    return typeof f.name === "string" &&
      (f.name.endsWith(".md") || f.name.endsWith(".markdown"));
  }

  const message = payload.message as SlackPayloadRecord | undefined;

  if (message) {
    const payloadFiles = message.files as SlackFile[] | undefined;
    if (!payloadFiles || payloadFiles.length === 0) {
      console.error("findMdFiles: no files in payload message");
      return [];
    }
    const mdFiles = payloadFiles.filter(isMd);
    if (mdFiles.length === 0) {
      console.error("findMdFiles: no md files in payload message");
      return [];
    }
    console.error(
      "findMdFiles: found",
      mdFiles.length,
      "md files in payload",
    );
    return mdFiles.map((f) => ({
      name: f.name as string,
      id: f.id as string,
    }));
  }

  const channelId = ((payload.channel as SlackPayloadRecord)?.id as string) ||
    (payload.channel_id as string) || "";
  const messageTs = (payload.message_ts as string) || (message?.ts as string) ||
    "";

  if (!channelId || !messageTs) {
    console.error("findMdFiles: missing channelId or messageTs");
    return [];
  }

  const historyResult = await slackApi.getConversationHistory(
    channelId,
    messageTs,
  );
  if (historyResult.error === "not_in_channel") {
    throw new Error(
      "The bot has not been added to this channel. Please run `/invite @slack-render-md` in this channel, then try again.",
    );
  }
  if (!historyResult.messages) {
    console.error(
      "findMdFiles: conversations.history failed:",
      historyResult.error,
    );
    return [];
  }

  const msg = historyResult.messages[0];

  const msgFiles = msg.files as SlackFile[] | undefined;
  if (!msgFiles) {
    console.error("findMdFiles: no files in message");
    return [];
  }

  const mdFiles = msgFiles.filter(isMd);
  console.error("findMdFiles: md files found:", mdFiles.length);

  return mdFiles.map((f) => ({ name: f.name as string, id: f.id as string }));
}

async function downloadFileContent(
  fileId: string,
  userToken: string,
): Promise<string | null> {
  const fileApi = new SlackApi(userToken);
  const infoResult = await fileApi.getFileInfo(fileId);
  if (!infoResult.file) {
    return null;
  }

  const info = infoResult.file;
  const url = info.url_private_download || info.url_private;

  if (url) {
    console.error("Downloading file via CDN with Bearer auth");
    const cdnResp = await fetch(url, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (cdnResp.ok) {
      const text = await cdnResp.text();
      if (
        text.length > 0 &&
        !text.startsWith("<!DOCTYPE") &&
        !text.startsWith("<html")
      ) {
        console.error("CDN download succeeded, content length:", text.length);
        return text;
      }
    }
    console.error(
      "CDN download failed:",
      cdnResp.status,
      cdnResp.headers.get("content-type"),
    );
  }

  const preview = info.preview;
  if (preview) {
    console.error("Using preview, len:", preview.length);
    return preview;
  }

  return null;
}

async function renderOneFile(
  fileName: string,
  fileId: string,
  userToken: string,
): Promise<RenderResult> {
  const content = await downloadFileContent(fileId, userToken);

  if (!content) {
    return { ok: false, error: `Could not get content for "${fileName}".` };
  }

  const html = await renderMarkdown(content);
  const id = crypto.randomUUID();

  const preview = htmlToSlack(html);

  const entry: RenderEntry = {
    filename: fileName,
    preview,
    created: Date.now(),
  };
  await kv.set(["renders", id], entry, { expireIn: RENDER_TTL_MS });
  await storeRenderContent(id, content);

  return { ok: true, id, preview, filename: fileName };
}

async function getAuthForUser(userId: string): Promise<AuthData | null> {
  const result = await kv.get<AuthData>(["auth", userId]);
  return result.value;
}

async function respond(
  payload: SlackPayloadRecord,
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

  const user = payload.user as SlackPayloadRecord | undefined;
  const channel = payload.channel as SlackPayloadRecord | undefined;
  const userId = (user?.id as string) || "";
  const channelId = (channel?.id as string) || "";

  await slackApi.postEphemeral(channelId, userId, text, blocks);
}

function extractUserAndChannelIds(payload: SlackPayloadRecord) {
  const user = payload.user as SlackPayloadRecord | undefined;
  const channel = payload.channel as SlackPayloadRecord | undefined;
  return {
    userId: (user?.id as string) || "",
    channelId: (channel?.id as string) || "",
  };
}

async function showRenderResultsModal(
  payload: SlackPayloadRecord,
  okResults: RenderOk[],
  errors: RenderErr[],
  userToken: string,
): Promise<void> {
  const triggerId = payload.trigger_id as string | undefined;
  if (!triggerId) return;

  const blocks: unknown[] = [];

  for (const result of okResults) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*<${RENDERER_BASE}/render/${result.id}|${result.filename}>* rendered successfully!\n${result.preview}`,
      },
    });
    blocks.push({ type: "divider" });
  }

  for (const err of errors) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:x: ${err.error}`,
      },
    });
    blocks.push({ type: "divider" });
  }

  const view = {
    type: "modal",
    title: {
      type: "plain_text",
      text: okResults.length === 1 && errors.length === 0
        ? "Render Complete"
        : "Rendered Files",
    },
    close: { type: "plain_text", text: "Close" },
    blocks,
  };

  const userSlackApi = new SlackApi(userToken);
  await userSlackApi.openView(triggerId, view);
}

async function handleFileAction(
  payload: SlackPayloadRecord,
): Promise<void> {
  console.error("=== handleFileAction called ===");

  const { userId, channelId } = extractUserAndChannelIds(payload);
  console.error("user:", userId, "channel:", channelId);

  if (!channelId || !userId) {
    console.error("Missing channel or user");
    return;
  }

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

  const triggerId = payload.trigger_id as string | undefined;

  let mdFiles: MdFile[];
  try {
    mdFiles = await findMdFiles(payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("handleFileAction: findMdFiles error:", msg);
    if (triggerId) {
      const userSlackApi = new SlackApi(userToken);
      await userSlackApi.openView(triggerId, {
        type: "modal",
        title: { type: "plain_text", text: "Error" },
        close: { type: "plain_text", text: "Close" },
        blocks: [{ type: "section", text: { type: "mrkdwn", text: msg } }],
      });
    }
    return;
  }

  if (mdFiles.length === 0) {
    console.error("handleFileAction: no md files found");
    if (triggerId) {
      const userSlackApi = new SlackApi(userToken);
      await userSlackApi.openView(triggerId, {
        type: "modal",
        title: { type: "plain_text", text: "No Markdown Files" },
        close: { type: "plain_text", text: "Close" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "No Markdown files (.md) found in this message.",
            },
          },
        ],
      });
    }
    return;
  }

  if (!triggerId) return;

  if (mdFiles.length > 1) {
    const pickerBlocks = mdFiles.map((f) => ({
      type: "section",
      text: { type: "mrkdwn", text: f.name },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Render" },
        value: `${f.id}::${f.name}`,
        action_id: "pick_file",
      },
    }));

    const pickerView = {
      type: "modal",
      title: { type: "plain_text", text: "Select Markdown File" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${mdFiles.length} Markdown files found. Choose one:`,
          },
        },
        { type: "divider" },
        ...pickerBlocks,
      ],
    };

    const userSlackApi = new SlackApi(userToken);
    await userSlackApi.openView(triggerId, pickerView);
    return;
  }

  const result = await renderOneFile(mdFiles[0].name, mdFiles[0].id, userToken);

  if (!result.ok) {
    await respond(payload, `:x: ${result.error}`, []);
    return;
  }

  await showRenderResultsModal(payload, [result], [], userToken);
}

function handleOAuthInstall(): Response {
  try {
    const url = oauthHandler.getInstallUrl();
    return Response.redirect(url, 302);
  } catch {
    return new Response("App not configured for OAuth install", {
      status: 501,
    });
  }
}

async function handleOAuthCallback(url: URL): Promise<Response> {
  try {
    await oauthHandler.handleCallback(
      url.searchParams.get("code") || "",
    );

    return new Response(
      "\u2705 slack-render-md installed successfully! You can close this window and try the shortcut again.",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(`OAuth failed: ${msg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function handleBlockAction(
  payload: SlackPayloadRecord,
): Promise<void> {
  const actions = payload.actions as SlackPayloadRecord[] | undefined;
  if (!actions || actions.length === 0) return;

  const action = actions[0];
  if (action.action_id !== "pick_file") return;

  const value = action.value as string | undefined;
  if (!value) return;

  const parts = value.split("::");
  const fileId = parts[0];
  const fileName = parts[1] || "";
  if (!fileId || !fileName) return;

  const viewPayload = payload.view as SlackPayloadRecord | undefined;
  const viewId = viewPayload?.id as string | undefined;

  const user = payload.user as SlackPayloadRecord | undefined;
  const userId = user?.id as string | undefined;
  if (!userId) return;

  const triggerId = payload.trigger_id as string | undefined;

  const auth = await getAuthForUser(userId);
  if (!auth) return;

  const result = await renderOneFile(fileName, fileId, auth.userToken);

  const blocks: unknown[] = result.ok
    ? [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*<${RENDERER_BASE}/render/${result.id}|${result.filename}>* rendered successfully!\n${result.preview}`,
        },
      },
    ]
    : [
      {
        type: "section",
        text: { type: "mrkdwn", text: `:x: ${result.error}` },
      },
    ];

  const view = {
    type: "modal",
    title: { type: "plain_text", text: "Render Complete" },
    close: { type: "plain_text", text: "Close" },
    blocks,
  };

  const userSlackApi = new SlackApi(auth.userToken);

  if (viewId) {
    await userSlackApi.updateView(viewId, view);
  } else if (triggerId) {
    await userSlackApi.openView(triggerId, view);
  }
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

  const timestamp = req.headers.get("X-Slack-Request-Timestamp") || "";
  const signature = req.headers.get("X-Slack-Signature") || "";
  const verified = await verifySlackRequest(rawBody, timestamp, signature);
  if (!verified) {
    console.error("Slack request verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  if (
    req.headers.get("content-type")?.includes(
      "application/x-www-form-urlencoded",
    )
  ) {
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      return new Response("OK", { status: 200 });
    }

    let payload: SlackPayloadRecord;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return new Response("OK", { status: 200 });
    }

    if (payload.type === "block_actions") {
      handleBlockAction(payload).catch((err) =>
        console.error("handleBlockAction error:", err)
      );
      return new Response("", { status: 200 });
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
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return new Response("Invalid render ID", { status: 400 });
  }

  const result = await kv.get<RenderEntry>(["renders", id]);

  if (!result.value) {
    return new Response("Render not found or expired", { status: 404 });
  }

  const { filename } = result.value;
  const markdown = await loadRenderContent(id);
  if (markdown === null) {
    return new Response("Render content not found", { status: 404 });
  }
  const html = await renderMarkdown(markdown);
  const page = HTML_TEMPLATE
    .replaceAll("{{TITLE}}", filename)
    .replace("{{CONTENT}}", html);

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
      hasSigningSecret: !!SLACK_SIGNING_SECRET,
      hasBotToken: !!SLACK_BOT_TOKEN,
      botTokenPrefix: SLACK_BOT_TOKEN
        ? SLACK_BOT_TOKEN.substring(0, 10) + "..."
        : "",
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
    return handleOAuthInstall();
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
