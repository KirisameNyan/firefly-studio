import ts from "typescript";

/** 从注释文本块里抽出 label（首行）与 help（其余行）。 */
export function commentToLabelHelp(comments: string[]): { label?: string; help?: string } {
	const lines: string[] = [];
	for (const c of comments) {
		const line = /^\s*\/\/(.*)$/.exec(c);
		if (line) {
			lines.push(line[1].trim());
			continue;
		}
		const block = /^\s*\/\*\*?([\s\S]*?)\*\/\s*$/.exec(c);
		if (block) {
			const body = block[1].split("\n").map((s) => s.replace(/^\s*\*\s?/, "").trim());
			while (body.length && !body[0]) body.shift();
			while (body.length && !body[body.length - 1]) body.pop();
			lines.push(...body);
			continue;
		}
		lines.push(c.trim());
	}
	const clean = lines.filter((s) => s.length > 0);
	if (!clean.length) return {};
	const label = clean[0].replace(/[：:]\s*$/, "");
	return clean.length > 1 ? { label, help: clean.slice(1).join("\n") } : { label };
}

/**
 * 取紧贴节点上方、与节点之间没有空行的连续注释块。
 * Firefly 用「段落分隔 + 注释」组织配置，只有紧邻的注释才属于该字段。
 */
export function leadingCommentBlock(node: ts.Node): string[] {
	const sf = node.getSourceFile();
	const text = sf.getFullText();
	const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
	const picked: string[] = [];
	let cursor = node.getStart(sf);
	for (let i = ranges.length - 1; i >= 0; i--) {
		const r = ranges[i];
		const between = text.slice(r.end, cursor);
		if (between.trim() !== "") break;
		if ((between.match(/\n/g)?.length ?? 0) > 1) break;
		picked.unshift(text.slice(r.pos, r.end));
		cursor = r.pos;
	}
	return picked;
}

/** 文件头注释（文件第一个 token 之前的注释）。 */
export function fileHeaderComment(sf: ts.SourceFile): string | undefined {
	const text = sf.getFullText();
	const ranges = ts.getLeadingCommentRanges(text, 0) ?? [];
	if (!ranges.length) return undefined;
	const first = ranges[0];
	if (text.slice(0, first.pos).trim() !== "") return undefined;
	return text.slice(first.pos, first.end);
}

/** 节点所在行的行首缩进。 */
export function lineIndent(node: ts.Node): string {
	const sf = node.getSourceFile();
	const text = sf.getFullText();
	const start = text.lastIndexOf("\n", node.getStart(sf) - 1) + 1;
	return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "\t";
}
