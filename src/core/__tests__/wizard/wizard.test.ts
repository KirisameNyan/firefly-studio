import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConfigEdit, SiteIdentity } from "../../../shared/contract";
import { generateConfigModules, openProject } from "../../project";
import { WIZARD_TARGETS, applyWizard, iconForPlatform, planWizardEdits } from "../../wizard";
import { findField, indexFields, normalizeFieldPath } from "../../wizard/fields";
import { FIXTURE_ROOT, changedLineIndexes, copyFixtureToTemp, read, rmrf } from "../schema/_helpers";

/** 具体取值单独列出：SiteIdentity 的可选字段是 `string | undefined`，不能直接当 JsonValue 用。 */
const VALUES = {
	title: "E2E 站点",
	subtitle: "副标题",
	lang: "en",
	siteUrl: "https://example.com",
	startDate: "2024-02-29",
	author: "Neko",
	bio: "hello world",
	avatar: "/images/avatar.webp",
	themeHue: 210,
};

const IDENTITY: SiteIdentity = {
	...VALUES,
	social: [
		{ platform: "github", url: "https://github.com/neko" },
		{ platform: "fa7-brands:bluesky", url: "https://bsky.app/neko" },
		{ platform: "unknown-thing", url: "https://example.com/me" },
	],
};

const EXPECTED_EDITS: ConfigEdit[] = [
	{ moduleId: "siteConfig", path: "title", value: VALUES.title },
	{ moduleId: "profileConfig", path: "name", value: VALUES.author },
	{ moduleId: "siteConfig", path: "subtitle", value: VALUES.subtitle },
	{ moduleId: "siteConfig", path: "lang", value: VALUES.lang },
	{ moduleId: "siteConfig", path: "site_url", value: VALUES.siteUrl },
	{ moduleId: "siteConfig", path: "siteStartDate", value: VALUES.startDate },
	{ moduleId: "profileConfig", path: "bio", value: VALUES.bio },
	{ moduleId: "profileConfig", path: "avatar", value: VALUES.avatar },
	{ moduleId: "siteConfig", path: "themeColor.hue", value: VALUES.themeHue },
	{
		moduleId: "profileConfig",
		path: "links",
		value: [
			{ name: "github", url: "https://github.com/neko", icon: "fa7-brands:github", showName: false },
			{ name: "fa7-brands:bluesky", url: "https://bsky.app/neko", icon: "fa7-brands:bluesky", showName: false },
			{ name: "unknown-thing", url: "https://example.com/me", icon: "fa7-solid:link", showName: false },
		],
	},
];

const temps: string[] = [];
const tempProject = (): string => {
	const dir = copyFixtureToTemp("wizard");
	temps.push(dir);
	return dir;
};

afterEach(() => {
	for (const dir of temps.splice(0)) rmrf(dir);
});

describe("wizard 映射表", () => {
	it("每个目标路径都在真实 schema 上存在且可写", () => {
		const index = indexFields(generateConfigModules(FIXTURE_ROOT));
		for (const [field, target] of Object.entries(WIZARD_TARGETS)) {
			const node = findField(index, target.moduleId, target.path);
			expect(node, `${field} → ${target.moduleId}.${target.path}`).toBeDefined();
			expect(node?.readOnly, field).toBe(false);
			expect(target.kinds as readonly string[]).toContain(node?.kind);
		}
	});

	it("把 SiteIdentity 映射成 ConfigEdit[]（数组顺序稳定）", () => {
		const plan = planWizardEdits(FIXTURE_ROOT, IDENTITY);
		expect(plan.errors).toEqual([]);
		expect(plan.edits).toEqual(EXPECTED_EDITS);
		expect(plan.mappings.map((m) => m.field)).toEqual([
			"title",
			"author",
			"subtitle",
			"lang",
			"siteUrl",
			"startDate",
			"bio",
			"avatar",
			"themeHue",
			"social",
		]);
	});

	it("可选字段缺省时不产生 edit", () => {
		const plan = planWizardEdits(FIXTURE_ROOT, { title: "T", author: "A" });
		expect(plan.errors).toEqual([]);
		expect(plan.edits).toEqual([
			{ moduleId: "siteConfig", path: "title", value: "T" },
			{ moduleId: "profileConfig", path: "name", value: "A" },
		]);
	});

	it("枚举取值、色相范围、必填字段非法时给出错误并拒绝规划", () => {
		expect(planWizardEdits(FIXTURE_ROOT, { title: "T", author: "A", lang: "fr" }).errors[0]?.message).toContain("允许集合");
		expect(planWizardEdits(FIXTURE_ROOT, { title: "T", author: "A", themeHue: 400 }).errors[0]?.message).toContain("0-360");
		const missing = planWizardEdits(FIXTURE_ROOT, { title: "", author: "" });
		expect(missing.errors.map((e) => e.path)).toEqual(["siteConfig.title", "profileConfig.name"]);
		expect(planWizardEdits(FIXTURE_ROOT, { title: "T", author: "A", social: [{ platform: "x", url: "" }] }).errors[0]?.path).toBe(
			"profileConfig.links[0]",
		);
	});

	it("iconForPlatform：已知平台、图标代码透传、未知回落", () => {
		expect(iconForPlatform("GitHub")).toBe("fa7-brands:github");
		expect(iconForPlatform("simple-icons:astro")).toBe("simple-icons:astro");
		expect(iconForPlatform("no-such-platform")).toBe("fa7-solid:link");
	});

	it("normalizeFieldPath 把具体索引收敛成数组模板并去掉重复前缀", () => {
		expect(normalizeFieldPath("links[2].url", "profileConfig")).toBe("links[].url");
		expect(normalizeFieldPath("profileConfig.name", "profileConfig")).toBe("name");
		expect(normalizeFieldPath("themeColor.hue", "siteConfig")).toBe("themeColor.hue");
	});
});

