import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { FieldNode } from "../../../shared/contract";

export const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
/** 夹具：Firefly 配置文件的只读副本 */
export const FIXTURE_ROOT = path.join(STUDIO_ROOT, "test-fixtures", "firefly-config");
/** 真实 Firefly 仓库（只读引用） */
export const FIREFLY_ROOT = path.resolve(STUDIO_ROOT, "..", "Firefly");
/** 工作区内的临时工程目录（沙箱只允许写工作区） */
export const TEMP_ROOT = path.join(STUDIO_ROOT, "test-fixtures");

export function copyFixtureToTemp(label: string): string {
	const dir = fs.mkdtempSync(path.join(TEMP_ROOT, `.tmp-${label}-`));
	fs.cpSync(FIXTURE_ROOT, dir, { recursive: true });
	return dir;
}

export function makeTempDir(label: string): string {
	return fs.mkdtempSync(path.join(TEMP_ROOT, `.tmp-${label}-`));
}

export function rmrf(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

export function read(projectRoot: string, rel: string): string {
	return fs.readFileSync(path.join(projectRoot, rel), "utf8");
}

export function flatFields(nodes: FieldNode[], out: FieldNode[] = []): FieldNode[] {
	for (const n of nodes) {
		out.push(n);
		if (n.children) flatFields(n.children, out);
		if (n.element) flatFields([n.element], out);
	}
	return out;
}

export function findField(nodes: FieldNode[], fieldPath: string): FieldNode | undefined {
	return flatFields(nodes).find((n) => n.path === fieldPath);
}

export function sliceOf(projectRoot: string, field: FieldNode): string | undefined {
	if (!field.loc) return undefined;
	return read(projectRoot, field.loc.file).slice(field.loc.start, field.loc.end);
}

/** 用 TS 解析器检查文件语法是否完好（写回后必须仍然可解析）。 */
export function parseErrorCount(file: string): number {
	const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
	const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
	return diags.length;
}

/** before/after 中不同的行号（0 基）。 */
export function changedLineIndexes(before: string, after: string): number[] {
	const b = before.split("\n");
	const a = after.split("\n");
	const out: number[] = [];
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i);
	return out;
}
