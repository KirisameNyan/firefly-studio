import type { ConfigModule, FieldNode } from "../../shared/contract";

/** 字段索引：moduleId → 归一化路径 → FieldNode。 */
export type FieldIndex = Map<string, Map<string, FieldNode>>;

/**
 * 归一化字段路径：具体索引收敛为数组模板（"links[2].url" → "links[].url"），
 * 并去掉可能重复出现的导出名前缀（"siteConfig.title" → "title"）。
 */
export function normalizeFieldPath(fieldPath: string, moduleId: string): string {
	const withoutIndex = fieldPath.replace(/\[\d+\]/g, "[]");
	const prefix = `${moduleId}.`;
	return withoutIndex.startsWith(prefix) ? withoutIndex.slice(prefix.length) : withoutIndex;
}

/** 递归索引一个模块的全部字段（含嵌套对象与数组模板元素）。 */
export function indexFields(modules: ConfigModule[]): FieldIndex {
	const index: FieldIndex = new Map();
	const walk = (moduleId: string, nodes: FieldNode[]): void => {
		let table = index.get(moduleId);
		if (!table) {
			table = new Map<string, FieldNode>();
			index.set(moduleId, table);
		}
		for (const node of nodes) {
			table.set(normalizeFieldPath(node.path, moduleId), node);
			if (node.children) walk(moduleId, node.children);
			if (node.element) walk(moduleId, [node.element]);
		}
	};
	for (const module of modules) walk(module.id, module.fields);
	return index;
}

/** 按模块 id + 路径查字段；查不到返回 undefined。 */
export function findField(index: FieldIndex, moduleId: string, fieldPath: string): FieldNode | undefined {
	return index.get(moduleId)?.get(normalizeFieldPath(fieldPath, moduleId));
}
