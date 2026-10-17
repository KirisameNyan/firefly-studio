import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSchema } from "../../schema/generate";
import type { ConfigModule } from "../../../shared/contract";
import { FIREFLY_ROOT, FIXTURE_ROOT, findField, sliceOf } from "./_helpers";

function configFiles(root: string): string[] {
	return fs
		.readdirSync(path.join(root, "src", "config"))
		.filter((f) => f.endsWith(".ts"))
		.sort();
}

function moduleOf(modules: ConfigModule[], id: string): ConfigModule {
	const m = modules.find((x) => x.id === id);
	if (!m) throw new Error(`模块 ${id} 不存在；实际：${modules.map((x) => x.id).join(",")}`);
	return m;
}

describe("schema 生成（夹具 = Firefly 配置副本）", () => {
	const { modules, warnings } = generateSchema(FIXTURE_ROOT);

	it("为夹具里每个 src/config/*.ts 都生成了模块，且没有未捕获异常", () => {
		const files = configFiles(FIXTURE_ROOT);
		const covered = new Set(modules.map((m) => m.file));
		for (const f of files) expect(covered.has(`src/config/${f}`)).toBe(true);
		expect(modules.length).toBeGreaterThanOrEqual(files.length);
		expect(warnings.filter((w) => /失败|Maximum call/.test(w))).toEqual([]);
	});

	it("字段数量与模块元信息", () => {
		let count = 0;
		const walk = (m: ConfigModule) => {
			const rec = (ns: typeof m.fields): void => {
				for (const n of ns) {
					count++;
					if (n.children) rec(n.children);
					if (n.element) rec([n.element]);
				}
			};
			rec(m.fields);
		};
		for (const m of modules) walk(m);
		console.log(`[generate] 夹具模块 ${modules.length} 个，字段 ${count} 个，warnings ${warnings.length} 条`);
		expect(count).toBeGreaterThan(300);
		const site = moduleOf(modules, "siteConfig");
		expect(site.typeName).toBe("SiteConfig");
		expect(site.file).toBe("src/config/siteConfig.ts");
		expect(site.group).toBe("基础");
	});

	it("siteConfig.title：literal 来源，label 来自上方注释，loc 精确指向字面量", () => {
		const f = findField(moduleOf(modules, "siteConfig").fields, "title");
		expect(f).toBeDefined();
		if (!f) return;
		expect(f.kind).toBe("string");
		expect(f.origin).toBe("literal");
		expect(f.readOnly).toBe(false);
		expect(f.value).toBe("Firefly");
		expect(f.label).toBe("站点标题");
		expect(f.loc?.file).toBe("src/config/siteConfig.ts");
		expect(sliceOf(FIXTURE_ROOT, f)).toBe('"Firefly"');
	});

	it("siteConfig.lang：const 引用，写目标落在 SITE_LANG 的字面量上", () => {
		const f = findField(moduleOf(modules, "siteConfig").fields, "lang");
		expect(f).toBeDefined();
		if (!f) return;
		expect(f.kind).toBe("enum");
		expect(f.origin).toBe("const-reference");
		expect(f.value).toBe("zh_CN");
		expect(f.readOnly).toBe(false);
		expect(f.tsType).toBe('"en" | "zh_CN" | "zh_TW" | "ja" | "ru" | "ko"');
		const text = fs.readFileSync(path.join(FIXTURE_ROOT, f.loc!.file), "utf8");
		expect(text.slice(f.loc!.start, f.loc!.end)).toBe('"zh_CN"');
		// 该区间必须位于顶部 const SITE_LANG = resolveSiteLang("zh_CN") 的实参上
		expect(text.slice(f.loc!.start - 16, f.loc!.end + 1)).toBe('resolveSiteLang("zh_CN")');
		expect(f.options?.map((o) => o.value)).toEqual(["en", "zh_CN", "zh_TW", "ja", "ru", "ko"]);
	});

	it("siteConfig.pages.friends：call-argument 来源，loc 指向 resolvePageToggles 实参对象里的字面量", () => {
		const f = findField(moduleOf(modules, "siteConfig").fields, "pages.friends");
		expect(f).toBeDefined();
		if (!f) return;
		expect(f.origin).toBe("call-argument");
		expect(f.kind).toBe("boolean");
		expect(f.value).toBe(true);
		expect(f.readOnly).toBe(false);
		expect(f.label).toBe("友链页面开关");
		const text = fs.readFileSync(path.join(FIXTURE_ROOT, f.loc!.file), "utf8");
		expect(text.slice(f.loc!.start, f.loc!.end)).toBe("true");
		// 该行必须位于 resolvePageToggles({...}) 的实参对象内
		const before = text.slice(0, f.loc!.start);
		const callStart = before.lastIndexOf("resolvePageToggles(");
		const objStart = text.indexOf("siteConfig: SiteConfig", callStart);
		expect(callStart).toBeGreaterThan(-1);
		expect(objStart).toBeGreaterThan(f.loc!.end);
	});

	it("枚举字段：options 非空且包含常量值", () => {
		// typeof CONST 形式（常量来自 src/constants/constants.ts）
		const dm = findField(moduleOf(modules, "siteConfig").fields, "themeColor.defaultMode");
		expect(dm?.kind).toBe("enum");
		expect(dm?.options).toEqual([
			{ value: "light", label: "LIGHT_MODE" },
			{ value: "dark", label: "DARK_MODE" },
			{ value: "system", label: "SYSTEM_MODE" },
		]);
		expect(dm?.value).toBe("system");
		// navbar 相关枚举（字面量联合 + 类型别名）
		const menuAlign = findField(moduleOf(modules, "siteConfig").fields, "navbar.menuAlign");
		expect(menuAlign?.kind).toBe("enum");
		expect(menuAlign?.options?.map((o) => o.value)).toEqual(["left", "center"]);
		const navbarMode = findField(moduleOf(modules, "siteConfig").fields, "navbar.navbarMode");
		expect(navbarMode?.options?.map((o) => o.value)).toEqual(["static", "fixed", "dynamic"]);
		// wallpaper 相关枚举
		const wm = findField(moduleOf(modules, "backgroundWallpaper").fields, "mode");
		expect(wm?.kind).toBe("enum");
		expect(wm?.options?.map((o) => o.value)).toEqual(["banner", "fullscreen", "overlay", "none"]);
		expect(wm?.value).toBe("banner");
	});

	it("非对象导出（数组 / 映射）被优雅处理", () => {
		const fontsList = moduleOf(modules, "fontsList");
		expect(fontsList.typeName).toBe("FontDefinition[]");
		const root = fontsList.fields[0];
		expect(root.kind).toBe("objectArray");
		expect(root.value).toHaveLength(4);
		expect(root.loc).toBeDefined();
		expect(root.element?.path).toBe("fontsList[]");
		expect(root.element?.children?.map((c) => c.path)).toContain("fontsList[].name");

		const presets = moduleOf(modules, "LinkPresets");
		const homeName = findField(presets.fields, "Home.name");
		expect(homeName?.origin).toBe("literal");
		expect(homeName?.value).toBe("主页");
	});

	it("无法安全解析的字段进入 warnings，不静默丢弃", () => {
		expect(warnings.length).toBeGreaterThan(0);
		// siteConfig 的每个字段都必须出现在 schema 里（含只读/缺失字段）
		const site = moduleOf(modules, "siteConfig");
		const paths = new Set(site.fields.map((f) => f.path));
		for (const key of ["title", "lang", "pages", "navbar", "themeColor", "postListLayout", "imageOptimization", "feed"]) {
			expect(paths.has(key)).toBe(true);
		}
		console.log("[generate] warnings:", JSON.stringify(warnings.slice(0, 6), null, 1));
	});
});

