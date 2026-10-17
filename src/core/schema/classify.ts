import ts from "typescript";
import type { EnumOption, FieldKind } from "../../shared/contract";
import { commentToLabelHelp, leadingCommentBlock } from "./text";
import { resolveSymbol, unwrap } from "./values";

export type ValueTypeRef = { type: ts.Type | undefined; typeNode: ts.TypeNode | undefined };

export type TypeInfo = {
	kind: FieldKind;
	options?: EnumOption[];
	/** kind === "objectArray" 时的元素模板类型 */
	element?: ValueTypeRef;
	/** kind === "record" 时的值类型 */
	recordValue?: ValueTypeRef;
	tsType: string;
	/** 非空表示降级原因，用于 warnings */
	degraded?: string;
};

function textOf(node: ts.Node): string {
	return node.getText(node.getSourceFile()).replace(/\s+/g, " ").trim();
}

function truncate(s: string, n = 160): string {
	return s.length > n ? s.slice(0, n) + "…" : s;
}

function declaredTypeOf(checker: ts.TypeChecker, sym: ts.Symbol, fallback: ts.Type | undefined): ts.Type | undefined {
	try {
		return checker.getDeclaredTypeOfSymbol(sym);
	} catch {
		return fallback;
	}
}

function numericValue(expr: ts.Expression): number | undefined {
	const e = unwrap(expr);
	if (ts.isNumericLiteral(e)) return Number(e.text);
	if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand))
		return -Number(e.operand.text);
	return undefined;
}

function stringValue(expr: ts.Expression): string | undefined {
	const e = unwrap(expr);
	if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
	return undefined;
}

/** typeof CONST → 常量字面量 + 常量名 + 常量上方注释。 */
function optionsFromTypeQuery(checker: ts.TypeChecker, tn: ts.TypeQueryNode): EnumOption[] | null {
	const sym = resolveSymbol(checker, checker.getSymbolAtLocation(tn.exprName));
	const decl = sym?.declarations?.find((d): d is ts.VariableDeclaration => ts.isVariableDeclaration(d));
	if (!decl?.initializer) return null;
	const leaf = unwrap(decl.initializer);
	const sv = stringValue(leaf);
	const nv = numericValue(leaf);
	const value = sv ?? nv;
	if (value === undefined) return null;
	const c = commentToLabelHelp(leadingCommentBlock(decl));
	const label = sym?.getName() ?? tn.exprName.getText(tn.getSourceFile());
	return [{ value, label, help: c.help ?? (c.label && c.label !== label ? c.label : undefined) }];
}

function optionsFromEnumDecl(decl: ts.EnumDeclaration): EnumOption[] | null {
	const out: EnumOption[] = [];
	let auto = 0;
	for (const m of decl.members) {
		let value: string | number;
		if (m.initializer) {
			const sv = stringValue(m.initializer);
			const nv = numericValue(m.initializer);
			if (sv !== undefined) value = sv;
			else if (nv !== undefined) value = nv;
			else return null;
		} else {
			value = auto;
		}
		if (typeof value === "number") auto = value + 1;
		const c = commentToLabelHelp(leadingCommentBlock(m));
		out.push({ value, label: m.name.getText(m.getSourceFile()), help: c.help ?? c.label });
	}
	return out.length ? out : null;
}

/** 字面量联合（含 typeof CONST）→ 下拉选项。 */
function literalOptions(checker: ts.TypeChecker, tn: ts.TypeNode, depth = 0): EnumOption[] | null {
	if (depth > 8) return null;
	if (ts.isParenthesizedTypeNode(tn)) return literalOptions(checker, tn.type, depth + 1);
	if (ts.isUnionTypeNode(tn)) {
		const out: EnumOption[] = [];
		for (const c of tn.types) {
			const o = literalOptions(checker, c, depth + 1);
			if (!o) return null;
			out.push(...o);
		}
		return out.length ? out : null;
	}
	if (ts.isLiteralTypeNode(tn)) {
		const lit = tn.literal;
		if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) return [{ value: lit.text }];
		if (ts.isNumericLiteral(lit)) return [{ value: Number(lit.text) }];
		return null;
	}
	if (ts.isTypeQueryNode(tn)) return optionsFromTypeQuery(checker, tn);
	if (ts.isTypeReferenceNode(tn)) {
		const sym = resolveSymbol(checker, checker.getSymbolAtLocation(tn.typeName));
		const decl = sym?.declarations?.find((d): d is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(d));
		if (decl) return literalOptions(checker, decl.type, depth + 1);
	}
	return null;
}

