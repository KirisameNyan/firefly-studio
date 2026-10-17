import fs from "node:fs";
import path from "node:path";
import type { ConfigModule, PostSummary, ProjectCheck, StudioProject } from "../shared/contract";
import { listPosts } from "./posts";
import { loadSchema } from "./schema/generate";

/** 检测目录是否是合法的 Firefly 仓库（只读，不修改任何文件）。 */
export function checkProject(root: string): ProjectCheck {
	const absRoot = path.resolve(root);
	const problems: string[] = [];
	let fireflyVersion: string | undefined;
	let pkgName: string | undefined;
	const pkgPath = path.join(absRoot, "package.json");
	if (!fs.existsSync(pkgPath)) problems.push("缺少 package.json");
	else {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
			pkgName = pkg.name;
			fireflyVersion = pkg.version;
		} catch {
			problems.push("package.json 无法解析");
		}
	}
	const configDir = path.join(absRoot, "src", "config");
	const hasConfig = fs.existsSync(configDir);
	if (!hasConfig) problems.push("缺少 src/config 目录");
	if (!fs.existsSync(path.join(absRoot, "tsconfig.json"))) problems.push("缺少 tsconfig.json（无法解析 @/* 路径别名）");
	const isFirefly = pkgName === "firefly" || hasConfig;
	return { isFirefly, root: absRoot, fireflyVersion, problems };
}

/** 生成全部配置模块 schema。 */
export function generateConfigModules(root: string): ConfigModule[] {
	return loadSchema(root).modules;
}

/**
 * 打开项目：返回模块 schema 与文章索引。
 * posts 来自 A2 的 listPosts；文章索引读取失败只记 warning，不影响配置模块的可用性。
 */
export function openProject(root: string): StudioProject {
	const check = checkProject(root);
	let modules: ConfigModule[] = [];
	const warnings: string[] = [];
	if (check.problems.some((p) => p.startsWith("缺少 src/config"))) {
		warnings.push("未找到 src/config 目录，未生成任何配置模块");
	} else {
		try {
			const handle = loadSchema(check.root);
			modules = handle.modules;
			warnings.push(...handle.warnings);
		} catch (err) {
			warnings.push(`生成配置 schema 失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}
	let posts: PostSummary[] = [];
	try {
		posts = listPosts(check.root);
	} catch (err) {
		warnings.push(`读取文章索引失败：${err instanceof Error ? err.message : String(err)}`);
	}
	return { ...check, modules, posts, warnings };
}
