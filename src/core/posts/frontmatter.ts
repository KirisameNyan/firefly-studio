import { isCollection, isMap, isScalar, isSeq, parseDocument, stringify, type Document } from "yaml";
import type { PostFrontmatter } from "../../shared/contract";

export type Eol = "\n" | "\r\n";

export type FrontmatterSplit = {
  hasFrontmatter: boolean;
  /** byte order mark kept in front of the frontmatter, so writing it back is loss-free */
  bom: string;
  /** raw YAML between the delimiters, without the trailing newline */
  yaml: string;
  /** everything after the closing delimiter line, verbatim */
  body: string;
  eol: Eol;
};

export type RawFrontmatter = Record<string, unknown>;

/** Keys of the posts schema, in the declaration order of contract.PostFrontmatter. */
export const FRONTMATTER_KEYS = [
  "title",
  "published",
  "updated",
  "draft",
  "description",
  "image",
  "tags",
  "category",
  "lang",
  "pinned",
  "author",
  "sourceLink",
  "licenseName",
  "licenseUrl",
  "comment",
  "password",
  "passwordHint",
  "series",
  "seriesOrder",
] as const;

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(FRONTMATTER_KEYS);

/**
 * `slug` is a real Firefly/Astro frontmatter key that is not part of contract.PostFrontmatter:
 * it is surfaced as PostSummary.slug, so it is not reported as an unknown key.
 */
const SLUG_KEY = "slug";

/** Documented schema defaults; an absent key holding its default is never written back. */
export const DEFAULT_VALUES: Record<string, unknown> = {
  title: "",
  published: "",
  draft: false,
  description: "",
  image: "",
  tags: [],
  category: "",
  lang: "",
  pinned: false,
  author: "",
  sourceLink: "",
  licenseName: "",
  licenseUrl: "",
  comment: true,
  password: "",
  passwordHint: "",
  series: "",
};

const EMPTY_MAP = "{}\n";

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(raw: string): FrontmatterSplit {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = bom === "" ? raw : raw.slice(1);
  const eol: Eol = text.includes("\r\n") ? "\r\n" : "\n";
  const match = FRONTMATTER_PATTERN.exec(text);
  if (!match) return { hasFrontmatter: false, bom, yaml: "", body: text, eol };
  return { hasFrontmatter: true, bom, yaml: match[1] ?? "", body: text.slice(match[0].length), eol };
}

function toEol(text: string, eol: Eol): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

/** Rebuilds a post from its frontmatter text and body, byte for byte when nothing changed. */
export function composePost(split: FrontmatterSplit, yamlText: string, body: string): string {
  const { bom, eol } = split;
  if (!split.hasFrontmatter && yamlText === "") return bom + body;
  const block = yamlText === "" ? "" : toEol(yamlText, eol) + eol;
  return `${bom}---${eol}${block}---${eol}${body}`;
}

export function parseFrontmatterDocument(yamlText: string): Document {
  return parseDocument(yamlText.trim() === "" ? EMPTY_MAP : yamlText);
}

/** Serialises a frontmatter document, preserving comments, key order and collection style. */
export function serializeFrontmatter(doc: Document): string {
  const contents = doc.contents;
  if (contents === null || contents === undefined) return "";
  if (isMap(contents) && contents.items.length === 0) return "";
  const out = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return out.endsWith("\n") ? out.slice(0, -1) : out;
}

/**
 * Dates come out of YAML as `2024-01-01`, a quoted string, or a full ISO timestamp.
 * Anything else is left to the caller (the raw string is preserved by buildFrontmatter).
 */
