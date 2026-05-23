import { assertEquals } from "@std/assert";
import {
  kv,
  storeRenderContent,
  loadRenderContent,
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
