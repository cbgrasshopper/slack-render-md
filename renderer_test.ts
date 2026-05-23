import { assertEquals, assertStringIncludes } from "@std/assert";
import { htmlToSlack, renderMarkdown } from "./renderer.ts";

Deno.test("renderMarkdown - basic formatting", async () => {
  const input = "# Hello\n\nThis is **bold** and *italic* text.";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<h1");
  assertStringIncludes(result, "Hello");
  assertStringIncludes(result, "<strong>");
  assertStringIncludes(result, "<em>");
});

Deno.test("renderMarkdown - code blocks", async () => {
  const input = "```ts\nconst x = 1;\n```";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "language-ts");
  assertStringIncludes(result, "const x = 1");
});

Deno.test("renderMarkdown - tables", async () => {
  const input = "| A | B |\n|---|---|\n| 1 | 2 |";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<table");
  assertStringIncludes(result, "<th");
  assertStringIncludes(result, "<td");
});

Deno.test("renderMarkdown - mermaid code block", async () => {
  const input = "```mermaid\ngraph TD;\nA-->B;\n```";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, 'class="mermaid"');
  assertStringIncludes(result, "graph TD");
});

Deno.test("renderMarkdown - links open in new tab", async () => {
  const input = "[Click](https://example.com)";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, 'target="_blank"');
  assertStringIncludes(result, 'rel="noopener noreferrer"');
});

Deno.test("renderMarkdown - list rendering", async () => {
  const input = "- item 1\n- item 2\n- item 3";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<ul>");
  assertStringIncludes(result, "<li>item 1</li>");
  assertStringIncludes(result, "<li>item 2</li>");
  assertStringIncludes(result, "<li>item 3</li>");
});

Deno.test("renderMarkdown - task list", async () => {
  const input = "- [x] done\n- [ ] todo";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, 'checked=""');
  assertStringIncludes(result, "todo");
});

Deno.test("renderMarkdown - strikethrough", async () => {
  const input = "~~strikethrough~~";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<del>");
  assertStringIncludes(result, "strikethrough");
});

Deno.test("renderMarkdown - images", async () => {
  const input = "![alt](https://example.com/img.png)";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, '<img src="https://example.com/img.png"');
  assertStringIncludes(result, 'alt="alt"');
  assertStringIncludes(result, 'loading="lazy"');
});

Deno.test("renderMarkdown - heading with ID", async () => {
  const input = "# Hello World";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "Hello World");
});

Deno.test("renderMarkdown - blockquote", async () => {
  const input = "> blockquote text";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<blockquote");
});

Deno.test("renderMarkdown - horizontal rule", async () => {
  const input = "---";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<hr");
});

Deno.test("renderMarkdown - code without lang", async () => {
  const input = "```\nplain code\n```";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<pre><code");
  assertStringIncludes(result, "plain code");
});

Deno.test("renderMarkdown - empty input", async () => {
  const result = await renderMarkdown("");
  assertEquals(result, "");
});

Deno.test("renderMarkdown - line breaks enabled", async () => {
  const input = "line1\nline2\nline3";
  const result = await renderMarkdown(input);
  assertStringIncludes(result, "<br>");
});

Deno.test("htmlToSlack - bold", () => {
  const result = htmlToSlack("<strong>bold</strong>");
  assertEquals(result, "*bold*");
});

Deno.test("htmlToSlack - italic", () => {
  const result = htmlToSlack("<em>italic</em>");
  assertEquals(result, "_italic_");
});

Deno.test("htmlToSlack - strikethrough", () => {
  const result = htmlToSlack("<del>struck</del>");
  assertEquals(result, "~struck~");
});

Deno.test("htmlToSlack - inline code", () => {
  const result = htmlToSlack("<code>const x = 1</code>");
  assertEquals(result, "`const x = 1`");
});

Deno.test("htmlToSlack - links stripped to text", () => {
  const result = htmlToSlack('<a href="https://example.com">click here</a>');
  assertEquals(result, "click here");
});

