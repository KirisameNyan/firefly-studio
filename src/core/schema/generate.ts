import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
	ConfigModule,
	FieldKind,
	FieldNode,
	JsonValue,
	SourceLoc,
	ValueOrigin,
} from "../../shared/contract";
import { classifyType, type TypeInfo } from "./classify";
import { commentToLabelHelp, fileHeaderComment, leadingCommentBlock } from "./text";
import { createFireflyProgram } from "./tsproject";
import {
	evalLiteral,
	isConst,
	isPureLiteral,
	propertyNameOf,
	reduceLeaf,
	resolveSymbol,
	unwrap,
	valueExpressionOf,
} from "./values";

const MAX_WARNINGS = 400;
const MAX_DEPTH = 12;

export type SchemaExport = { name: string; decl: ts.VariableDeclaration; sf: ts.SourceFile };

export type SchemaHandle = {
	root: string;
	modules: ConfigModule[];
	warnings: string[];
	checker: ts.TypeChecker;
	exports: Map<string, SchemaExport>;
};

type Ctx = { root: string; checker: ts.TypeChecker; warnings: string[]; seen: Set<string> };

type BuildCtx = {
	moduleId: string;
	sf: ts.SourceFile;
	/** 值的来源：由上级的解析结果传递下来 */
	carried: ValueOrigin;
	/** objectArray 元素模板：只给结构，不给值与 loc */
	template: boolean;
	emitLoc: boolean;
	depth: number;
	ancestors: Set<ts.Symbol>;
};

type Analysis = { origin: ValueOrigin; leaf: ts.Expression | null; reason?: string };

const GROUPS: [string, RegExp][] = [
	["基础", /siteconfig|profile|license|displaysettings|announcement|navbar|sidebar|pagination|footer/i],
	["外观", /wallpaper|font|effect|sakura|coverimage|background|icon|style/i],
	["内容", /comment|music|friend|sponsor|dynamic|booknav|gallery|post|content|article|feed/i],
	["集成", /analytic|expressive|mermaid|plantuml|pio|live2d|search|mal|bangumi|vndb|bilibili|github/i],
];

export function groupOf(id: string): string {
	for (const [group, re] of GROUPS) if (re.test(id)) return group;
	return "其他";
}

function relTo(ctx: Ctx, abs: string): string {
	return path.relative(ctx.root, abs).split(path.sep).join("/");
}

function locOf(ctx: Ctx, node: ts.Node): SourceLoc {
	const sf = node.getSourceFile();
	return { file: relTo(ctx, sf.fileName), start: node.getStart(sf), end: node.getEnd() };
}

function short(text: string, n = 60): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length > n ? t.slice(0, n) + "…" : t;
}

function warn(ctx: Ctx, message: string): void {
	if (ctx.seen.has(message)) return;
	ctx.seen.add(message);
	if (ctx.warnings.length < MAX_WARNINGS) ctx.warnings.push(message);
	else if (ctx.warnings.length === MAX_WARNINGS) ctx.warnings.push(`… 警告已截断（上限 ${MAX_WARNINGS} 条）`);
}

