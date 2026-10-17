import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffLines } from "../../posts/diff";
import {
  composePost,
  parseFrontmatterDocument,
  serializeFrontmatter,
  splitFrontmatter,
} from "../../posts/frontmatter";
import { createPost, deletePost, listPosts, readPost, savePost } from "../../posts/index";
import { slugifyTitle, type PinyinFn } from "../../posts/paths";
import {
  FIREFLY_ROOT,
  FIXTURE_FILES,
  FIXTURE_POSTS,
  FIXTURE_PROJECT,
  cleanupProjects,
  localToday,
  makeProject,
} from "./_helpers";

beforeAll(() => {
  expect(fs.existsSync(FIXTURE_POSTS)).toBe(true);
});

afterAll(() => {
  cleanupProjects();
});

describe("listPosts / readPost over the Firefly samples", () => {
  it("reads every sample post", () => {
    const posts = listPosts(FIXTURE_PROJECT);
    expect(posts).toHaveLength(FIXTURE_FILES.length);
    for (const post of posts) {
      expect(post.title, post.id).not.toBe("");
      expect(post.published, post.id).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Array.isArray(post.tags), post.id).toBe(true);
      expect(post.wordCount, post.id).toBeGreaterThan(0);
      expect(post.excerpt.length, post.id).toBeGreaterThan(0);
      expect(post.id.startsWith("posts/"), post.id).toBe(true);
      expect(fs.existsSync(post.file), post.id).toBe(true);
    }

    const byId = new Map(posts.map((post) => [post.id, post]));
    expect(byId.get("posts/code-examples.md")?.title).toBe("Firefly 代码块示例");
    expect(byId.get("posts/code-examples.md")?.tags).toEqual(["Markdown", "Firefly"]);
    expect(byId.get("posts/code-examples.md")?.published).toBe("1970-01-03T00:00:00.000Z");
    expect(byId.get("posts/code-examples.md")?.extraKeys).toEqual([]); // slug is surfaced as PostSummary.slug
    expect(byId.get("posts/encrypted-demo.md")?.encrypted).toBe(true);
    expect(byId.get("posts/draft.md")?.draft).toBe(true);
    expect(byId.get("posts/firefly.md")?.pinned).toBe(true);
    expect(byId.get("posts/guide/index.md")?.slug).toBe("guide"); // trailing /index is stripped
    expect(byId.get("posts/guide/index.md")?.category).toBe("博客指南");
    expect(byId.get("posts/firefly.md")?.cover).toBe("./images/firefly2.avif");

    // newest first
    const dates = posts.map((post) => Date.parse(post.published));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    const detail = readPost(FIXTURE_PROJECT, "posts/mdx-example.mdx");
    expect(detail.id).toBe("posts/mdx-example.mdx");
    expect(detail.body.startsWith("\nimport { Badge")).toBe(true);
    expect(detail.raw.startsWith("---\ntitle: MDX 格式文章示例")).toBe(true);
    expect(detail.frontmatter.seriesOrder).toBe(7);
  });

  it("reads the live Firefly repository read-only", () => {
    if (!fs.existsSync(FIREFLY_ROOT)) return;
    const live = listPosts(FIREFLY_ROOT);
    expect(live.length).toBeGreaterThanOrEqual(FIXTURE_FILES.length);
    expect(live.map((post) => post.id)).toContain("src/content/posts/mdx-example.mdx");
    expect(live.map((post) => post.id)).toContain("src/content/posts/guide/index.md");
    for (const post of live) expect(post.title, post.id).not.toBe("");
  });
});

describe("byte-level round trip", () => {
  it("serialises every sample frontmatter byte for byte", () => {
    for (const rel of FIXTURE_FILES) {
      const raw = fs.readFileSync(path.join(FIXTURE_POSTS, rel), "utf8");
      const split = splitFrontmatter(raw);
      expect(split.hasFrontmatter, rel).toBe(true);
      const yaml = serializeFrontmatter(parseFrontmatterDocument(split.yaml));
      expect(yaml, rel).toBe(split.yaml);
      expect(composePost(split, yaml, split.body), rel).toBe(raw);
    }
  });

  it("readPost then savePost leaves all 14 files byte-identical and writes nothing", () => {
    const untouched: string[] = [];
    for (const rel of FIXTURE_FILES) {
      const file = path.join(FIXTURE_POSTS, rel);
      const before = fs.readFileSync(file, "utf8");
      const detail = readPost(FIXTURE_PROJECT, `posts/${rel}`);
      expect(detail.raw, rel).toBe(before);

      const result = savePost(FIXTURE_PROJECT, detail);
      expect(result.ok, rel).toBe(true);
      expect(result.errors, rel).toEqual([]);
      expect(result.changed, rel).toEqual([]);
      expect(result.diffs, rel).toEqual([]);
      expect(fs.readFileSync(file, "utf8"), rel).toBe(before);
      untouched.push(rel);
    }
    expect(untouched).toEqual(FIXTURE_FILES);
  });
});

