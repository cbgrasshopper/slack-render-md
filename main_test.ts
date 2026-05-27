import { assertEquals } from "@std/assert";
import {
  kv,
  storeRenderContent,
  loadRenderContent,
  downloadFileContent,
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
