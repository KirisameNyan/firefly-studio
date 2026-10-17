import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: false, async: false });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders a post body (frontmatter excluded) to HTML. GFM is on, so tables and task lists
 * work; raw HTML in the source is passed through, just like Astro renders these posts.
 * MDX bodies render as Markdown — JSX and import lines appear as plain text.
 */
export function renderMarkdown(body: string): string {
  if (typeof body !== "string" || body === "") return "";
  try {
    const html = marked.parse(body, { async: false });
    return typeof html === "string" ? html : "";
  } catch {
    return `<p>${escapeHtml(body)}</p>\n`;
  }
}