describe("savePost edits", () => {
  it("changes only the edited frontmatter lines", () => {
    const root = makeProject("edit", ["code-examples.md"]);
    const id = "src/content/posts/code-examples.md";
    const file = path.join(root, id);
    const before = fs.readFileSync(file, "utf8");

    const detail = readPost(root, id);
    detail.frontmatter.title = "改写后的标题";
    detail.frontmatter.tags = ["Alpha", "Beta"];

    const result = savePost(root, detail);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.changed).toEqual([id]);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].removed).toBe(2);
    expect(result.diffs[0].added).toBe(2);

    const after = fs.readFileSync(file, "utf8");
    const ops = diffLines(before, after);
    expect(
      ops.filter((op) => op.type !== "same").map((op) => `${op.type}:${op.text}`),
    ).toEqual([
      "del:title: Firefly 代码块示例",
      "add:title: 改写后的标题",
      "del:tags: [Markdown, Firefly]",
      "add:tags: [Alpha, Beta]",
    ]);
    expect(ops.filter((op) => op.type === "same")).toHaveLength(before.split("\n").length - 2);
    expect(after.replace("title: 改写后的标题", "title: Firefly 代码块示例").replace("tags: [Alpha, Beta]", "tags: [Markdown, Firefly]")).toBe(before);
  });

  it("preserves comments, key order and unknown keys", () => {
    const root = makeProject("extra", []);
    const dir = path.join(root, "src/content/posts");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "extra.md");
    const original = [
      "---",
      "title: 原题 # 行尾注释",
      "published: 2024-01-01",
      "tags: [a, b]",
      "# 上方注释",
      "prevTitle: 上一篇",
      "customFlag: 42",
      "---",
      "",
      "正文段落。",
      "",
    ].join("\n");
    fs.writeFileSync(file, original);

    const id = "src/content/posts/extra.md";
    const detail = readPost(root, id);
    expect(detail.extraKeys).toEqual(["prevTitle", "customFlag"]);
    expect(detail.frontmatter.published).toBe("2024-01-01T00:00:00.000Z");

    detail.frontmatter.title = "新题";
    const result = savePost(root, detail);
    expect(result.ok).toBe(true);
    expect(result.changed).toEqual([id]);

    const after = fs.readFileSync(file, "utf8");
    expect(after).toBe(original.replace("title: 原题 # 行尾注释", "title: 新题 # 行尾注释"));
    expect(diffLines(original, after).filter((op) => op.type !== "same")).toHaveLength(2);
  });

  it("clears an optional key only when asked explicitly", () => {
    const root = makeProject("optional", ["code-examples.md"]);
    const id = "src/content/posts/code-examples.md";
    const file = path.join(root, id);
    const detail = readPost(root, id);

    // undefined means "not editable here": the key survives
    detail.frontmatter.seriesOrder = undefined;
    expect(savePost(root, detail).changed).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toContain("seriesOrder: 5");

    // an empty value clears it
    const second = readPost(root, id);
    second.frontmatter.seriesOrder = null as unknown as undefined; // contract typing has no "clear" value
    const result = savePost(root, second);
    expect(result.changed).toEqual([id]);
    const after = fs.readFileSync(file, "utf8");
    expect(after).not.toContain("seriesOrder");
    expect(after).toContain("series: \"Firefly 功能示例2\"");
  });

  it("returns a file to its original bytes when an edit is reverted", () => {
    const root = makeProject("revert", ["markdown-extended.md"]);
    const id = "src/content/posts/markdown-extended.md";
    const file = path.join(root, id);
    const original = fs.readFileSync(file, "utf8");

    const detail = readPost(root, id);
    const { title, tags } = detail.frontmatter;
    detail.frontmatter.title = "临时标题";
    detail.frontmatter.tags = ["Z"];
    expect(savePost(root, detail).changed).toEqual([id]);
    expect(fs.readFileSync(file, "utf8")).not.toBe(original);

    const back = readPost(root, id);
    back.frontmatter.title = title;
    back.frontmatter.tags = [...tags];
    expect(savePost(root, back).changed).toEqual([id]);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("canonicalises the item quoting of an edited array and touches nothing else", () => {
    const root = makeProject("revert-quoted", ["guide/index.md"]);
    const id = "src/content/posts/guide/index.md";
    const file = path.join(root, id);
    const original = fs.readFileSync(file, "utf8");

    const detail = readPost(root, id);
    const tags = [...detail.frontmatter.tags];
    detail.frontmatter.tags = ["Z"];
    expect(savePost(root, detail).changed).toEqual([id]);

    const back = readPost(root, id);
    back.frontmatter.tags = tags;
    expect(savePost(root, back).changed).toEqual([id]);

    const after = fs.readFileSync(file, "utf8");
    const changed = diffLines(original, after).filter((op) => op.type !== "same");
    expect(changed.map((op) => op.text)).toEqual([
      'tags: ["Firefly", "博客", "Markdown", "指南"]',
      "tags: [Firefly, 博客, Markdown, 指南]",
    ]);
    expect(readPost(root, id).frontmatter.tags).toEqual(tags);
  });
  it("writes only the body when only the body changed", () => {
    const root = makeProject("body", ["video.md"]);
    const id = "src/content/posts/video.md";
    const detail = readPost(root, id);
    const frontmatterBefore = splitFrontmatter(detail.raw).yaml;

    detail.body = `${detail.body}\n新增段落。\n`;
    const result = savePost(root, detail);
    expect(result.ok).toBe(true);
    expect(result.changed).toEqual([id]);

    const after = splitFrontmatter(fs.readFileSync(path.join(root, id), "utf8"));
    expect(after.yaml).toBe(frontmatterBefore);
    expect(after.body).toBe(detail.body);
  });

  it("reports errors instead of throwing", () => {
    const root = makeProject("missing", []);
    const result = savePost(root, {
      id: "src/content/posts/nope.md",
      file: "",
      slug: "nope",
      title: "",
      published: "",
      draft: false,
      tags: [],
      category: "",
      pinned: false,
      encrypted: false,
      cover: "",
      excerpt: "",
      wordCount: 0,
      extraKeys: [],
      frontmatter: readPost(makeProject("ref", ["draft.md"]), "src/content/posts/draft.md").frontmatter,
      body: "",
      raw: "",
    });
    expect(result.ok).toBe(false);
    expect(result.changed).toEqual([]);
    expect(result.errors[0].path).toBe("src/content/posts/nope.md");
  });
});

