const WORD_BOUND = " \n\r\t";

function inRanges(code: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([lower, upper]) => lower <= code && code <= upper);
}

/** CJK ranges of the reading-time package (see countWords). */
const CJK_RANGES = [
  [0x3040, 0x309f], // hiragana
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xac00, 0xd7a3], // hangul
  [0x20000, 0x2ebe0], // CJK extensions
] as const;

const PUNCTUATION_RANGES = [
  [0x21, 0x2f],
  [0x3a, 0x40],
  [0x5b, 0x60],
  [0x7b, 0x7e],
  [0x3000, 0x303f], // CJK symbols and punctuation
  [0xff00, 0xffef], // full-width ASCII variants
] as const;

function isCjk(char: string | undefined): boolean {
  if (typeof char !== "string" || char === "") return false;
  return inRanges(char.charCodeAt(0), CJK_RANGES);
}

function isWordBound(char: string | undefined): boolean {
  return typeof char === "string" && WORD_BOUND.includes(char);
}

function isPunctuation(char: string | undefined): boolean {
  if (typeof char !== "string" || char === "") return false;
  return inRanges(char.charCodeAt(0), PUNCTUATION_RANGES);
}

/**
 * Mixed CJK/Latin word count, ported from the reading-time package Firefly uses in
 * src/plugins/remark-reading-time.mjs: every CJK character counts as one word and
 * Latin runs are split on whitespace, so the Studio agrees with the site.
 */
export function countWords(text: string): number {
  if (text === "") return 0;
  let start = 0;
  let end = text.length - 1;
  while (start <= end && isWordBound(text[start])) start++;
  while (end >= start && isWordBound(text[end])) end--;
  if (start > end) return 0;

  const normalized = `${text}\n`;
  let words = 0;
  for (let i = start; i <= end; i++) {
    if (
      isCjk(normalized[i]) ||
      (!isWordBound(normalized[i]) && (isWordBound(normalized[i + 1]) || isCjk(normalized[i + 1])))
    ) {
      words++;
    }
    if (isCjk(normalized[i])) {
      while (i <= end && (isPunctuation(normalized[i + 1]) || isWordBound(normalized[i + 1]))) i++;
    }
  }
  return words;
}

/**
 * Markdown to plain text, following what mdast-util-to-string keeps: markup and links
 * disappear, link/image text and code content stay.
 */
export function markdownToPlainText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, "\n");
  text = text.replace(/(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1/g, "$2");
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "");
  text = text.replace(/^[ \t]*\|.*\|[ \t]*$/gm, (row) => row.replace(/\|/g, " "));
  text = text.replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, "");
  text = text.replace(/::[a-z-]+\{[^}]*\}/g, "");
  text = text.replace(/^[ \t]*:::{1,}[a-z-]*[ \t]*$/gm, "");
  text = text.replace(/[*_~]{1,3}/g, "");
  return text;
}

export const EXCERPT_MAX_CHARS = 150;

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Excerpt of a post: the first paragraph (like Firefly's remark-excerpt plugin, headings and
 * code fences are skipped), markdown removed, flattened and truncated.
 */
export function excerptOf(body: string, maxChars: number = EXCERPT_MAX_CHARS): string {
  for (const block of body.split(/\n[ \t]*\n/)) {
    const trimmed = block.trim();
    if (trimmed === "") continue;
    if (/^(`{3,}|~{3,})/.test(trimmed)) continue;
    if (/^#{1,6}[ \t]/.test(trimmed)) continue;
    if (/^(?:<!--|import[ \t]|export[ \t]|:::|<[A-Za-z/])/.test(trimmed)) continue;
    const flat = flatten(markdownToPlainText(trimmed));
    if (flat !== "") return truncate(flat, maxChars);
  }
  return truncate(flatten(markdownToPlainText(body)), maxChars);
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