describe("schema 生成（真实 Firefly 仓库）", () => {
	const hasFirefly = fs.existsSync(path.join(FIREFLY_ROOT, "src", "config"));
	it.skipIf(!hasFirefly)("全部 src/config/*.ts 生成模块，无未捕获异常，并给出字段数与 warnings", () => {
		const t0 = Date.now();
		const { modules, warnings } = generateSchema(FIREFLY_ROOT);
		const files = configFiles(FIREFLY_ROOT);
		let fields = 0;
		let enums = 0;
		let readOnly = 0;
		const rec = (ns: ConfigModule["fields"]): void => {
			for (const n of ns) {
				fields++;
				if (n.kind === "enum") enums++;
				if (n.readOnly) readOnly++;
				if (n.children) rec(n.children);
				if (n.element) rec([n.element]);
			}
		};
		for (const m of modules) rec(m.fields);
		const covered = new Set(modules.map((m) => m.file));
		for (const f of files) expect(covered.has(`src/config/${f}`)).toBe(true);
		console.log(
			`[generate/firefly] 文件 ${files.length} 个 → 模块 ${modules.length} 个，字段 ${fields} 个（枚举 ${enums}，只读 ${readOnly}），warnings ${warnings.length} 条，耗时 ${Date.now() - t0}ms`,
		);
		for (const m of modules) {
			console.log(`  ${m.file.padEnd(34)} ${m.id.padEnd(24)} ${m.group} fields=${m.fields.length} editable=${m.editable}`);
		}
		for (const w of warnings) console.log("  warn:", w);
		expect(warnings.filter((w) => /失败|Maximum call/.test(w))).toEqual([]);
		expect(modules.length).toBeGreaterThanOrEqual(files.length);
		expect(fields).toBeGreaterThan(300);
	});
});
