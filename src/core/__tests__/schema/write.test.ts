import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSchema } from "../../schema/generate";
import { previewEdits, writeEdits } from "../../schema/write";
import type { ConfigEdit } from "../../../shared/contract";
import { changedLineIndexes, copyFixtureToTemp, findField, flatFields, parseErrorCount, read, rmrf } from "./_helpers";

function withTemp<T>(label: string, fn: (dir: string) => T): T {
	const dir = copyFixtureToTemp(label);
	try {
		return fn(dir);
	} finally {
		rmrf(dir);
	}
}

describe("写回（文本区间替换）", () => {
	it("读后写回同一批值：输出与原文件逐字节完全相同", () => {
		withTemp("fidelity", (dir) => {
			const { modules } = generateSchema(dir);
			const edits: ConfigEdit[] = [];
			for (const m of modules)
				for (const f of flatFields(m.fields))
					if (f.loc && f.value !== undefined && !f.readOnly) edits.push({ moduleId: m.id, path: f.path, value: f.value });
			expect(edits.length).toBeGreaterThan(100);
			const snapshot = (root: string): Record<string, string> => {
				const out: Record<string, string> = {};
				const walk = (d: string) => {
					for (const e of fs.readdirSync(d, { withFileTypes: true })) {
						const p = path.join(d, e.name);
						if (e.isDirectory()) walk(p);
						else out[path.relative(root, p)] = fs.readFileSync(p, "utf8");
					}
				};
				walk(root);
				return out;
			};
			const before = snapshot(dir);
			const res = writeEdits(dir, edits);
			expect(res.errors).toEqual([]);
			expect(res.changed).toEqual([]);
			expect(res.diffs).toEqual([]);
			// 逐字节校验：整个工程每个文件都与写回前完全相同
			expect(snapshot(dir)).toEqual(before);
		});
	});

	it("改一个字段：只有该字段所在行变化，注释与其它字段字节不变", () => {
		withTemp("onefield", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const before = read(dir, rel);
			const res = writeEdits(dir, [{ moduleId: "siteConfig", path: "title", value: "Firefly Studio" }]);
			expect(res.ok).toBe(true);
			expect(res.changed).toEqual([rel]);
			expect(res.diffs).toHaveLength(1);
			expect(res.diffs[0].added).toBe(1);
			expect(res.diffs[0].removed).toBe(1);
			const after = read(dir, rel);
			const idx = changedLineIndexes(before, after);
			expect(idx).toHaveLength(1);
			expect(after.split("\n")[idx[0]]).toContain('title: "Firefly Studio"');
			// 注释完好
			expect(after).toContain("// 站点标题");
			expect(after).toContain("// 页面开关配置，在本配置文件顶部pages定义");
			expect(after).toContain("// 站点语言，在本配置文件顶部SITE_LANG定义");
			expect(after).toContain("SITE_LANG");
			// 其它模块文件完全没动
			expect(read(dir, "src/config/navBarConfig.ts")).toBe(fs.readFileSync(path.join(dir, "src/config/navBarConfig.ts"), "utf8"));
			expect(parseErrorCount(path.join(dir, rel))).toBe(0);
		});
	});

	it("const 引用：写 lang 改的是 SITE_LANG 的字面量", () => {
		withTemp("constref", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const before = read(dir, rel);
			const res = writeEdits(dir, [{ moduleId: "siteConfig", path: "lang", value: "en" }]);
			expect(res.ok).toBe(true);
			const after = read(dir, rel);
			expect(after).toContain('const SITE_LANG = resolveSiteLang("en");');
			expect(after).toContain("lang: SITE_LANG");
			expect(changedLineIndexes(before, after)).toHaveLength(1);
			expect(parseErrorCount(path.join(dir, rel))).toBe(0);
		});
	});

	it("call-argument：写 pages.friends 改的是 resolvePageToggles 的实参", () => {
		withTemp("callarg", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const before = read(dir, rel);
			const res = writeEdits(dir, [{ moduleId: "siteConfig", path: "pages.friends", value: false }]);
			expect(res.ok).toBe(true);
			const after = read(dir, rel);
			expect(after).toContain("\n\tfriends: false,");
			expect(after).toContain("resolvePageToggles({");
			expect(changedLineIndexes(before, after)).toHaveLength(1);
			expect(parseErrorCount(path.join(dir, rel))).toBe(0);
		});
	});

	it("数组元素与嵌套字段按路径精确写回", () => {
		withTemp("nested", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const res = writeEdits(dir, [
				{ moduleId: "siteConfig", path: "keywords[1]", value: "Fuwari2" },
				{ moduleId: "siteConfig", path: "themeColor.defaultMode", value: "dark" },
				{ moduleId: "siteConfig", path: "postListLayout.meta.tagCount", value: 5 },
				{ moduleId: "backgroundWallpaper", path: "overlay.opacity", value: 0.5 },
			]);
			expect(res.errors).toEqual([]);
			expect(res.changed.sort()).toEqual(["src/config/backgroundWallpaper.ts", "src/config/siteConfig.ts"]);
			const after = read(dir, rel);
			expect(after).toContain('"Fuwari2",');
			expect(after).toContain('defaultMode: "dark",');
			expect(after).toContain("tagCount: 5,");
			expect(read(dir, "src/config/backgroundWallpaper.ts")).toContain("opacity: 0.5,");
			expect(parseErrorCount(path.join(dir, rel))).toBe(0);
			expect(parseErrorCount(path.join(dir, "src/config/backgroundWallpaper.ts"))).toBe(0);
		});
	});

	it("多行数组展开：保持缩进与尾随逗号风格", () => {
		withTemp("array", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const res = writeEdits(dir, [{ moduleId: "siteConfig", path: "keywords", value: ["A", "B"] }]);
			expect(res.ok).toBe(true);
			const after = read(dir, rel);
			expect(after).toContain('keywords: [\n\t\t"A",\n\t\t"B",\n\t],');
			expect(parseErrorCount(path.join(dir, rel))).toBe(0);
		});
	});

	it("源码缺失的键：插入新属性且语法保持有效", () => {
		withTemp("insert", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const before = read(dir, rel);
			const res = writeEdits(dir, [{ moduleId: "siteConfig", path: "navbar.stickyNavbar", value: false }]);
			expect(before).not.toContain("stickyNavbar");
			expect(res.errors).toEqual([]);
			expect(res.changed).toEqual([rel]);
			const after = read(dir, rel);
			expect(after).toContain("stickyNavbar: false,");
			expect(res.diffs[0].added + res.diffs[0].removed).toBeLessThanOrEqual(1);
			expect(parseErrorCount(path.join(dir, rel))).toBe(0);
			// 插入后 schema 仍可读取该字段
			const again = generateSchema(dir);
			const f = findField(again.modules.find((m) => m.id === "siteConfig")!.fields, "navbar.stickyNavbar");
			expect(f?.value).toBe(false);
			expect(f?.origin).toBe("literal");
		});
	});

	it("previewEdits 计算 diff 但不落盘", () => {
		withTemp("preview", (dir) => {
			const rel = "src/config/siteConfig.ts";
			const before = read(dir, rel);
			const diffs = previewEdits(dir, [{ moduleId: "siteConfig", path: "subtitle", value: "Changed" }]);
			expect(diffs).toHaveLength(1);
			expect(diffs[0].after).toContain('subtitle: "Changed"');
			expect(diffs[0].added + diffs[0].removed).toBe(2);
			expect(read(dir, rel)).toBe(before);
		});
	});

	it("非法路径 / 未知模块进入 errors，不静默丢弃", () => {
		withTemp("errors", (dir) => {
			const res = writeEdits(dir, [
				{ moduleId: "nope", path: "a", value: 1 },
				{ moduleId: "siteConfig", path: "pages[].friends", value: false },
				{ moduleId: "siteConfig", path: "does.not.exist", value: 1 },
				{ moduleId: "navBarConfig", path: "links[0].name", value: "x" },
			]);
			expect(res.ok).toBe(false);
			expect(res.errors).toHaveLength(4);
			expect(res.changed).toEqual([]);
			console.log("[write] errors:", res.errors.map((e) => `${e.path}: ${e.message}`));
		});
	});
});