export function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text)) return undefined;
  const parsed = new Date(text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Normalises raw frontmatter into contract.PostFrontmatter plus the list of unknown keys. */
export function buildFrontmatter(raw: RawFrontmatter): {
  frontmatter: PostFrontmatter;
  extraKeys: string[];
} {
  const frontmatter: PostFrontmatter = {
    title: asString(raw.title, ""),
    published: toIsoDate(raw.published) ?? asString(raw.published, ""),
    updated: toIsoDate(raw.updated),
    draft: asBoolean(raw.draft, false),
    description: asString(raw.description, ""),
    image: asString(raw.image, ""),
    tags: asStringArray(raw.tags),
    category: raw.category === null ? null : asString(raw.category, ""),
    lang: asString(raw.lang, ""),
    pinned: asBoolean(raw.pinned, false),
    author: asString(raw.author, ""),
    sourceLink: asString(raw.sourceLink, ""),
    licenseName: asString(raw.licenseName, ""),
    licenseUrl: asString(raw.licenseUrl, ""),
    comment: asBoolean(raw.comment, true),
    password: asString(raw.password, ""),
    passwordHint: asString(raw.passwordHint, ""),
    series: asString(raw.series, ""),
    seriesOrder: typeof raw.seriesOrder === "number" ? raw.seriesOrder : undefined,
  };
  const extraKeys = Object.keys(raw).filter((key) => !KNOWN_KEYS.has(key) && key !== SLUG_KEY);
  return { frontmatter, extraKeys };
}

/** Comparable form of a field value; null and "" are the same empty category. */
export function normalizeComparable(key: string, value: unknown): string {
  const normalized = key === "category" && value === null ? "" : value;
  if (Array.isArray(normalized)) return JSON.stringify(normalized);
  return JSON.stringify(normalized ?? null);
}

export function isDefaultValue(key: string, value: unknown): boolean {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_VALUES, key)) return false;
  return normalizeComparable(key, value) === normalizeComparable(key, DEFAULT_VALUES[key]);
}

/**
 * Replaces one frontmatter value in place. Scalars keep the trailing comment of the line they
 * replace; arrays keep the existing collection node so comments and flow/block style survive.
 */
export function setFrontmatterValue(doc: Document, key: string, value: unknown): void {
  const existing: unknown = doc.get(key, true);
  if (Array.isArray(value)) {
    if (isSeq(existing)) {
      const previous = existing.items;
      // reuse the untouched item nodes so their quote style survives an edit
      existing.items = value.map((item, index) => {
        const old = previous[index];
        return typeof item === "string" && isScalar(old) && old.value === item ? old : doc.createNode(item);
      });
      return;
    }
    const node = doc.createNode(value);
    if (isCollection(node)) node.flow = true; // repository style: tags: [a, b]
    doc.set(key, node);
    return;
  }
  doc.set(key, value ?? null);
}

/** Renders one scalar so that the result stays valid YAML on a single line. */
export function yamlScalar(value: string): string {
  if (value === "") return "''";
  if (/[\n\r\t]/.test(value)) return JSON.stringify(value);
  const out = stringify(value, { lineWidth: 0 });
  return out.endsWith("\n") ? out.slice(0, -1) : out;
}

export type CreateFrontmatterInput = {
  title: string;
  published: string;
  description?: string;
  image?: string;
  tags?: string[];
  category?: string | null;
  draft?: boolean;
  lang?: string;
  slug: string;
};

/**
 * Frontmatter of a newly created post, kept compatible with scripts/new-post.js:
 * same keys in the same order, '' for empty strings and [a, b] for tags.
 */
export function buildCreateFrontmatter(input: CreateFrontmatterInput): string {
  const tags = (input.tags ?? []).map((tag) => yamlScalar(tag)).join(", ");
  return [
    `title: ${yamlScalar(input.title)}`,
    `published: ${yamlScalar(input.published)}`,
    `description: ${yamlScalar(input.description ?? "")}`,
    `image: ${yamlScalar(input.image ?? "")}`,
    `tags: [${tags}]`,
    `category: ${yamlScalar(input.category ?? "")}`,
    `draft: ${input.draft === true ? "true" : "false"}`,
    `lang: ${yamlScalar(input.lang ?? "")}`,
    `slug: ${yamlScalar(input.slug)}`,
  ].join("\n");
}
