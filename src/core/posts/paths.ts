import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Extensions Firefly's content loader accepts for posts. */
const POST_EXT = /\.(md|mdx)$/i;

/** Layouts tried when locating the posts directory, in order. */
const POSTS_DIR_CANDIDATES = ["src/content/posts", "content/posts", "posts"];

export class PostsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostsError";
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves the posts directory. `root` is normally the Firefly project root, but the
 * posts directory itself (or a repo keeping posts at the top level) is accepted too.
 */
export function resolvePostsDir(root: string): string {
  for (const candidate of POSTS_DIR_CANDIDATES) {
    const dir = path.join(root, candidate);
    if (isDirectory(dir)) return dir;
  }
  if (path.basename(root) === "posts" && isDirectory(root)) return root;
  return path.join(root, "src/content/posts");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** Stable id of a post: path relative to the project root, POSIX separators. */
export function postId(root: string, file: string): string {
  return toPosix(path.relative(root, file));
}

/** All .md/.mdx files below `postsDir`, sorted by path. Dot directories are skipped. */
export function listPostFiles(postsDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && POST_EXT.test(entry.name)) files.push(full);
    }
  };
  walk(postsDir);
  return files;
}

/** Resolves a post id to an absolute path, refusing anything outside the posts directory. */
export function resolvePostPath(root: string, id: string): string {
  if (typeof id !== "string" || id.trim() === "") throw new PostsError("post id is empty");
  if (!POST_EXT.test(id)) throw new PostsError(`not a markdown post: ${id}`);
  const postsDir = resolvePostsDir(root);
  const abs = path.resolve(root, id);
  const rel = path.relative(postsDir, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PostsError(`post id escapes the posts directory: ${id}`);
  }
  return abs;
}

/** Slug derived from the file path, as in scripts/new-post.js: no extension, no trailing /index. */
export function slugFromPath(postsDir: string, file: string): string {
  const stem = toPosix(path.relative(postsDir, file)).replace(POST_EXT, "");
  return stem.endsWith("/index") ? stem.slice(0, -"/index".length) : stem;
}

/** Converts one CJK character to tone-less pinyin. */
export type PinyinFn = (char: string) => string | undefined;

const CJK_CHAR = /[\u4e00-\u9fff]/;

let ownPinyin: PinyinFn | null | undefined;
const projectPinyin = new Map<string, PinyinFn | null>();

function pinyinFrom(specifier: string, from: string): PinyinFn | undefined {
  try {
    const require = createRequire(from);
    const mod = require(specifier) as { pinyin?: (text: string, options?: unknown) => unknown };
    if (typeof mod?.pinyin !== "function") return undefined;
    const pinyin = mod.pinyin.bind(mod);
    return (char: string) => {
      const result = pinyin(char, { toneType: "none", type: "array" });
      return Array.isArray(result) && result.length > 0 ? String(result[0]) : undefined;
    };
  } catch {
    return undefined;
  }
}

/**
 * pinyin-pro is optional for the Studio. new-post.js romanises CJK names with it, so it is
 * first looked up in the Studio's own node_modules and then in the opened project's.
 * Without it CJK characters are kept verbatim instead of being romanised.
 */
export function pinyinForRoot(root?: string): PinyinFn | undefined {
  if (ownPinyin === undefined) {
    // Joined at runtime so a bundler never tries to resolve an optional dependency.
    ownPinyin = pinyinFrom(["pinyin", "pro"].join("-"), import.meta.url) ?? null;
  }
  if (ownPinyin) return ownPinyin;
  if (!root) return undefined;
  if (!projectPinyin.has(root)) {
    projectPinyin.set(root, pinyinFrom("pinyin-pro", path.join(root, "package.json")) ?? null);
  }
  return projectPinyin.get(root) ?? undefined;
}

/**
 * Title to slug, ported from scripts/new-post.js: a segment without CJK is kept verbatim,
 * a segment containing CJK is romanised, lowercased, stripped to [a-z0-9-] and dash-collapsed.
 */
export function slugifyTitle(title: string, pinyin: PinyinFn | undefined = pinyinForRoot()): string {
  return title
    .trim()
    .split("/")
    .map((segment) => slugifySegment(segment, pinyin))
    .filter((segment) => segment !== "")
    .join("/");
}

/** `slugifyTitle` plus a fallback for titles that romanise to nothing. */
export function slugifyTitleOrFallback(title: string, pinyin?: PinyinFn): string {
  const slug = slugifyTitle(title, pinyin);
  if (slug !== "") return slug;
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]+/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "post"
  );
}

function slugifySegment(segment: string, pinyin: PinyinFn | undefined): string {
  if (!CJK_CHAR.test(segment)) return sanitizeSegment(segment);
  const parts: string[] = [];
  let buffer = "";
  for (const char of segment) {
    if (CJK_CHAR.test(char)) {
      if (buffer) {
        parts.push(buffer);
        buffer = "";
      }
      parts.push(pinyin?.(char) ?? char);
    } else {
      buffer += char;
    }
  }
  if (buffer) parts.push(buffer);
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Keeps new-post.js behaviour but refuses control characters and path traversal segments. */
function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[\u0000-\u001f\u007f]/g, "");
  return cleaned === "." || cleaned === ".." ? "" : cleaned;
}
