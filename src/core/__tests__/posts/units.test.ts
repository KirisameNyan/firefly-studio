import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffLines, diffStats } from "../../posts/diff";
import {
  buildFrontmatter,
  composePost,
  parseFrontmatterDocument,
  serializeFrontmatter,
  setFrontmatterValue,
  splitFrontmatter,
  toIsoDate,
} from "../../posts/frontmatter";
import { countWords, excerptOf, markdownToPlainText } from "../../posts/meta";
import {
  PostsError,
  resolvePostPath,
  resolvePostsDir,
  slugFromPath,
  slugifyTitle,
  slugifyTitleOrFallback,
} from "../../posts/paths";
import { renderMarkdown } from "../../posts/render";
import { FIXTURE_POSTS, FIXTURE_PROJECT } from "./_helpers";

describe("toIsoDate", () => {
  it("normalises every date shape YAML can carry", () => {
    expect(toIsoDate("1970-01-03")).toBe("1970-01-03T00:00:00.000Z");
    expect(toIsoDate("2024-01-01")).toBe("2024-01-01T00:00:00.000Z"); // quoted in YAML, same string here
    expect(toIsoDate("2024-01-01T04:40:26.381Z")).toBe("2024-01-01T04:40:26.381Z");
    expect(toIsoDate("2024-01-01T12:00:00+08:00")).toBe("2024-01-01T04:00:00.000Z");
    expect(toIsoDate(new Date("2024-01-01T00:00:00Z"))).toBe("2024-01-01T00:00:00.000Z");
    expect(toIsoDate("tomorrow")).toBeUndefined();
    expect(toIsoDate("")).toBeUndefined();
    expect(toIsoDate(42)).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
  });
});

describe("splitFrontmatter / composePost", () => {
  it("round-trips LF, CRLF, BOM and frontmatter-less files", () => {
    const lf = "---\ntitle: x\n---\n\nbody\n";
    const crlf = "---\r\ntitle: x\r\n---\r\n\r\nbody\r\n";
    const bom = "\uFEFF---\ntitle: x\n---\nbody";
    const plain = "# no frontmatter\n";
    for (const raw of [lf, crlf, bom, plain]) {
      const split = splitFrontmatter(raw);
      expect(composePost(split, split.yaml, split.body), raw).toBe(raw);
    }
    expect(splitFrontmatter(plain).hasFrontmatter).toBe(false);
    expect(splitFrontmatter(bom).bom).toBe("\uFEFF");
    const empty = "---\n---\n";
    expect(splitFrontmatter(empty)).toMatchObject({ hasFrontmatter: true, yaml: "", body: "" });
    expect(composePost(splitFrontmatter(empty), "", "")).toBe(empty);
  });
});

describe("serializeFrontmatter / setFrontmatterValue", () => {
  it("keeps comments, key order and collection style", () => {
    const yaml = "title: 原题 # 行尾注释\ntags: [a, b]\n# 上方注释\npinned: false";
    const doc = parseFrontmatterDocument(yaml);
    expect(serializeFrontmatter(doc)).toBe(yaml);
    setFrontmatterValue(doc, "title", "新题");
    setFrontmatterValue(doc, "tags", ["x", "y"]);
    expect(serializeFrontmatter(doc)).toBe("title: 新题 # 行尾注释\ntags: [x, y]\n# 上方注释\npinned: false");
  });

  it("appends new keys in the repository flow style", () => {
    const doc = parseFrontmatterDocument("title: x");
    setFrontmatterValue(doc, "tags", ["a", "b"]);
    setFrontmatterValue(doc, "author", "me");
    expect(serializeFrontmatter(doc)).toBe("title: x\ntags: [a, b]\nauthor: me");
  });

  it("treats empty frontmatter as an empty string", () => {
    expect(serializeFrontmatter(parseFrontmatterDocument(""))).toBe("");
    expect(serializeFrontmatter(parseFrontmatterDocument("{}"))).toBe("");
  });
});

describe("buildFrontmatter", () => {
  it("applies the schema defaults", () => {
    const { frontmatter, extraKeys } = buildFrontmatter({ title: "T", published: "2024-01-01" });
    expect(frontmatter).toEqual({
      title: "T",
      published: "2024-01-01T00:00:00.000Z",
      updated: undefined,
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
      seriesOrder: undefined,
    });
    expect(extraKeys).toEqual([]);
  });

  it("lists unknown keys in document order and keeps a null category", () => {
    const { frontmatter, extraKeys } = buildFrontmatter({ slug: "s", prevTitle: "p", category: null, customFlag: 42 });
    expect(extraKeys).toEqual(["prevTitle", "customFlag"]);
    expect(frontmatter.category).toBeNull();
  });

  it("keeps values it cannot type", () => {
    expect(buildFrontmatter({ published: "soon" }).frontmatter.published).toBe("soon");
    expect(buildFrontmatter({ tags: [1, "a"] }).frontmatter.tags).toEqual(["a"]);
    expect(buildFrontmatter({ draft: "yes" }).frontmatter.draft).toBe(false);
  });
});

