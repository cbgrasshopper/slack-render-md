import { assertEquals } from "@std/assert";
import {
  kv,
  storeRenderContent,
  loadRenderContent,
  downloadFileContent,
  extractCodeBlocks,
  type AuthData,
} from "./main.ts";

Deno.test("storeRenderContent / loadRenderContent - small inline", async () => {
  const id = crypto.randomUUID();
  const content = "Hello, world!";
  await storeRenderContent(id, content);
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, content);
  await kv.delete(["rc", id]);
});

Deno.test("storeRenderContent / loadRenderContent - large chunked", async () => {
  const id = crypto.randomUUID();
  const content = "x".repeat(70000);
  await storeRenderContent(id, content);
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, content);
  assertEquals(loaded!.length, 70000);
  await kv.delete(["rc", id]);
});

Deno.test("storeRenderContent / loadRenderContent - empty string", async () => {
  const id = crypto.randomUUID();
  const content = "";
  await storeRenderContent(id, content);
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, "");
  await kv.delete(["rc", id]);
});

Deno.test("loadRenderContent - missing key returns null", async () => {
  const id = crypto.randomUUID();
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, null);
});

Deno.test("storeRenderContent / loadRenderContent - boundary at chunk size", async () => {
  const id = crypto.randomUUID();
  const content = "x".repeat(60000);
  await storeRenderContent(id, content);
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, content);
  assertEquals(loaded!.length, 60000);
  await kv.delete(["rc", id]);
});

Deno.test("storeRenderContent / loadRenderContent - just over chunk boundary", async () => {
  const id = crypto.randomUUID();
  const content = "x".repeat(60001);
  await storeRenderContent(id, content);
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, content);
  assertEquals(loaded!.length, 60001);
  await kv.delete(["rc", id]);
});

Deno.test("storeRenderContent / loadRenderContent - unicode content", async () => {
  const id = crypto.randomUUID();
  const content = "Hello 世界 🌍! こんにちは".repeat(1000);
  await storeRenderContent(id, content);
  const loaded = await loadRenderContent(id);
  assertEquals(loaded, content);
  await kv.delete(["rc", id]);
});

Deno.test("AuthData type is exported", () => {
  const auth: AuthData = {
    botToken: "test",
    userToken: "test",
    userId: "U123",
    teamId: "T456",
  };
  assertEquals(auth.userId, "U123");
});

Deno.test("downloadFileContent - falls back to preview when all tokens fail", async () => {
  const result = await downloadFileContent("", "preview text", ["token"]);
  assertEquals(result, "preview text");
});

Deno.test("downloadFileContent - returns null when no URL or preview", async () => {
  const result = await downloadFileContent("", "", ["token"]);
  assertEquals(result, null);
});

Deno.test("downloadFileContent - tries tokens in order, uses first success", async () => {
  let callCount = 0;
  const handler = (req: Request) => {
    callCount++;
    const auth = req.headers.get("Authorization");
    if (auth === "Bearer bad-token") {
      return new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (auth === "Bearer good-token") {
      return new Response("# Full Markdown Content", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  };

  const server = Deno.serve({ port: 8765, onListen: () => {} }, handler);

  try {
    const url = "http://localhost:8765/test";

    const result = await downloadFileContent(url, "preview", [
      "bad-token",
      "good-token",
    ]);
    assertEquals(result, "# Full Markdown Content");
    assertEquals(callCount, 2);
  } finally {
    await server.shutdown();
  }
});

Deno.test("downloadFileContent - stops after first successful token", async () => {
  let callCount = 0;
  const handler = (req: Request) => {
    callCount++;
    return new Response("# Hello", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  };

  const server = Deno.serve({ port: 8766, onListen: () => {} }, handler);

  try {
    const url = "http://localhost:8766/test";

    const result = await downloadFileContent(url, "preview", [
      "good-token",
      "also-good-token",
    ]);
    assertEquals(result, "# Hello");
    assertEquals(callCount, 1);
  } finally {
    await server.shutdown();
  }
});

Deno.test("extractCodeBlocks - single block with lang", () => {
  const text = "```markdown\n# Hello\n**bold**\n```";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].lang, "markdown");
  assertEquals(blocks[0].content, "# Hello\n**bold**");
});

Deno.test("extractCodeBlocks - single block without lang", () => {
  const text = "```\nplain content\n```";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].lang, "");
  assertEquals(blocks[0].content, "plain content");
});

Deno.test("extractCodeBlocks - multiple blocks", () => {
  const text = "```js\nconst x = 1;\n```\n```markdown\n# Title\n```";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 2);
  assertEquals(blocks[0].lang, "js");
  assertEquals(blocks[1].lang, "markdown");
  assertEquals(blocks[1].content, "# Title");
});

Deno.test("extractCodeBlocks - no blocks", () => {
  const text = "just regular text";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 0);
});

Deno.test("extractCodeBlocks - empty input", () => {
  const blocks = extractCodeBlocks("");
  assertEquals(blocks.length, 0);
});

Deno.test("extractCodeBlocks - block with surrounding text", () => {
  const text = "Check this:\n\n```md\n# Hello\n```\n\nMore text";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].lang, "md");
  assertEquals(blocks[0].content, "# Hello");
});

Deno.test("extractCodeBlocks - skips empty blocks", () => {
  const text = "```\n\n```";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 0);
});

Deno.test("extractCodeBlocks - lang is lowercased", () => {
  const text = "```MarkDown\n# Title\n```";
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].lang, "markdown");
});

Deno.test("extractCodeBlocks - nested code blocks inside markdown block", () => {
  const text = [
    "```markdown",
    "# Datadog Logs Missing",
    "",
    "## Root Cause",
    "",
    "```csharp",
    "var host = new HostBuilder()",
    "```",
    "",
    "```json",
    '{"key": "value"}',
    "```",
    "",
    "End",
    "```",
  ].join("\n");
  const blocks = extractCodeBlocks(text);
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].lang, "markdown");
  assertEquals(blocks[0].content.includes("```csharp"), true);
  assertEquals(blocks[0].content.includes("```json"), true);
  assertEquals(blocks[0].content.includes("var host = new HostBuilder()"), true);
  assertEquals(blocks[0].content.includes("End"), true);
});