describe("createPost", () => {
  it("matches the naming and frontmatter of scripts/new-post.js", () => {
    const root = makeProject("create", []);
    const detail = createPost(root, { title: "Hello World" });

    // new-post.js keeps a non-CJK name verbatim
    expect(detail.id).toBe("src/content/posts/Hello World.md");
    expect(detail.slug).toBe("Hello World");
    expect(detail.frontmatter.draft).toBe(false);
    expect(detail.frontmatter.tags).toEqual([]);
    expect(detail.frontmatter.category).toBe("");
    expect(detail.frontmatter.published).toBe(`${localToday()}T00:00:00.000Z`);
    expect(detail.body).toBe("");

    const written = fs.readFileSync(path.join(root, detail.id), "utf8");
    expect(written).toBe(newPostOracle("Hello World", localToday(), "Hello World"));
  });

  it("writes supplied values and quotes what YAML needs", () => {
    const root = makeProject("create-values", []);
    const detail = createPost(root, {
      title: "有: 冒号",
      slug: "colon",
      published: "2024-05-06",
      tags: ["A", "B"],
      category: "分类",
      draft: true,
      image: "./i.avif",
      body: "# hi",
    });
    const written = fs.readFileSync(path.join(root, detail.id), "utf8");
    expect(written).toBe(
      [
        "---",
        'title: "有: 冒号"',
        "published: 2024-05-06",
        "description: ''",
        "image: ./i.avif",
        "tags: [A, B]",
        "category: 分类",
        "draft: true",
        "lang: ''",
        "slug: colon",
        "---",
        "",
        "# hi",
      ].join("\n"),
    );
    expect(detail.frontmatter.published).toBe("2024-05-06T00:00:00.000Z");
    expect(detail.frontmatter.draft).toBe(true);
    expect(detail.body).toBe("\n# hi");
  });

  it("adds -2, -3 on conflicts, honours .mdx and creates nested directories", () => {
    const root = makeProject("conflict", []);
    createPost(root, { title: "dup", slug: "dup" });
    expect(createPost(root, { title: "dup", slug: "dup" }).id).toBe("src/content/posts/dup-2.md");
    const third = createPost(root, { title: "dup", slug: "dup", body: "# hi" });
    expect(third.id).toBe("src/content/posts/dup-3.md");
    expect(third.body).toBe("\n# hi");
    expect(fs.readFileSync(path.join(root, third.id), "utf8").endsWith("---\n\n# hi")).toBe(true);

    const nested = createPost(root, { title: "nested", slug: "guide/nested.mdx" });
    expect(nested.id).toBe("src/content/posts/guide/nested.mdx");
    expect(fs.existsSync(path.join(root, "src/content/posts/guide/nested.mdx"))).toBe(true);
  });

  // Whether the Studio dependency or the opened project supplies pinyin, the produced file must match
  // the new-post.js template; the project-local stub keeps this green without the Studio dependency too.
  it("romanises a CJK title end to end, matching the new-post.js template", () => {
    const root = makeProject("pinyin", []);
    const stub = path.join(root, "node_modules/pinyin-pro");
    fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(
      path.join(stub, "package.json"),
      JSON.stringify({ name: "pinyin-pro", version: "0.0.0-test", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(stub, "index.js"),
      [
        'const MAP = { "中": "zhong", "文": "wen", "标": "biao", "题": "ti" };',
        "module.exports = {",
        "  pinyin: (text, options) =>",
        "    options && options.type === \"array\" ? [...String(text)].map((c) => MAP[c] ?? c) : text,",
        "};",
        "",
      ].join("\n"),
    );

    const detail = createPost(root, { title: "中文标题" });
    expect(detail.id).toBe("src/content/posts/zhong-wen-biao-ti.md");
    expect(detail.slug).toBe("zhong-wen-biao-ti");
    expect(fs.readFileSync(path.join(root, detail.id), "utf8")).toBe(
      newPostOracle("中文标题", localToday(), "zhong-wen-biao-ti"),
    );
  });

  it.skipIf(!loadFireflyPinyin())("slugifyTitle matches the slug algorithm of scripts/new-post.js", () => {
    const pinyin = loadFireflyPinyin() as PinyinFn;
    const cases = [
      "我的第一篇博客",
      "Hello World",
      "Firefly 使用指南",
      "guide/我的文章",
      "KaTeX 数学公式示例",
      "中文 mixed 标题",
    ];
    for (const title of cases) {
      expect(slugifyTitle(title, pinyin), title).toBe(newPostSlug(`${title}.md`, pinyin));
    }
  });
});

describe("deletePost", () => {
  it("deletes exactly one file", () => {
    const root = makeProject("delete", ["code-examples.md", "video.md", "guide/index.md"]);
    const result = deletePost(root, "src/content/posts/video.md");
    expect(result.ok).toBe(true);
    expect(result.changed).toEqual(["src/content/posts/video.md"]);
    expect(result.diffs[0].removed).toBeGreaterThan(0);
    expect(result.diffs[0].after).toBe("");

    expect(fs.existsSync(path.join(root, "src/content/posts/video.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/content/posts/code-examples.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/content/posts/guide/index.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/content/posts/guide"))).toBe(true);
    expect(listPosts(root).map((post) => post.id)).toEqual([
      "src/content/posts/code-examples.md",
      "src/content/posts/guide/index.md",
    ]);

    expect(deletePost(root, "src/content/posts/video.md").ok).toBe(false);
    expect(deletePost(root, "../../../etc/passwd").ok).toBe(false);
  });
});

/* ── oracles copied from scripts/new-post.js, used as the comparison baseline ── */

function newPostOracle(title: string, date: string, slug: string): string {
  return [
    "---",
    `title: ${title}`,
    `published: ${date}`,
    "description: ''",
    "image: ''",
    "tags: []",
    "category: ''",
    "draft: false",
    "lang: ''",
    `slug: ${slug}`,
    "---",
    "",
  ].join("\n");
}

function newPostSlug(fileName: string, pinyin: PinyinFn): string {
  const fileExtensionRegex = /\.(md|mdx)$/i;
  let slug = fileName.replace(fileExtensionRegex, "");
  if (slug.endsWith("/index")) slug = slug.slice(0, -"/index".length);
  return slug
    .split("/")
    .map((segment) => {
      if (!/[\u4e00-\u9fff]/.test(segment)) return segment;
      const parts: string[] = [];
      let buf = "";
      for (const ch of segment) {
        if (/[\u4e00-\u9fff]/.test(ch)) {
          if (buf) {
            parts.push(buf);
            buf = "";
          }
          parts.push(pinyin(ch) ?? ch);
        } else {
          buf += ch;
        }
      }
      if (buf) parts.push(buf);
      return parts
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    })
    .join("/");
}

function loadFireflyPinyin(): PinyinFn | undefined {
  try {
    const require = createRequire(import.meta.url);
    const mod = require(path.join(FIREFLY_ROOT, "node_modules/pinyin-pro")) as {
      pinyin: (text: string, options?: unknown) => unknown;
    };
    return (char: string) => {
      const result = mod.pinyin(char, { toneType: "none", type: "array" });
      return Array.isArray(result) && result.length > 0 ? String(result[0]) : undefined;
    };
  } catch {
    return undefined;
  }
}
