import { renderMarkdown } from "./renderer.ts";

interface RenderEntry {
  filename: string;
  html: string;
  created: number;
}

const kv = await Deno.openKv();

const RENDER_TTL = 60 * 60 * 1000; // 1 hour

const HTML_TEMPLATE = await Deno.readTextFile(
  new URL("./templates/render.html", import.meta.url),
);

async function handleRender(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { filename, content } = body;

  if (!content || typeof content !== "string") {
    return Response.json({ error: "Missing 'content' field" }, { status: 400 });
  }

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

async function handleView(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop();

  if (!id) {
    return new Response("Not found", { status: 404 });
  }

  const result = await kv.get<RenderEntry>(["renders", id]);

  if (!result.value) {
    return new Response("Render not found or expired", { status: 404 });
  }

  const { filename, html } = result.value;
  const page = HTML_TEMPLATE
    .replace("{{TITLE}}", filename)
    .replace("{{CONTENT}}", html);

  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleHome(): Response {
  const html = `<html><body style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto;text-align:center;margin-top:4rem">
    <h1>slack-render-md</h1>
    <p>Renders Markdown files shared in Slack as rich HTML pages.</p>
    <p>Use the Slack app to render Markdown files.</p>
    <hr style="margin:2rem 0"/>
    <small>slack-render-md &middot; Deno Deploy</small>
  </body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/api/render") {
    return await handleRender(req);
  }

  if (url.pathname.startsWith("/render/")) {
    return await handleView(req);
  }

  return handleHome();
});
