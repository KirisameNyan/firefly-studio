import ts from "typescript";
import type { JsonValue } from "../../shared/contract";

/** 去掉括号 / as / satisfies / 非空断言 等透明包装。 */
export function unwrap(node: ts.Expression): ts.Expression {
	let n = node;
	while (
		ts.isParenthesizedExpression(n) ||
		ts.isAsExpression(n) ||
		ts.isSatisfiesExpression(n) ||
		ts.isNonNullExpression(n) ||
		ts.isTypeAssertionExpression(n)
	) {
		n = n.expression;
	}
	return n;
}

/** 跟随 import 别名，拿到真实符号。 */
export function resolveSymbol(checker: ts.TypeChecker, sym: ts.Symbol | undefined): ts.Symbol | undefined {
	if (!sym) return undefined;
	if (sym.flags & ts.SymbolFlags.Alias) {
		try {
			return checker.getAliasedSymbol(sym);
		} catch {
			return sym;
		}
	}
	return sym;
}

function isNumericLiteralLike(n: ts.Node): n is ts.NumericLiteral {
	return ts.isNumericLiteral(n);
}

/** 纯字面量：字符串/数字/布尔/null/数组/对象，且不含任何变量引用或调用。 */
export function isPureLiteral(node: ts.Expression | undefined): boolean {
	if (!node) return false;
	const n = unwrap(node);
	if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) return true;
	if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword)
		return true;
	if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) return isNumericLiteralLike(n.operand);
	if (ts.isArrayLiteralExpression(n)) return n.elements.every((e) => isPureLiteral(e));
	if (ts.isObjectLiteralExpression(n)) {
		return n.properties.every(
			(p) =>
				ts.isPropertyAssignment(p) &&
				(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) &&
				isPureLiteral(p.initializer),
		);
	}
	return false;
}

/** 求值纯字面量；不可求值返回 undefined。 */
export function evalLiteral(node: ts.Expression | undefined): JsonValue | undefined {
	if (!node) return undefined;
	const n = unwrap(node);
	if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
	if (ts.isNumericLiteral(n)) return Number(n.text);
	if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (n.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && isNumericLiteralLike(n.operand))
		return -Number(n.operand.text);
	if (ts.isArrayLiteralExpression(n)) {
		const out: JsonValue[] = [];
		for (const e of n.elements) {
			const v = evalLiteral(e);
			if (v === undefined) return undefined;
			out.push(v);
		}
		return out;
	}
	if (ts.isObjectLiteralExpression(n)) {
		const out: { [k: string]: JsonValue } = {};
		for (const p of n.properties) {
			if (!ts.isPropertyAssignment(p)) return undefined;
			const name = p.name;
			if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name)) return undefined;
			const v = evalLiteral(p.initializer);
			if (v === undefined) return undefined;
			out[name.text] = v;
		}
		return out;
	}
	return undefined;
}

/**
 * 沿「同文件 const 引用 / helper 调用实参」链路下沉，找到承载真实值的节点。
 * 只下沉同文件 const：跨文件常量被改会影响其它模块，一律视为 computed。
 */
export function reduceLeaf(checker: ts.TypeChecker, expr: ts.Expression | undefined, depth = 0): ts.Expression | null {
	if (!expr || depth > 8) return null;
	const e = unwrap(expr);
	if (isPureLiteral(e)) return e;
	if (ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e)) return e;
	if (ts.isIdentifier(e)) {
		const sym = resolveSymbol(checker, checker.getSymbolAtLocation(e));
		const decl = sym?.declarations?.find((x): x is ts.VariableDeclaration => ts.isVariableDeclaration(x));
		if (decl?.initializer && decl.getSourceFile() === e.getSourceFile() && isConst(decl)) {
			return reduceLeaf(checker, decl.initializer, depth + 1);
		}
		return null;
	}
	if (ts.isCallExpression(e) && e.arguments.length) return reduceLeaf(checker, e.arguments[0], depth + 1);
	return null;
}

export function isConst(decl: ts.VariableDeclaration): boolean {
	return (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0;
}

/** 属性值的表达式；简写属性落到被引用的 const 上的写法由调用方用符号解析。 */
export function valueExpressionOf(prop: ts.ObjectLiteralElementLike, checker: ts.TypeChecker): ts.Expression | undefined {
	if (ts.isShorthandPropertyAssignment(prop)) {
		const sym = checker.getShorthandAssignmentValueSymbol(prop);
		const decl = sym?.declarations?.find((x): x is ts.VariableDeclaration => ts.isVariableDeclaration(x));
		return decl?.initializer ?? prop.name;
	}
	if (ts.isPropertyAssignment(prop)) return prop.initializer;
	return undefined;
}

export function propertyNameOf(prop: ts.ObjectLiteralElementLike): string | undefined {
	if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
		const n = prop.name;
		if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
	}
	return undefined;
}
