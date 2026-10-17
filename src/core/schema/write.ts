import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ConfigEdit, FileDiff, JsonValue, WriteError, WriteResult } from "../../shared/contract";
import { detectQuote, emitValue, keyText } from "./emit";
import { loadSchema } from "./generate";
import { lineIndent } from "./text";
import { evalLiteral, isPureLiteral, propertyNameOf, reduceLeaf, unwrap, valueExpressionOf } from "./values";

type Step = { name?: string; index?: number };
type TextEdit = { start: number; end: number; text: string };

type NavResult =
	| { kind: "target"; node: ts.Expression }
	| { kind: "insert"; obj: ts.ObjectLiteralExpression; key: string }
	| { kind: "error"; message: string };

/** "a.b[0].c" → [{name:a},{name:b},{index:0},{name:c}] */
export function tokenizePath(p: string): Step[] | null {
	const out: Step[] = [];
	for (const part of p.split(".")) {
		const m = /^([^\[\]]*)((?:\[\d+\])*)$/.exec(part);
		if (!m) return null;
		if (m[1]) out.push({ name: m[1] });
		for (const idx of m[2].match(/\[\d+\]/g) ?? []) out.push({ index: Number(idx.slice(1, -1)) });
	}
	return out.length ? out : null;
}

function findProp(obj: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralElementLike | undefined {
	for (const p of obj.properties) if (propertyNameOf(p) === key) return p;
	return undefined;
}

function navigate(checker: ts.TypeChecker, rootExpr: ts.Expression, p: string, exportName?: string): NavResult {
	const steps = tokenizePath(p);
	if (!steps) return { kind: "error", message: `路径 "${p}" 语法无法识别` };
	const start = reduceLeaf(checker, rootExpr);
	if (!start) return { kind: "error", message: "模块根值不是可定位的字面量" };
	while (steps.length > 0 && exportName && steps[0].name === exportName && !ts.isObjectLiteralExpression(start)) steps.shift();
	let cur: ts.Expression = start;
	let i = 0;
	while (i < steps.length) {
		const step = steps[i];
		if (step.index !== undefined) {
			if (!ts.isArrayLiteralExpression(cur))
				return { kind: "error", message: `路径 "${p}"：第 ${i + 1} 段期望数组字面量` };
			const el = cur.elements[step.index];
			if (!el) return { kind: "error", message: `路径 "${p}"：索引 ${step.index} 越界` };
			cur = reduceLeaf(checker, el) ?? el;
			i++;
			continue;
		}
		if (!ts.isObjectLiteralExpression(cur))
			return { kind: "error", message: `路径 "${p}"："${step.name}" 的上一级不是对象字面量` };
		let matched: ts.ObjectLiteralElementLike | undefined;
		let matchedEnd = -1;
		for (let k = steps.length - 1; k >= i; k--) {
			if (steps[k].index !== undefined) continue;
			const candidate = steps.slice(i, k + 1).map((s) => s.name).join(".");
			const prop = findProp(cur, candidate);
			if (prop) {
				matched = prop;
				matchedEnd = k + 1;
				break;
			}
		}
		if (!matched) {
			if (steps.length - i === 1) return { kind: "insert", obj: cur, key: step.name! };
			return { kind: "error", message: `路径 "${p}"：未找到键 "${step.name}"` };
		}
		const valueExpr = valueExpressionOf(matched, checker);
		if (!valueExpr) return { kind: "error", message: `路径 "${p}"：属性 "${step.name}" 不是普通赋值` };
		const next = reduceLeaf(checker, valueExpr);
		if (!next) return { kind: "error", message: `路径 "${p}"：属性 "${step.name}" 的值不是可写回的字面量` };
		cur = next;
		i = matchedEnd;
	}
	return { kind: "target", node: cur };
}

function detectIndentUnit(text: string): string {
	let best = "";
	for (const line of text.split("\n")) {
		const m = /^([ \t]+)\S/.exec(line);
		if (!m) continue;
		const run = m[1];
		if (!best || run.length < best.length) best = run;
	}
	if (!best) return "\t";
	return best.includes("\t") ? "\t" : best;
}

function levelOf(node: ts.Node, indentUnit: string): number {
	const indent = lineIndent(node);
	if (!indentUnit.length) return 1;
	return Math.max(1, Math.round(indent.split(indentUnit).length - 1));
}

function canonical(v: JsonValue): string {
	if (v === null) return "null";
	if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
	if (typeof v === "object")
		return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
	return JSON.stringify(v);
}

function insertionEdit(obj: ts.ObjectLiteralExpression, key: string, value: JsonValue, text: string): TextEdit {
	const sf = obj.getSourceFile();
	const closeBrace = obj.getEnd() - 1;
	const indentUnit = detectIndentUnit(text);
	const props = obj.properties;
	const last = props.length ? props[props.length - 1] : undefined;
	const spanStart = last ? last.getEnd() : obj.getStart(sf) + 1;
	const between = text.slice(spanStart, closeBrace);
	const comma = /^\s*,/.exec(between);
	const hasComma = !!comma;
	const multiline = text.slice(obj.getStart(sf), closeBrace).includes("\n");
	const insertAt = last ? last.getEnd() + (comma ? comma[0].length : 0) : closeBrace;
	const at: TextEdit = { start: insertAt, end: insertAt, text: "" };
	if (!last) {
		at.text = multiline
			? "\n" + lineIndent(obj) + indentUnit + keyText(key) + ": " + emitValue(value, { indentUnit, level: levelOf(obj, indentUnit) + 1, multiline: false, quote: '"' }) + ",\n" + lineIndent(obj)
			: keyText(key) + ": " + emitValue(value, { indentUnit, level: 0, multiline: false, quote: '"' });
		return at;
	}
	if (!multiline) {
		at.start = closeBrace;
		at.end = closeBrace;
		at.text = (hasComma ? " " : ", ") + keyText(key) + ": " + emitValue(value, { indentUnit, level: 0, multiline: false, quote: '"' });
		return at;
	}
	const indent = lineIndent(last);
	at.text =
		(hasComma ? "" : ",") +
		"\n" +
		indent +
		keyText(key) +
		": " +
		emitValue(value, { indentUnit, level: levelOf(last, indentUnit), multiline: false, quote: '"' }) +
		",";
	return at;
}

function lineDiff(before: string, after: string): { added: number; removed: number } {
	const a = before.split("\n");
	const b = after.split("\n");
	const n = a.length;
	const m = b.length;
	if (n * m > 4_000_000) {
		const countA = new Map<string, number>();
		const countB = new Map<string, number>();
		for (const l of a) countA.set(l, (countA.get(l) ?? 0) + 1);
		for (const l of b) countB.set(l, (countB.get(l) ?? 0) + 1);
		let added = 0;
		let removed = 0;
		for (const [l, c] of countB) added += Math.max(0, c - (countA.get(l) ?? 0));
		for (const [l, c] of countA) removed += Math.max(0, c - (countB.get(l) ?? 0));
		return { added, removed };
	}
	const width = m + 1;
	const dp = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i * width + j] =
				a[i] === b[j] ? dp[(i + 1) * width + (j + 1)] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
		}
	}
	const lcs = dp[0];
	return { removed: n - lcs, added: m - lcs };
}