describe("applyWizard", () => {
	it("只改 siteConfig.ts 与 profileConfig.ts，且 siteConfig 只有目标行变化", () => {
		const root = tempProject();
		const before = read(root, "src/config/siteConfig.ts");
		const result = applyWizard(root, IDENTITY);
		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
		expect([...result.changed].sort()).toEqual(["src/config/profileConfig.ts", "src/config/siteConfig.ts"]);

		const after = read(root, "src/config/siteConfig.ts");
		const changed = changedLineIndexes(before, after).map((i) => after.split("\n")[i]);
		expect(changed.length).toBeGreaterThan(0);
		for (const line of changed) {
			expect(line).toMatch(/title:|subtitle:|site_url:|siteStartDate:|hue:|resolveSiteLang\(/);
		}

		const profile = read(root, "src/config/profileConfig.ts");
		expect(profile).toContain(`name: "Neko"`);
		expect(profile).toContain(`bio: "hello world"`);
		expect(profile).toContain(`avatar: "/images/avatar.webp"`);
		expect(profile).toContain(`url: "https://bsky.app/neko"`);
		expect(profile).toContain(`icon: "fa7-solid:link"`);
		expect(profile).toContain("// 已经预装的图标集：fa7-brands"); // 注释未被吞掉
	});

	it("computed 字段（只读）导致整份身份都不落盘", () => {
		const root = tempProject();
		const file = path.join(root, "src/config/profileConfig.ts");
		// 导入值 → origin=computed / readOnly=true（实测，见 probe4.ts）
		const patched = fs
			.readFileSync(file, "utf8")
			.replace(
				'import type { ProfileConfig } from "../types/profileConfig";',
				'import type { ProfileConfig } from "../types/profileConfig";\nimport { DEFAULT_NAME } from "../constants/defaults";',
			)
			.replace('name: "XiaYe",', "name: DEFAULT_NAME,");
		fs.writeFileSync(file, patched, "utf8");

		const plan = planWizardEdits(root, IDENTITY);
		expect(plan.errors.some((e) => e.message.includes("字段只读"))).toBe(true);

		const result = applyWizard(root, IDENTITY);
		expect(result.ok).toBe(false);
		expect(result.changed).toEqual([]);
		expect(fs.readFileSync(file, "utf8")).toBe(patched);
	});

	it("root 不存在时给出错误而不是抛异常", () => {
		const result = applyWizard(path.join(FIXTURE_ROOT, "does-not-exist"), IDENTITY);
		expect(result.ok).toBe(false);
		expect(result.errors[0]?.message).toContain("项目根目录不存在");
	});
});

describe("openProject 的 posts 接线", () => {
	it("posts 来自 A2 的 listPosts，且不再有 posts 暂未接入 warning", () => {
		const root = tempProject();
		const postsDir = path.join(root, "src/content/posts");
		fs.mkdirSync(postsDir, { recursive: true });
		fs.writeFileSync(
			path.join(postsDir, "hello.md"),
			"---\ntitle: Hello\npublished: 2024-01-01\ntags: [a]\n---\n\n正文\n",
			"utf8",
		);
		const project = openProject(root);
		expect(project.isFirefly).toBe(true);
		expect(project.posts).toHaveLength(1);
		expect(project.posts[0].title).toBe("Hello");
		expect(project.posts[0].id).toBe("src/content/posts/hello.md");
		expect(project.warnings.some((w) => w.includes("暂未接入"))).toBe(false);
	});
});
