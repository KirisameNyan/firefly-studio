/**
 * Markdown preview for the post editor.
 *
 * Decision (to be aligned with A5): rendering happens in the renderer with `marked` — the frozen
 * contract exposes no renderMarkdown channel, and src/core/posts/render.ts is not reachable from the
 * sandboxed renderer. The generated HTML passes through an allow-list sanitizer before it reaches
 * dangerouslySetInnerHTML.
 */
import { marked } from 'marked'

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  input: ['type', 'checked', 'disabled'],
  td: ['align', 'colspan', 'rowspan'],
  th: ['align', 'colspan', 'rowspan'],
  ol: ['start'],
  code: ['class'],
  span: ['class'],
  div: ['class'],
  li: ['class'],
}

marked.setOptions({ gfm: true, breaks: false })

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html')
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      const allowed = ALLOWED_ATTRS[tag] ?? []
      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase()
        if (!allowed.includes(name) || name.startsWith('on')) child.removeAttribute(attribute.name)
      }
      if (tag === 'a') {
        child.setAttribute('rel', 'noreferrer noopener')
        child.setAttribute('target', '_blank')
      }
      if (tag === 'input') child.setAttribute('disabled', 'true')
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

export type RenderedMarkdown = { html: string; error: string | null }

export function renderMarkdown(source: string): RenderedMarkdown {
  try {
    const html = marked.parse(source ?? '', { async: false }) as string
    return { html: sanitize(html), error: null }
  } catch (error) {
    return { html: '', error: error instanceof Error ? error.message : String(error) }
  }
}