function optionsFromType(checker: ts.TypeChecker, type: ts.Type): EnumOption[] | null {
	if (!type.isUnion()) {
		if (type.flags & ts.TypeFlags.StringLiteral) return [{ value: (type as ts.StringLiteralType).value }];
		if (type.flags & ts.TypeFlags.NumberLiteral) return [{ value: (type as ts.NumberLiteralType).value }];
		return null;
	}
	const out: EnumOption[] = [];
	for (const t of type.types) {
		if (t.flags & ts.TypeFlags.StringLiteral) out.push({ value: (t as ts.StringLiteralType).value });
		else if (t.flags & ts.TypeFlags.NumberLiteral) out.push({ value: (t as ts.NumberLiteralType).value });
		else return null;
	}
	return out.length ? out : null;
}

/** 数组元素只由字符串/数字（含字面量联合）构成 → 可按字符串数组编辑。 */
function isScalarLikeNode(tn: ts.TypeNode | undefined, depth = 0): boolean {
	if (!tn || depth > 4) return false;
	if (ts.isParenthesizedTypeNode(tn)) return isScalarLikeNode(tn.type, depth + 1);
	if (ts.isUnionTypeNode(tn)) return tn.types.every((t) => isScalarLikeNode(t, depth + 1));
	return (
		tn.kind === ts.SyntaxKind.StringKeyword ||
		tn.kind === ts.SyntaxKind.NumberKeyword ||
		ts.isLiteralTypeNode(tn)
	);
}

type Partial_ = Omit<TypeInfo, "tsType">;

function arrayInfo(
	checker: ts.TypeChecker,
	elementNode: ts.TypeNode | undefined,
	elementType: ts.Type | undefined,
	depth: number,
): Partial_ {
	const el = classifyNode(checker, elementType, elementNode, depth + 1);
	if (el.kind === "object") return { kind: "objectArray", element: { type: elementType, typeNode: elementNode } };
	if (el.kind === "string" || el.kind === "text") return { kind: "stringArray" };
	if (el.kind === "number") return { kind: "numberArray" };
	if (el.kind === "enum") return { kind: "stringArray" };
	if (isScalarLikeNode(elementNode)) return { kind: "stringArray" };
	return {
		kind: "unknown",
		degraded: `数组元素类型 ${elementNode ? truncate(textOf(elementNode)) : "?"} 无法安全编辑`,
	};
}

function objectOrUnknown(checker: ts.TypeChecker, type: ts.Type | undefined): Partial_ {
	if (!type) return { kind: "unknown", degraded: "缺少类型信息" };
	const strIdx = checker.getIndexTypeOfType(type, ts.IndexKind.String);
	if (strIdx) return { kind: "record", recordValue: { type: strIdx, typeNode: undefined } };
	if (type.getProperties().length) return { kind: "object" };
	return { kind: "unknown", degraded: `空对象类型 ${truncate(checker.typeToString(type))} 无法编辑` };
}