/** 判断字段值的来源（literal / const-reference / call-argument / computed / absent）与真实字面量节点。 */
function analyzeValue(ctx: Ctx, expr: ts.Expression | undefined, carried: ValueOrigin, template: boolean): Analysis {
	if (!expr) {
		if (template) return { origin: carried === "absent" ? "literal" : carried, leaf: null };
		return { origin: carried === "computed" ? "computed" : "absent", leaf: null };
	}
	const e = unwrap(expr);
	if (isPureLiteral(e)) return { origin: carried, leaf: e };
	if (ts.isObjectLiteralExpression(e)) return { origin: carried === "computed" ? "literal" : carried, leaf: e };
	if (ts.isArrayLiteralExpression(e))
		return {
			origin: carried === "computed" ? "computed" : carried,
			leaf: e,
			reason: isPureLiteral(e) ? undefined : "数组含非字面量元素，仅支持逐项编辑",
		};
	if (ts.isIdentifier(e)) {
		const sym = resolveSymbol(ctx.checker, ctx.checker.getSymbolAtLocation(e));
		const decl = sym?.declarations?.find((x): x is ts.VariableDeclaration => ts.isVariableDeclaration(x));
		if (decl?.initializer && decl.getSourceFile() === e.getSourceFile() && isConst(decl)) {
			const leaf = reduceLeaf(ctx.checker, decl.initializer);
			if (leaf) return { origin: "const-reference", leaf };
			return { origin: "computed", leaf: null, reason: "同文件 const 无法化简为字面量" };
		}
		if (decl?.initializer && decl.getSourceFile() !== e.getSourceFile())
			return { origin: "computed", leaf: null, reason: "引用了其它文件的常量，改写会影响其它模块" };
		return { origin: "computed", leaf: null, reason: `引用 ${short(e.getText(e.getSourceFile()))} 无法解析为字面量` };
	}
	if (ts.isCallExpression(e)) {
		const callee = short(e.expression.getText(e.getSourceFile()));
		const leaf = e.arguments.length ? reduceLeaf(ctx.checker, e.arguments[0]) : null;
		if (leaf) return { origin: "call-argument", leaf };
		return {
			origin: "computed",
			leaf: null,
			reason: e.arguments.length ? `调用 ${callee}(…) 的实参无法化简为字面量` : `调用 ${callee}() 没有可解析的实参`,
		};
	}
	return { origin: "computed", leaf: null, reason: `表达式 ${short(e.getText(e.getSourceFile()))} 不是可写回的字面量` };
}

function findProperty(obj: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralElementLike | undefined {
	for (const p of obj.properties) if (propertyNameOf(p) === key) return p;
	return undefined;
}

function typeNodeOf(decl: ts.Declaration | undefined): ts.TypeNode | undefined {
	if (!decl) return undefined;
	if (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) return decl.type;
	return undefined;
}

function optionalOf(decl: ts.Declaration | undefined): boolean {
	if (decl && (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl)))
		return !!decl.questionToken;
	return true;
}

function symbolOf(type: ts.Type | undefined): ts.Symbol | undefined {
	return type && type.flags & ts.TypeFlags.Object ? type.getSymbol() : undefined;
}

function childCtx(bctx: BuildCtx, sym: ts.Symbol | undefined, carried: ValueOrigin): BuildCtx {
	const ancestors = new Set(bctx.ancestors);
	if (sym) ancestors.add(sym);
	return { ...bctx, carried, depth: bctx.depth + 1, ancestors };
}

function buildFields(
	ctx: Ctx,
	type: ts.Type | undefined,
	objLit: ts.ObjectLiteralExpression | undefined,
	bctx: BuildCtx,
	prefix: string,
	recordValue?: { type: ts.Type | undefined; typeNode: ts.TypeNode | undefined },
): FieldNode[] {
	const out: FieldNode[] = [];
	if (bctx.depth > MAX_DEPTH) {
		warn(ctx, `${bctx.moduleId}.${prefix || "<root>"}: 嵌套超过 ${MAX_DEPTH} 层，已截断`);
		return out;
	}
	const known = new Set<string>();
	for (const prop of type ? type.getProperties() : []) {
		const name = prop.getName();
		if (name.startsWith("__")) continue;
		if (prop.flags & ts.SymbolFlags.Method) {
			warn(ctx, `${bctx.moduleId}.${prefix ? prefix + "." : ""}${name}: 成员是方法，不作为配置字段`);
			continue;
		}
		const decl = prop.valueDeclaration ?? prop.declarations?.[0];
		known.add(name);
		out.push(
			buildField(ctx, {
				key: name,
				propType: ctx.checker.getTypeOfSymbolAtLocation(prop, decl ?? objLit ?? bctx.sf),
				typeNode: typeNodeOf(decl),
				optional: optionalOf(decl),
				commentSource: decl,
				objLit,
				bctx,
				prefix,
			}),
		);
	}
	if (objLit) {
		for (const m of objLit.properties) {
			const nm = propertyNameOf(m);
			if (nm === undefined) {
				if (ts.isSpreadAssignment(m))
					warn(
						ctx,
						`${bctx.moduleId}.${prefix || "<root>"}: 使用展开语法 …${short(m.expression.getText(m.getSourceFile()))}，无法逐字段解析`,
					);
				else warn(ctx, `${bctx.moduleId}.${prefix || "<root>"}: 存在非普通属性（getter/setter 等），已跳过`);
				continue;
			}
			if (known.has(nm)) continue;
			if (!recordValue) warn(ctx, `${bctx.moduleId}.${prefix ? prefix + "." : ""}${nm}: 类型声明中没有该键，按未知字段只读展示`);
			out.push(
				buildField(ctx, {
					key: nm,
					propType: recordValue?.type,
					typeNode: recordValue?.typeNode,
					optional: true,
					commentSource: m,
					objLit,
					bctx,
					prefix,
					untyped: !recordValue,
				}),
			);
		}
	}
	return out;
}

