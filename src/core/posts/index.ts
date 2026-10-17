import fs from "node:fs";
import path from "node:path";
import type {
  PostCreateInput,
  PostDetail,
  PostFrontmatter,
  PostSummary,
  WriteResult,
} from "../../shared/contract";
import { diffStats } from "./diff";
import {
  FRONTMATTER_KEYS,
  buildCreateFrontmatter,
  buildFrontmatter,
  composePost,
  isDefaultValue,
  normalizeComparable,
  parseFrontmatterDocument,
  serializeFrontmatter,
  setFrontmatterValue,
  splitFrontmatter,
  type FrontmatterSplit,
  type RawFrontmatter,
} from "./frontmatter";
import { countWords, excerptOf, markdownToPlainText } from "./meta";
import {
  PostsError,
  listPostFiles,
  pinyinForRoot,
  postId,
  resolvePostPath,
  resolvePostsDir,
  slugFromPath,
  slugifyTitleOrFallback,
  type PinyinFn,
} from "./paths";
import { renderMarkdown } from "./render";

export { renderMarkdown };
export { PostsError };

/** Frontmatter keys that may be cleared by passing an empty value. */
const OPTIONAL_KEYS: ReadonlySet<string> = new Set(["updated", "seriesOrder"]);

type ParsedPost = {
  raw: string;
  split: FrontmatterSplit;
  rawFrontmatter: RawFrontmatter;
  frontmatter: PostFrontmatter;
  extraKeys: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(id: string, message: string): WriteResult {
  return { ok: false, changed: [], diffs: [], errors: [{ path: id, message }] };
}

/** Parses a whole post file without ever mutating it. */
function parsePostRaw(raw: string): ParsedPost {
  const split = splitFrontmatter(raw);
  const doc = parseFrontmatterDocument(split.yaml);
  if (doc.errors.length > 0) throw new PostsError(`invalid frontmatter YAML: ${doc.errors[0].message}`);
  const parsed = doc.toJS();
  const rawFrontmatter: RawFrontmatter =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as RawFrontmatter)
      : {};
  const { frontmatter, extraKeys } = buildFrontmatter(rawFrontmatter);
  return { raw, split, rawFrontmatter, frontmatter, extraKeys };
}

function buildSummary(root: string, postsDir: string, file: string, parsed: ParsedPost): PostSummary {
  const frontmatter = parsed.frontmatter;
  const declaredSlug = parsed.rawFrontmatter.slug;
  const slug =
    typeof declaredSlug === "string" && declaredSlug.trim() !== ""
      ? declaredSlug.trim()
      : slugFromPath(postsDir, file);
  return {
    id: postId(root, file),
    file,
    slug,
    title: frontmatter.title,
    published: frontmatter.published,
    draft: frontmatter.draft,
    tags: frontmatter.tags,
    category: frontmatter.category,
    pinned: frontmatter.pinned,
    encrypted: frontmatter.password.trim() !== "",
    cover: frontmatter.image,
    excerpt: excerptOf(parsed.split.body),
    wordCount: countWords(markdownToPlainText(parsed.split.body)),
    extraKeys: parsed.extraKeys,
  };
}

