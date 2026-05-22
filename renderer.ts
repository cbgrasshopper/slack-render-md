import { marked } from "marked";
import { markedSmartypants } from "marked-smartypants";

const renderer = new marked.Renderer();

renderer.image = ({ href, title, text }) => {
  return `<img src="${href}" alt="${text}"${title ? ` title="${title}"` : ""} loading="lazy" />`;
};

renderer.link = ({ href, title, text }) => {
  return `<a href="${href}"${title ? ` title="${title}"` : ""} target="_blank" rel="noopener noreferrer">${text}</a>`;
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

export async function renderMarkdown(content: string, _filename: string): Promise<string> {
  const result = marked.parse(content);

  if (result instanceof Promise) {
    return await result;
  }

  return result;
}