describe("countWords", () => {
  it("counts CJK characters and Latin runs like reading-time", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("Hello world 你好")).toBe(4);
    expect(countWords("你好，世界")).toBe(4);
    expect(countWords("Firefly 代码块示例")).toBe(6);
  });
});

describe("markdownToPlainText / excerptOf", () => {
  it("strips markup but keeps text, link labels and code content", () => {
    const text = markdownToPlainText(
      "## 标题\n\n正文 **粗体** [链接](https://e.com) ![图](a.png) `code`\n\n```js\nconst a = 1;\n```\n",
    );
    expect(text).toContain("标题");
    expect(text).toContain("正文 粗体 链接 图 code");
    expect(text).toContain("const a = 1;");
    expect(text).not.toContain("**");
    expect(text).not.toContain("https://e.com");
  });

  it("uses the first paragraph and truncates", () => {
    expect(excerptOf("# 标题\n\n第一段内容。\n\n第二段。")).toBe("第一段内容。");
    expect(excerptOf("# T\n\n" + "啊".repeat(200))).toBe("啊".repeat(150) + "…");
    expect(excerptOf("第一段。", 3)).toBe("第一段…");
  });
});

describe("renderMarkdown", () => {
  it("renders headings, lists, code, tables and links", () => {
    const html = renderMarkdown(
      "# 标题\n\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n`code` [链接](https://example.com)\n\n```js\nconst a = 1;\n```\n",
    );
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>x</th>");
    expect(html).toContain('<a href="https://example.com">链接</a>');
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<code class="language-js">');
    expect(renderMarkdown("")).toBe("");
  });
});

describe("paths", () => {
  it("resolves the posts directory from a project, a layout and the posts dir itself", () => {
    expect(resolvePostsDir(FIXTURE_PROJECT)).toBe(FIXTURE_POSTS);
    expect(resolvePostsDir(FIXTURE_POSTS)).toBe(FIXTURE_POSTS);
  });

  it("maps ids to files and refuses escapes", () => {
    expect(resolvePostPath(FIXTURE_PROJECT, "posts/code-examples.md")).toBe(
      path.join(FIXTURE_POSTS, "code-examples.md"),
    );
    expect(resolvePostPath(FIXTURE_PROJECT, "posts/guide/index.md")).toBe(
      path.join(FIXTURE_POSTS, "guide/index.md"),
    );
    expect(() => resolvePostPath(FIXTURE_PROJECT, "posts/../secret.md")).toThrow(PostsError);
    expect(() => resolvePostPath(FIXTURE_PROJECT, "../../../etc/passwd")).toThrow(PostsError);
    expect(() => resolvePostPath(FIXTURE_PROJECT, "posts/notes.txt")).toThrow(PostsError);
  });

  it("derives slugs like scripts/new-post.js", () => {
    expect(slugFromPath(FIXTURE_POSTS, path.join(FIXTURE_POSTS, "guide/index.md"))).toBe("guide");
    expect(slugFromPath(FIXTURE_POSTS, path.join(FIXTURE_POSTS, "guide/firefly-wiki-link.md"))).toBe(
      "guide/firefly-wiki-link",
    );
    expect(slugFromPath(FIXTURE_POSTS, path.join(FIXTURE_POSTS, "mdx-example.mdx"))).toBe("mdx-example");
  });

  it("slugifies titles with an injected pinyin converter", () => {
    const map: Record<string, string> = { 我: "wo", 的: "de", 文: "wen", 章: "zhang" };
    expect(slugifyTitle("Hello World")).toBe("Hello World"); // no CJK: kept verbatim, like new-post.js
    expect(slugifyTitle("guide/我的文章", (char) => map[char])).toBe("guide/wo-de-wen-zhang");
  });

  it("romanises a CJK title with the converter the Studio resolves (pinyin-pro dependency)", () => {
    expect(slugifyTitleOrFallback("我的文章")).toBe("wo-de-wen-zhang");
  });

  it("keeps the original characters when the injected converter resolves nothing", () => {
    expect(slugifyTitleOrFallback("我的文章", () => undefined)).toBe("我的文章");
    expect(slugifyTitle("我的文章", () => undefined)).toBe(""); // nothing left to romanise: createPost falls back
  });
});

describe("diffLines / diffStats", () => {
  it("counts changed lines", () => {
    const before = "a\nb\nc\nd\n";
    const after = "a\nB\nc\nd\n";
    expect(
      diffLines(before, after)
        .filter((op) => op.type !== "same")
        .map((op) => op.text),
    ).toEqual(["b", "B"]);
    expect(diffStats(before, after)).toEqual({ added: 1, removed: 1 });
    expect(diffStats(before, before)).toEqual({ added: 0, removed: 0 });
  });

  it("reports pure appends and trailing newline changes", () => {
    expect(diffStats("a\n", "a\nb\n")).toEqual({ added: 1, removed: 0 });
    expect(diffStats("a\n", "a")).toEqual({ added: 0, removed: 1 });
  });
});