function publishedMs(post: PostSummary): number {
  const parsed = Date.parse(post.published);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Lists every post below `root`, newest first. Posts whose frontmatter cannot be parsed are
 * skipped instead of failing the whole list; readPost reports them as errors.
 */
export function listPosts(root: string): PostSummary[] {
  const postsDir = resolvePostsDir(root);
  const summaries: PostSummary[] = [];
  for (const file of listPostFiles(postsDir)) {
    try {
      summaries.push(buildSummary(root, postsDir, file, parsePostRaw(fs.readFileSync(file, "utf8"))));
    } catch {
      continue;
    }
  }
  summaries.sort((a, b) => publishedMs(b) - publishedMs(a) || a.id.localeCompare(b.id));
  return summaries;
}

/** Reads one post by id (path relative to `root`, e.g. "src/content/posts/foo.md"). */
export function readPost(root: string, id: string): PostDetail {
  const file = resolvePostPath(root, id);
  if (!fs.existsSync(file)) throw new PostsError(`post not found: ${id}`);
  const parsed = parsePostRaw(fs.readFileSync(file, "utf8"));
  return {
    ...buildSummary(root, resolvePostsDir(root), file, parsed),
    frontmatter: parsed.frontmatter,
    body: parsed.split.body,
    raw: parsed.raw,
  };
}

/**
 * Writes a post back. Unchanged frontmatter and body text is reused verbatim, so a read
 * followed by a save is byte-identical; only fields that differ from the file are edited,
 * which keeps comments, key order and unknown keys intact.
 */
export function savePost(root: string, detail: PostDetail): WriteResult {
  const id = typeof detail?.id === "string" ? detail.id : "";
  if (!detail || typeof detail.frontmatter !== "object" || detail.frontmatter === null) {
    return failure(id, "savePost requires detail.frontmatter");
  }

  let file: string;
  try {
    file = resolvePostPath(root, id);
  } catch (error) {
    return failure(id, errorMessage(error));
  }

  const exists = fs.existsSync(file);
  let currentRaw: string;
  try {
    currentRaw = exists ? fs.readFileSync(file, "utf8") : typeof detail.raw === "string" ? detail.raw : "";
  } catch (error) {
    return failure(id, errorMessage(error));
  }
  if (!exists && typeof detail.raw !== "string") return failure(id, `post not found: ${id}`);

  try {
    const base = parsePostRaw(currentRaw);
    const doc = parseFrontmatterDocument(base.split.yaml);
    let touched = false;

    for (const key of FRONTMATTER_KEYS) {
      const next = (detail.frontmatter as unknown as Record<string, unknown>)[key];
      const current = (base.frontmatter as unknown as Record<string, unknown>)[key];
      const present = Object.prototype.hasOwnProperty.call(base.rawFrontmatter, key);

      if (OPTIONAL_KEYS.has(key)) {
        if (next === undefined) continue; // optional field the UI does not edit: leave it alone
        if (next === null || next === "") {
          if (present) {
            doc.delete(key);
            touched = true;
          }
          continue;
        }
      }
      if (next === undefined) continue;
      if (normalizeComparable(key, next) === normalizeComparable(key, current)) continue;
      if (!present && isDefaultValue(key, next)) continue; // never materialise default noise
      setFrontmatterValue(doc, key, next);
      touched = true;
    }

    const nextBody = typeof detail.body === "string" ? detail.body : base.split.body;
    if (!touched && nextBody === base.split.body) return { ok: true, changed: [], diffs: [], errors: [] };

    const yamlText = touched ? serializeFrontmatter(doc) : base.split.yaml;
    const content = composePost(base.split, yamlText, nextBody);
    if (content === currentRaw) return { ok: true, changed: [], diffs: [], errors: [] };

    fs.writeFileSync(file, content, "utf8");
    return {
      ok: true,
      changed: [id],
      diffs: [{ file: id, before: currentRaw, after: content, ...diffStats(currentRaw, content) }],
      errors: [],
    };
  } catch (error) {
    return failure(id, errorMessage(error));
  }
}

function splitExtension(value: string): { stem: string; ext: string } {
  const match = /\.(md|mdx)$/i.exec(value);
  if (!match) return { stem: value, ext: ".md" };
  return { stem: value.slice(0, -match[0].length), ext: match[0].toLowerCase() };
}

/** Mirrors getDate() of scripts/new-post.js: a local calendar date, not UTC. */
function localToday(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Path of the new file, adding -2, -3 … on conflicts as contract.PostCreateInput requires. */
function resolveNewFile(postsDir: string, slug: string, ext: string): string {
  const segments = slug
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  if (segments.length === 0) segments.push("post");
  const fileName = segments.pop() as string;
  const dir = path.join(postsDir, ...segments);

  let candidate = path.join(dir, `${fileName}${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${fileName}-${counter}${ext}`);
    counter++;
  }

  const rel = path.relative(postsDir, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PostsError(`slug escapes the posts directory: ${slug}`);
  }
  return candidate;
}

/**
 * Creates a post. Naming and default frontmatter follow scripts/new-post.js; a slug argument
 * wins over the title-derived one and exact file conflicts get a -2, -3 … suffix.
 */
export function createPost(root: string, input: PostCreateInput, pinyin?: PinyinFn): PostDetail {
  if (!input || typeof input.title !== "string" || input.title.trim() === "") {
    throw new PostsError("createPost requires a title");
  }
  const postsDir = resolvePostsDir(root);
  const requested =
    typeof input.slug === "string" && input.slug.trim() !== ""
      ? input.slug.trim()
      : slugifyTitleOrFallback(input.title, pinyin ?? pinyinForRoot(root));
  const { stem, ext } = splitExtension(requested);
  const slug = stem === "" ? "post" : stem;
  const file = resolveNewFile(postsDir, slug, ext);

  const yamlText = buildCreateFrontmatter({
    title: input.title,
    published:
      typeof input.published === "string" && input.published.trim() !== ""
        ? input.published.trim()
        : localToday(),
    description: "",
    image: input.image ?? "",
    tags: input.tags ?? [],
    category: input.category ?? "",
    draft: input.draft === true,
    lang: "",
    slug,
  });
  const body =
    typeof input.body === "string" && input.body !== "" && !input.body.startsWith("\n")
      ? `\n${input.body}`
      : (input.body ?? "");

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    composePost({ hasFrontmatter: true, bom: "", yaml: "", body: "", eol: "\n" }, yamlText, body),
    "utf8",
  );
  return readPost(root, postId(root, file));
}

/** Deletes exactly one post file; parent directories and images are left alone. */
export function deletePost(root: string, id: string): WriteResult {
  let file: string;
  try {
    file = resolvePostPath(root, id);
  } catch (error) {
    return failure(id, errorMessage(error));
  }
  if (!fs.existsSync(file)) return failure(id, `post not found: ${id}`);

  try {
    const before = fs.readFileSync(file, "utf8");
    fs.unlinkSync(file);
    return {
      ok: true,
      changed: [id],
      diffs: [{ file: id, before, after: "", added: 0, removed: before.split("\n").length }],
      errors: [],
    };
  } catch (error) {
    return failure(id, errorMessage(error));
  }
}
