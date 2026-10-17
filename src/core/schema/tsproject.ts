import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** 去掉 JSONC 注释与尾随逗号，便于 JSON.parse。 */
export function stripJsonComments(text: string): string {
	let out = "";
	let inLine = false;
	let inBlock = false;
	let inStr = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const n = text[i + 1];
		if (inLine) {
			if (c === "\n") {
				inLine = false;
				out += c;
			}
			continue;
		}
		if (inBlock) {
			if (c === "*" && n === "/") {
				inBlock = false;
				i++;
			}
			continue;
		}
		if (inStr) {
			out += c;
			if (c === "\\") {
				out += n ?? "";
				i++;
			} else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') {
			inStr = true;
			out += c;
			continue;
		}
		if (c === "/" && n === "/") {
			inLine = true;
			i++;
			continue;
		}
		if (c === "/" && n === "*") {
			inBlock = true;
			i++;
			continue;
		}
		out += c;
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

export type PathsConfig = { baseUrl: string; paths: Record<string, string[]> };

/** 读取仓库 tsconfig 的 baseUrl / paths，并换算成绝对路径；@/* → src/*。 */
export function readTsconfigPaths(root: string, depth = 0): PathsConfig {
	const fallback: PathsConfig = { baseUrl: root, paths: {} };
	const tsconfig = path.join(root, "tsconfig.json");
	if (depth > 5 || !fs.existsSync(tsconfig)) return fallback;
	let json: { extends?: string; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
	try {
		json = JSON.parse(stripJsonComments(fs.readFileSync(tsconfig, "utf8")));
	} catch {
		return fallback;
	}
	const co = json.compilerOptions ?? {};
	let parent: PathsConfig | undefined;
	if (typeof json.extends === "string" && json.extends.startsWith(".")) {
		const target = path.resolve(root, json.extends);
		const parentRoot = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target);
		parent = readTsconfigPaths(parentRoot, depth + 1);
	}
	const baseUrl = co.baseUrl ? path.resolve(root, co.baseUrl) : (parent?.baseUrl ?? root);
	const paths: Record<string, string[]> = { ...(parent?.paths ?? {}) };
	for (const [key, values] of Object.entries(co.paths ?? {})) {
		paths[key] = values.map((v) => path.resolve(baseUrl, v).split(path.sep).join("/"));
	}
	return { baseUrl, paths };
}

export function createFireflyProgram(root: string, rootNames: string[]): ts.Program {
	const { baseUrl, paths } = readTsconfigPaths(root);
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		allowJs: false,
		noEmit: true,
		skipLibCheck: true,
		strict: false,
		resolveJsonModule: true,
		jsx: ts.JsxEmit.Preserve,
		baseUrl,
		paths,
		types: [],
		lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
	};
	return ts.createProgram({ rootNames, options });
}
