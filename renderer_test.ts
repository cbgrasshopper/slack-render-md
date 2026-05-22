import { assertStringIncludes } from "@std/assert";
import { renderMarkdown } from "./renderer.ts";

Deno.test("renderMarkdown - basic formatting", async () => {
  const input = "# Hello\n\nThis is **bold** and *italic* text.";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, "<h1");
  assertStringIncludes(result, "Hello");
  assertStringIncludes(result, "<strong>");
  assertStringIncludes(result, "<em>");
});

Deno.test("renderMarkdown - code blocks", async () => {
  const input = "```ts\nconst x = 1;\n```";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, "language-ts");
  assertStringIncludes(result, "const x = 1");
});

Deno.test("renderMarkdown - tables", async () => {
  const input = "| A | B |\n|---|---|\n| 1 | 2 |";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, "<table");
  assertStringIncludes(result, "<th");
  assertStringIncludes(result, "<td");
});

Deno.test("renderMarkdown - mermaid code block", async () => {
  const input = "```mermaid\ngraph TD;\nA-->B;\n```";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, 'class="mermaid"');
  assertStringIncludes(result, "graph TD");
});

Deno.test("renderMarkdown - links open in new tab", async () => {
  const input = "[Click](https://example.com)";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, 'target="_blank"');
  assertStringIncludes(result, 'rel="noopener noreferrer"');
});

Deno.test("renderMarkdown - list rendering", async () => {
  const input = "- item 1\n- item 2\n- item 3";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, "<ul>");
  assertStringIncludes(result, "<li>item 1</li>");
  assertStringIncludes(result, "<li>item 2</li>");
  assertStringIncludes(result, "<li>item 3</li>");
});

Deno.test("renderMarkdown - task list", async () => {
  const input = "- [x] done\n- [ ] todo";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, 'checked=""');
  assertStringIncludes(result, "todo");
});

Deno.test("renderMarkdown - strikethrough", async () => {
  const input = "~~strikethrough~~";
  const result = await renderMarkdown(input, "test.md");
  assertStringIncludes(result, "<del>");
  assertStringIncludes(result, "strikethrough");
});
