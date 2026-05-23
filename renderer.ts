import { marked } from "marked";
import { markedSmartypants } from "marked-smartypants";

const renderer = new marked.Renderer();

renderer.image = ({ href, title, text }) => {
  return `<img src="${href}" alt="${text}"${
    title ? ` title="${title}"` : ""
  } loading="lazy" />`;
};

renderer.link = ({ href, title, text }) => {
  return `<a href="${href}"${
    title ? ` title="${title}"` : ""
  } target="_blank" rel="noopener noreferrer">${text}</a>`;
};

renderer.code = ({ text, lang }) => {
  if (lang === "mermaid") {
    return `<pre class="mermaid">${text}</pre>`;
  }

  const langClass = lang ? ` class="language-${lang}"` : "";
  return `<pre><code${langClass}>${text}</code></pre>`;
};

marked.use({
  gfm: true,
  breaks: true,
  renderer,
  async: false,
});

try {
  marked.use(markedSmartypants());
} catch {
  // smartypants is optional
}

export async function renderMarkdown(
  content: string,
): Promise<string> {
  const result = marked.parse(content);

  if (result instanceof Promise) {
    return await result;
  }

  return result;
}

export function htmlToSlack(html: string): string {
  let s = html;

  // Process in logical steps for better readability and maintainability
  s = processInlineFormatting(s);
  s = extractLinkText(s);
  s = processHeadings(s);
  s = processBlockElements(s);
  s = removeRemainingTags(s);
  s = decodeHtmlEntities(s);
  s = collapseWhitespace(s);

  return s.trim().substring(0, 2000);
}

function processInlineFormatting(html: string): string {
  return html
    .replace(/<(?:strong|b)>/gi, "*")
    .replace(/<\/(?:strong|b)>/gi, "*")
    .replace(/<(?:em|i)>/gi, "_")
    .replace(/<\/(?:em|i)>/gi, "_")
    .replace(/<(?:del|s|strike)>/gi, "~")
    .replace(/<\/(?:del|s|strike)>/gi, "~")
    .replace(/<code>/gi, "`")
    .replace(/<\/code>/gi, "`")
    .replace(/<blockquote>/gi, ">");
}

function extractLinkText(html: string): string {
  return html.replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, "$1");
}

function processHeadings(html: string): string {
  return html
    .replace(/<h[1-6][^>]*>/gi, "\n*")
    .replace(/<\/h[1-6]>/gi, "*\n");
}

function processBlockElements(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, "  \n")
    .replace(/<\/li>/gi, "")
    .replace(/<\/ol>/gi, "\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/blockquote>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/dt>/gi, "\n")
    .replace(/<\/dd>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n");
}

function removeRemainingTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8203;/g, "")
    .replace(/&#8217;/g, "'");
}

function collapseWhitespace(html: string): string {
  return html
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");
}