type FieldArgs = {
	key: string;
	propType: ts.Type | undefined;
	typeNode: ts.TypeNode | undefined;
	optional: boolean;
	commentSource: ts.Node | undefined;
	objLit: ts.ObjectLiteralExpression | undefined;
	/** 直接指定取值表达式（用于模块根节点，AST 里没有对应属性名） */
	valueExpr?: ts.Expression;
	bctx: BuildCtx;
	prefix: string;
	untyped?: boolean;
};

function buildField(ctx: Ctx, args: FieldArgs): FieldNode {
	const { key, bctx, prefix } = args;
	const fieldPath = prefix ? `${prefix}.${key}` : key;
	const astProp = args.objLit ? findProperty(args.objLit, key) : undefined;
	const valueExpr = args.valueExpr ?? (astProp ? valueExpressionOf(astProp, ctx.checker) : undefined);
	const info: TypeInfo = args.untyped
		? { kind: "unknown", tsType: "unknown", degraded: "类型声明中没有该键" }
		: classifyType(ctx.checker, args.propType, args.typeNode);
	const analysis = analyzeValue(ctx, valueExpr, bctx.carried, bctx.template);
	const cfgComment = astProp ? commentToLabelHelp(leadingCommentBlock(astProp)) : {};
	const typeComment = args.commentSource ? commentToLabelHelp(leadingCommentBlock(args.commentSource)) : {};
	const label = cfgComment.label ?? typeComment.label ?? key;
	const help =
		cfgComment.help ?? typeComment.help ?? (typeComment.label && typeComment.label !== label ? typeComment.label : undefined);

	const writable = analysis.origin === "literal" || analysis.origin === "const-reference" || analysis.origin === "call-argument";
	const leaf = analysis.leaf;
	const leafUnwrapped = leaf ? unwrap(leaf) : undefined;
	const objectContainer: ts.ObjectLiteralExpression | undefined =
		leafUnwrapped && ts.isObjectLiteralExpression(leafUnwrapped) ? leafUnwrapped : undefined;
	const arrayContainer: ts.ArrayLiteralExpression | undefined =
		leafUnwrapped && ts.isArrayLiteralExpression(leafUnwrapped) ? leafUnwrapped : undefined;

	let kind: FieldKind = info.kind;
	let value: JsonValue | undefined;
	let loc: SourceLoc | undefined;
	let children: FieldNode[] | undefined;
	let element: FieldNode | undefined;

	if (!bctx.template && leaf) {
		const v = evalLiteral(leaf);
		if (v !== undefined) value = v;
	}
	if (kind === "string" && ((label + " " + (help ?? "")).match(/多行|换行/) || (typeof value === "string" && value.includes("\n"))))
		kind = "text";

	const warnKey = `${bctx.moduleId}${fieldPath.startsWith(bctx.moduleId) ? fieldPath.slice(bctx.moduleId.length) : "." + fieldPath}`;
	if (info.degraded) warn(ctx, `${warnKey}: ${info.degraded}`);
	if (analysis.origin === "computed" && analysis.reason) warn(ctx, `${warnKey}: 只读（${analysis.reason}）`);

	if (!writable) {
		kind = kind;
	} else if (kind === "object") {
		const sym = symbolOf(args.propType);
		if (sym && bctx.ancestors.has(sym)) {
			children = [];
			warn(ctx, `${warnKey}: 自引用类型 ${sym.getName()}，已截断`);
		} else {
			children = buildFields(
				ctx,
				args.propType,
				objectContainer,
				childCtx(bctx, sym, analysis.origin),
				fieldPath,
			);
		}
	} else if (kind === "record") {
		const sym = symbolOf(args.propType);
		if (sym && bctx.ancestors.has(sym)) {
			children = [];
			warn(ctx, `${warnKey}: 自引用类型 ${sym.getName()}，已截断`);
		} else if (objectContainer) {
			children = buildFields(ctx, undefined, objectContainer, childCtx(bctx, sym, analysis.origin), fieldPath, info.recordValue);
		} else {
			children = [];
			if (analysis.origin === "absent") warn(ctx, `${warnKey}: Record 类型且源码中没有字面量，无法枚举键`);
		}
	} else if (kind === "objectArray") {
		element = buildElementTemplate(ctx, info, analysis.origin, fieldPath, bctx, warnKey);
		if (arrayContainer && isPureLiteral(arrayContainer)) loc = locOf(ctx, arrayContainer);
	} else if (kind === "stringArray" || kind === "numberArray") {
		if (arrayContainer && isPureLiteral(arrayContainer)) loc = locOf(ctx, arrayContainer);
	} else if (leaf && !objectContainer && !arrayContainer && bctx.emitLoc && kind !== "unknown") {
		loc = locOf(ctx, leaf);
	}

	let readOnly = analysis.origin === "computed" || kind === "unknown";
	if (analysis.origin === "absent") readOnly = kind === "unknown";
	if (bctx.template && analysis.origin !== "computed") readOnly = false;
	if (readOnly) loc = undefined;

	const node: FieldNode = {
		path: fieldPath,
		key,
		label,
		help,
		kind,
		optional: args.optional,
		origin: analysis.origin,
		readOnly,
		tsType: info.tsType,
	};
	if (info.options) node.options = info.options;
	if (value !== undefined) node.value = value;
	if (loc) node.loc = loc;
	if (children) node.children = children;
	if (element) node.element = element;
	return node;
}