function classifyNode(
	checker: ts.TypeChecker,
	type: ts.Type | undefined,
	tn: ts.TypeNode | undefined,
	depth: number,
): Partial_ {
	if (depth > 10) return { kind: "unknown", degraded: "类型嵌套过深" };
	if (tn) {
		if (ts.isParenthesizedTypeNode(tn)) return classifyNode(checker, type, tn.type, depth + 1);
		if (ts.isArrayTypeNode(tn)) {
			const elType = type ? checker.getIndexTypeOfType(type, ts.IndexKind.Number) : undefined;
			return arrayInfo(checker, tn.elementType, elType, depth);
		}
		if (ts.isUnionTypeNode(tn) || ts.isLiteralTypeNode(tn) || ts.isTypeQueryNode(tn)) {
			const opts = literalOptions(checker, tn);
			if (opts) return { kind: "enum", options: opts };
			const o = optionsFromType(checker, type ?? checker.getTypeFromTypeNode(tn));
			if (o) return { kind: "enum", options: o };
			if (ts.isUnionTypeNode(tn))
				return { kind: "unknown", degraded: `联合类型 ${truncate(textOf(tn))} 无法用单一控件安全编辑` };
			return { kind: "unknown", degraded: `无法解析的字面量类型 ${truncate(textOf(tn))}` };
		}
		if (ts.isTypeReferenceNode(tn)) {
			const tnName = ts.isIdentifier(tn.typeName) ? tn.typeName.text : tn.typeName.right.text;
			if ((tnName === "Array" || tnName === "ReadonlyArray") && tn.typeArguments?.length) {
				const arg = tn.typeArguments[0];
				return arrayInfo(checker, arg, checker.getTypeFromTypeNode(arg), depth);
			}
			if (tnName === "Record" && tn.typeArguments?.length === 2) {
				const v = tn.typeArguments[1];
				return { kind: "record", recordValue: { type: checker.getTypeFromTypeNode(v), typeNode: v } };
			}
			const sym = resolveSymbol(checker, checker.getSymbolAtLocation(tn.typeName));
			const decl = sym?.declarations?.find(
				(d) => ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d) || ts.isEnumDeclaration(d),
			);
			if (decl && ts.isEnumDeclaration(decl)) {
				const o = optionsFromEnumDecl(decl);
				return o ? { kind: "enum", options: o } : { kind: "unknown", degraded: "枚举成员非字面量" };
			}
			if (decl && ts.isTypeAliasDeclaration(decl)) {
				const declared = declaredTypeOf(checker, sym!, type);
				return classifyNode(checker, declared, decl.type, depth + 1);
			}
			if (decl && ts.isInterfaceDeclaration(decl)) return objectOrUnknown(checker, type);
		}
		if (ts.isTypeLiteralNode(tn)) return objectOrUnknown(checker, type);
		if (ts.isTupleTypeNode(tn)) return { kind: "unknown", degraded: `元组类型 ${truncate(textOf(tn))} 无法安全编辑` };
		if (
			ts.isTypeOperatorNode(tn) ||
			ts.isIndexedAccessTypeNode(tn) ||
			ts.isConditionalTypeNode(tn) ||
			ts.isMappedTypeNode(tn) ||
			ts.isFunctionTypeNode(tn) ||
			ts.isConstructorTypeNode(tn) ||
			ts.isTemplateLiteralTypeNode(tn) ||
			ts.isImportTypeNode(tn) ||
			ts.isInferTypeNode(tn)
		) {
			if (type) {
				const o = optionsFromType(checker, type);
				if (o) return { kind: "enum", options: o };
			}
			return { kind: "unknown", degraded: `不支持的类型写法 ${truncate(textOf(tn))}` };
		}
		switch (tn.kind) {
			case ts.SyntaxKind.StringKeyword:
				return { kind: "string" };
			case ts.SyntaxKind.NumberKeyword:
				return { kind: "number" };
			case ts.SyntaxKind.BooleanKeyword:
				return { kind: "boolean" };
			case ts.SyntaxKind.AnyKeyword:
			case ts.SyntaxKind.UnknownKeyword:
				return { kind: "unknown", degraded: `类型为 ${textOf(tn)}` };
			case ts.SyntaxKind.NullKeyword:
			case ts.SyntaxKind.UndefinedKeyword:
			case ts.SyntaxKind.NeverKeyword:
			case ts.SyntaxKind.VoidKeyword:
			case ts.SyntaxKind.ObjectKeyword:
				return { kind: "unknown", degraded: `类型 ${textOf(tn)} 无法安全编辑` };
		}
	}
	if (!type) return { kind: "unknown", degraded: "缺少类型信息" };
	const numIdx = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
	if (numIdx) return arrayInfo(checker, undefined, numIdx, depth);
	const strIdx = checker.getIndexTypeOfType(type, ts.IndexKind.String);
	if (strIdx) return { kind: "record", recordValue: { type: strIdx, typeNode: undefined } };
	if (type.isUnion()) {
		const o = optionsFromType(checker, type);
		if (o) return { kind: "enum", options: o };
		return { kind: "unknown", degraded: `联合类型 ${truncate(checker.typeToString(type))} 无法用单一控件安全编辑` };
	}
	if (type.flags & ts.TypeFlags.StringLike) return { kind: "string" };
	if (type.flags & ts.TypeFlags.NumberLike) return { kind: "number" };
	if (type.flags & ts.TypeFlags.BooleanLike) return { kind: "boolean" };
	if (type.flags & ts.TypeFlags.Object) {
		const props = type.getProperties();
		if (props.length) return { kind: "object" };
	}
	if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown)
		return { kind: "unknown", degraded: "类型为 any/unknown" };
	return { kind: "unknown", degraded: `无法识别的类型 ${truncate(checker.typeToString(type))}` };
}

export function classifyType(checker: ts.TypeChecker, type: ts.Type | undefined, tn: ts.TypeNode | undefined): TypeInfo {
	const r = classifyNode(checker, type, tn, 0);
	const tsType = tn ? truncate(textOf(tn)) : type ? truncate(checker.typeToString(type)) : "unknown";
	return { ...r, tsType };
}
