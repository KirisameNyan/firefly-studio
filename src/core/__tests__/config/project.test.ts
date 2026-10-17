import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject, generateConfigModules, openProject } from "../../project";
import { FIXTURE_ROOT, makeTempDir, rmrf } from "../schema/_helpers";

describe("openProject / checkProject", () => {
	// A5 接线：posts 改由 A2 的 listPosts 提供，夹具没有文章目录所以仍为空数组，
	// 但 "posts 暂未接入" warning 已按要求移除（A1 原断言编码的是接线前的行为）。
	it("识别 Firefly 仓库并生成模块，posts 来自 listPosts（夹具无文章目录 → 空）", () => {
		const p = openProject(FIXTURE_ROOT);
		expect(p.isFirefly).toBe(true);
		expect(p.fireflyVersion).toBe("6.16.8");
		expect(p.root).toBe(FIXTURE_ROOT);
		expect(p.problems).toEqual([]);
		expect(p.modules.length).toBeGreaterThanOrEqual(24);
		expect(p.posts).toEqual([]);
		expect(p.warnings.some((w) => w.includes("暂未接入"))).toBe(false);
		expect(p.modules.some((m) => m.id === "siteConfig")).toBe(true);
	});

	it("生成结果符合 ConfigModule 契约的关键约束", () => {
		const modules = generateConfigModules(FIXTURE_ROOT);
		for (const m of modules) {
			expect(m.id).toBe(m.exportName);
			expect(m.file.startsWith("src/config/")).toBe(true);
			expect(typeof m.title).toBe("string");
			expect(["基础", "外观", "内容", "集成", "其他"]).toContain(m.group);
			expect(Array.isArray(m.fields)).toBe(true);
		}
		const site = modules.find((m) => m.id === "siteConfig")!;
		const walk = (ns: typeof site.fields): void => {
			for (const n of ns) {
				expect(typeof n.path).toBe("string");
				expect(["literal", "const-reference", "call-argument", "computed", "absent"]).toContain(n.origin);
				expect(n.readOnly).toBe(n.origin === "computed" || n.kind === "unknown");
				if (n.loc) {
					expect(fs.existsSync(path.join(FIXTURE_ROOT, n.loc.file))).toBe(true);
					expect(n.loc.end).toBeGreaterThan(n.loc.start);
				}
				if (n.children) walk(n.children);
				if (n.element) walk([n.element]);
			}
		};
		walk(site.fields);
	});

	it("非 Firefly 目录：isFirefly=false 并给出 problems", () => {
		const dir = makeTempDir("notfirefly");
		try {
			const check = checkProject(dir);
			expect(check.isFirefly).toBe(false);
			expect(check.problems.join("|")).toContain("缺少 src/config");
			const p = openProject(dir);
			expect(p.modules).toEqual([]);
			expect(p.warnings.some((w) => w.includes("src/config"))).toBe(true);
		} finally {
			rmrf(dir);
		}
	});
});