function buildElementTemplate(
	ctx: Ctx,
	info: TypeInfo,
	carried: ValueOrigin,
	fieldPath: string,
	bctx: BuildCtx,
	warnKey: string,
): FieldNode {
	const elType = info.element?.type;
	const elNode = info.element?.typeNode;
	const elInfo = classifyType(ctx.checker, elType, elNode);
	const p = `${fieldPath}[]`;
	const node: FieldNode = {
		path: p,
		key: "[]",
		label: "元素",
		kind: elInfo.kind,
		optional: false,
		origin: carried === "computed" ? "computed" : carried,
		readOnly: false,
		tsType: elInfo.tsType,
	};
	if (elInfo.options) node.options = elInfo.options;
	const sym = symbolOf(elType);
	if (elInfo.kind === "object" && sym && bctx.ancestors.has(sym)) {
		node.children = [];
		warn(ctx, `${warnKey}: 自引用类型 ${sym.getName()}，元素模板已截断`);
	} else if (elInfo.kind === "object") {
		node.children = buildFields(ctx, elType, undefined, childCtx(bctx, sym, carried), p);
	} else if (elInfo.kind === "record" || elInfo.kind === "objectArray") {
		node.children = [];
	}
	return node;
}

function exportedValueDecls(sf: ts.SourceFile): ts.VariableDeclaration[] {
	const out: ts.VariableDeclaration[] = [];
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		const modifiers = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
		if (!(modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
		for (const decl of st.declarationList.declarations) {
			const init = decl.initializer;
			if (!init) continue;
			if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue;
			out.push(decl);
		}
	}
	return out;
}

function flatten(nodes: FieldNode[], out: FieldNode[] = []): FieldNode[] {
	for (const n of nodes) {
		out.push(n);
		if (n.children) flatten(n.children, out);
		if (n.element) flatten([n.element], out);
	}
	return out;
}

function buildModule(ctx: Ctx, sf: ts.SourceFile, decl: ts.VariableDeclaration): ConfigModule | null {
	const exportName = decl.name.getText(sf);
	const typeNode = decl.type;
	const init = decl.initializer;
	if (!init) {
		warn(ctx, `${exportName}: 没有初始化表达式，已跳过`);
		return null;
	}
	const type = typeNode ? ctx.checker.getTypeFromTypeNode(typeNode) : ctx.checker.getTypeAtLocation(init);
	const info = classifyType(ctx.checker, type, typeNode);
	const rootAnalysis = analyzeValue(ctx, init, "literal", false);
	const bctx: BuildCtx = {
		moduleId: exportName,
		sf,
		carried: rootAnalysis.origin,
		template: false,
		emitLoc: true,
		depth: 0,
		ancestors: new Set(symbolOf(type) ? [symbolOf(type)!] : []),
	};
	const rootLeaf = rootAnalysis.leaf ? unwrap(rootAnalysis.leaf) : undefined;
	const rootObj: ts.ObjectLiteralExpression | undefined =
		rootLeaf && ts.isObjectLiteralExpression(rootLeaf) ? rootLeaf : undefined;

	let fields: FieldNode[];
	if (info.kind === "object" && rootAnalysis.origin !== "computed") {
		fields = buildFields(ctx, type, rootObj, bctx, "");
	} else if (info.kind === "record" && rootObj) {
		fields = buildFields(ctx, undefined, rootObj, bctx, "", info.recordValue);
		if (!fields.length) {
			fields = [buildField(ctx, { key: exportName, propType: type, typeNode, optional: false, commentSource: decl, objLit: rootObj, valueExpr: init, bctx, prefix: "" })];
			fields[0].path = exportName;
		}
	} else {
		fields = [buildField(ctx, {
			key: exportName,
			propType: type,
			typeNode,
			optional: false,
			commentSource: decl,
			objLit: rootObj,
			valueExpr: init,
			bctx,
			prefix: "",
		})];
		fields[0].path = exportName;
	}

	const header = fileHeaderComment(sf);
	const headerInfo = header ? commentToLabelHelp([header]) : {};
	const flat = flatten(fields);
	const writable = flat.filter(
		(f) => !f.readOnly && f.kind !== "object" && f.kind !== "record" && f.kind !== "objectArray",
	).length;
	const readOnlyCount = flat.filter((f) => f.readOnly).length;
	const module_: ConfigModule = {
		id: exportName,
		file: relTo(ctx, sf.fileName),
		exportName,
		title: headerInfo.label ?? exportName,
		group: groupOf(exportName),
		fields,
		editable: writable > 0 && writable >= readOnlyCount,
	};
	if (typeNode) {
		module_.typeName =
			ts.isTypeReferenceNode(typeNode) && !typeNode.typeArguments?.length && ts.isIdentifier(typeNode.typeName)
				? typeNode.typeName.text
				: typeNode.getText(sf).replace(/\s+/g, " ").slice(0, 80);
	}
	return module_;
}

export function loadSchema(root: string): SchemaHandle {
	const absRoot = path.resolve(root);
	const configDir = path.join(absRoot, "src", "config");
	const fileNames = fs.existsSync(configDir)
		? fs.readdirSync(configDir).filter((f) => f.endsWith(".ts")).sort()
		: [];
	const rootNames = fileNames.map((f) => path.join(configDir, f));
	const program = createFireflyProgram(absRoot, rootNames);
	const checker = program.getTypeChecker();
	const ctx: Ctx = { root: absRoot, checker, warnings: [], seen: new Set() };
	const modules: ConfigModule[] = [];
	const exports = new Map<string, SchemaExport>();

	for (const abs of rootNames) {
		const sf = program.getSourceFile(abs);
		const rel = path.relative(absRoot, abs).split(path.sep).join("/");
		if (!sf) {
			warn(ctx, `${rel}: 无法加载源文件`);
			continue;
		}
		const decls = exportedValueDecls(sf);
		if (!decls.length) warn(ctx, `${rel}: 没有可用的导出配置（仅函数或类型导出）`);
		for (const decl of decls) {
			const name = decl.name.getText(sf);
			if (exports.has(name)) {
				warn(ctx, `${rel}: 导出名 ${name} 与其它文件重复，已跳过`);
				continue;
			}
			try {
				const mod = buildModule(ctx, sf, decl);
				if (!mod) continue;
				modules.push(mod);
				exports.set(name, { name, decl, sf });
			} catch (err) {
				warn(ctx, `${rel}#${name}: 生成 schema 失败（${err instanceof Error ? err.message : String(err)}）`);
			}
		}
	}
	return { root: absRoot, modules, warnings: ctx.warnings, checker, exports };
}

export function generateSchema(root: string): { modules: ConfigModule[]; warnings: string[] } {
	const handle = loadSchema(root);
	return { modules: handle.modules, warnings: handle.warnings };
}