Deno.test("htmlToSlack - headings become bold", () => {
  const result = htmlToSlack("<h1>Title</h1>");
  assertEquals(result, "*Title*");
});

Deno.test("htmlToSlack - paragraphs become double newlines", () => {
  const result = htmlToSlack("<p>para1</p><p>para2</p>");
  assertEquals(result, "para1\n\npara2");
});

Deno.test("htmlToSlack - line break becomes newline", () => {
  const result = htmlToSlack("line1<br>line2");
  assertEquals(result, "line1\nline2");
});

Deno.test("htmlToSlack - lists", () => {
  const result = htmlToSlack("<ul><li>a</li><li>b</li></ul>");
  assertStringIncludes(result, "a");
  assertStringIncludes(result, "b");
});

Deno.test("htmlToSlack - horizontal rule", () => {
  const result = htmlToSlack("<hr>");
  assertEquals(result, "---");
});

Deno.test("htmlToSlack - blockquote", () => {
  const result = htmlToSlack("<blockquote>quote</blockquote>");
  assertEquals(result, ">quote");
});

Deno.test("htmlToSlack - HTML entities", () => {
  const result = htmlToSlack("&amp; &lt; &gt; &quot; &#39;");
  assertEquals(result, "& < > \" '");
});

Deno.test("htmlToSlack - whitespace collapse", () => {
  const result = htmlToSlack("  a  \n\n\n\n  b  ");
  assertEquals(result, "a\n\n\nb");
});

Deno.test("htmlToSlack - nested <b> tags also work for bold", () => {
  const result = htmlToSlack("<b>bold</b>");
  assertEquals(result, "*bold*");
});

Deno.test("htmlToSlack - <i> tags also work for italic", () => {
  const result = htmlToSlack("<i>italic</i>");
  assertEquals(result, "_italic_");
});

Deno.test("htmlToSlack - <s> and <strike> tags for strikethrough", () => {
  assertEquals(htmlToSlack("<s>text</s>"), "~text~");
  assertEquals(htmlToSlack("<strike>text</strike>"), "~text~");
});

Deno.test("htmlToSlack - table rows become newlines", () => {
  const result = htmlToSlack("<table><tr><td>a</td></tr></table>");
  assertEquals(result, "a");
});

Deno.test("htmlToSlack - tr creates newline separator", () => {
  const result = htmlToSlack("<tr>r1</tr><tr>r2</tr>");
  assertEquals(result, "r1\nr2");
});

Deno.test("htmlToSlack - limit to 2000 characters", () => {
  const long = "x".repeat(3000);
  const result = htmlToSlack(long);
  assertEquals(result.length, 2000);
});

Deno.test("htmlToSlack - empty input", () => {
  const result = htmlToSlack("");
  assertEquals(result, "");
});

Deno.test("htmlToSlack - smart quotes entity", () => {
  const result = htmlToSlack("&#8217;");
  assertEquals(result, "'");
});

Deno.test("htmlToSlack - zero-width space", () => {
  const result = htmlToSlack("&#8203;");
  assertEquals(result, "");
});

Deno.test("htmlToSlack - pre tag (code block) handling", () => {
  const result = htmlToSlack("<pre><code>console.log('hi');</code></pre>");
  assertEquals(result, "`console.log('hi');`");
});

Deno.test("htmlToSlack - nested formatting", () => {
  const result = htmlToSlack(
    "<p><strong>bold</strong> and <em>italic</em></p>",
  );
  assertEquals(result, "*bold* and _italic_");
});

Deno.test("htmlToSlack - heading level 2", () => {
  const result = htmlToSlack("<h2>Subtitle</h2>");
  assertEquals(result, "*Subtitle*");
});

Deno.test("htmlToSlack - ordered list items", () => {
  const result = htmlToSlack("<ol><li>first</li><li>second</li></ol>");
  assertStringIncludes(result, "first");
  assertStringIncludes(result, "second");
});
