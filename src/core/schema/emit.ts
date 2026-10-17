import type { JsonValue } from "../../shared/contract";

export type EmitOpts = {
	indentUnit: string;
	level: number;
	multiline: boolean;
	quote: string;
};

export function isIdentifierLike(key: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

export function keyText(key: string): string {
	return isIdentifierLike(key) ? key : JSON.stringify(key);
}

function quoteString(s: string, q: string): string {
	if (q === "'" && !s.includes("'") && !/[\n\r\\]/.test(s)) return "'" + s + "'";
	return JSON.stringify(s);
}

/** 把 JsonValue 序列化成 TS 源码片段，缩进沿用原文件风格。 */
export function emitValue(v: JsonValue, o: EmitOpts): string {
	const child: EmitOpts = { ...o, level: o.level + 1 };
	if (v === null) return "null";
	if (typeof v === "boolean" || typeof v === "number") return String(v);
	if (typeof v === "string") return quoteString(v, o.quote);
	if (Array.isArray(v)) {
		if (!v.length) return "[]";
		if (!o.multiline) return "[" + v.map((x) => emitValue(x, { ...child, multiline: false })).join(", ") + "]";
		const pad = o.indentUnit.repeat(o.level + 1);
		const close = o.indentUnit.repeat(o.level);
		return "[\n" + v.map((x) => pad + emitValue(x, child)).join(",\n") + ",\n" + close + "]";
	}
	const keys = Object.keys(v);
	if (!keys.length) return "{}";
	if (!o.multiline) {
		return "{ " + keys.map((k) => keyText(k) + ": " + emitValue(v[k], { ...child, multiline: false })).join(", ") + " }";
	}
	const pad = o.indentUnit.repeat(o.level + 1);
	const close = o.indentUnit.repeat(o.level);
	return "{\n" + keys.map((k) => pad + keyText(k) + ": " + emitValue(v[k], child)).join(",\n") + ",\n" + close + "}";
}

/** 检测原片段里的字符串字面量引号风格，改写时尽量沿用。 */
export function detectQuote(text: string): string {
	const s = text.trim();
	return s.startsWith("'") ? "'" : '"';
}