function applyEdits(root: string, edits: ConfigEdit[], persist: boolean): WriteResult {
	const errors: WriteError[] = [];
	const handle = loadSchema(root);
	const byFile = new Map<string, TextEdit[]>();
	const originals = new Map<string, string>();

	const push = (file: string, edit: TextEdit, original: string) => {
		originals.set(file, original);
		const list = byFile.get(file) ?? [];
		list.push(edit);
		byFile.set(file, list);
	};

	for (const edit of edits) {
		const exp = handle.exports.get(edit.moduleId);
		if (!exp) {
			errors.push({ path: edit.path, message: `未知配置模块 "${edit.moduleId}"` });
			continue;
		}
		if (!exp.decl.initializer) {
			errors.push({ path: edit.path, message: `模块 "${edit.moduleId}" 没有初始化表达式` });
			continue;
		}
		const nav = navigate(handle.checker, exp.decl.initializer, edit.path, exp.name);
		if (nav.kind === "error") {
			errors.push({ path: edit.path, message: nav.message });
			continue;
		}
		if (nav.kind === "insert") {
			const sf = nav.obj.getSourceFile();
			push(sf.fileName, insertionEdit(nav.obj, nav.key, edit.value, sf.getFullText()), sf.getFullText());
			continue;
		}
		const target = nav.node;
		const sf = target.getSourceFile();
		const original = target.getText(sf);
		const current = evalLiteral(target);
		if (current !== undefined && canonical(current) === canonical(edit.value)) continue;
		if ((ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)) && !isPureLiteral(target)) {
			errors.push({ path: edit.path, message: "目标含非字面量元素，无法整体替换（请逐项编辑）" });
			continue;
		}
		const text = sf.getFullText();
		const indentUnit = detectIndentUnit(text);
		const payload = emitValue(edit.value, {
			indentUnit,
			level: levelOf(target, indentUnit),
			multiline: original.includes("\n"),
			quote: detectQuote(original),
		});
		push(sf.fileName, { start: target.getStart(sf), end: target.getEnd(), text: payload }, text);
	}

	const changed: string[] = [];
	const diffs: FileDiff[] = [];
	for (const [file, list] of byFile) {
		const sorted = [...list].sort((x, y) => x.start - y.start);
		let overlap: TextEdit | null = null;
		for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) overlap = sorted[i];
		if (overlap) {
			errors.push({ path: path.relative(root, file), message: "同一文件内有多处编辑区间重叠，已放弃该文件" });
			continue;
		}
		const before = originals.get(file) ?? fs.readFileSync(file, "utf8");
		let after = before;
		for (const e of [...sorted].sort((x, y) => y.start - x.start)) {
			after = after.slice(0, e.start) + e.text + after.slice(e.end);
		}
		if (after === before) continue;
		if (persist) fs.writeFileSync(file, after, "utf8");
		const rel = path.relative(root, file).split(path.sep).join("/");
		const { added, removed } = lineDiff(before, after);
		changed.push(rel);
		diffs.push({ file: rel, before, after, added, removed });
	}

	return { ok: errors.length === 0, changed, diffs, errors };
}

/** 预览：只计算 diff，不落盘。 */
export function previewEdits(root: string, edits: ConfigEdit[]): FileDiff[] {
	return applyEdits(root, edits, false).diffs;
}

/** 写回：文本区间替换，保留原有注释、缩进与其它字段字节不变。 */
export function writeEdits(root: string, edits: ConfigEdit[]): WriteResult {
	return applyEdits(root, edits, true);
}
