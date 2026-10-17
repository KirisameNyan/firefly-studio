/**
 * Demo source-text generator.
 *
 * The stub backend cannot produce FileDiff[] (it refuses every write), but the diff *view* must
 * still be reviewable. So the demo dataset is turned back into TypeScript-like source text here and
 * the pre-save preview diffs the "before" against the "after" text. That is a real text-level diff
 * over demo content — the UI path is byte-for-byte the same one a live core.preview will feed.
 */
import type { ConfigModule, FieldNode, JsonValue } from '@shared/contract'
import { concretePath, getValueAtPath, isContainer } from '../lib/fields'

const INDENT = '  '

type Context = { fields: FieldNode[]; overrides: Record<string, JsonValue> }

/** Re-root a subtree under a concrete array index: "favicon[].src" -> "favicon[1].src". */
function mapPaths(node: FieldNode, index: number): FieldNode {
  const mapped: FieldNode = { ...node, path: concretePath(node.path, index) }
  if (node.children) mapped.children = node.children.map((child) => mapPaths(child, index))
  if (node.element) mapped.element = mapPaths(node.element, index)
  return mapped
}

function valueFor(context: Context, node: FieldNode): JsonValue | undefined {
  if (Object.prototype.hasOwnProperty.call(context.overrides, node.path)) return context.overrides[node.path]
  const found = getValueAtPath(context.fields, node.path)
  return found === undefined ? node.value : found
}

function literal(value: JsonValue | undefined, indent: string): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    const inner = value.map((item) => indent + INDENT + literal(item, indent + INDENT)).join(',\n')
    return '[\n' + inner + ',\n' + indent + ']'
  }
  const entries = Object.entries(value)
  if (!entries.length) return '{}'
  const inner = entries
    .map(([key, item]) => indent + INDENT + JSON.stringify(key) + ': ' + literal(item, indent + INDENT))
    .join(',\n')
  return '{\n' + inner + ',\n' + indent + '}'
}

function pushComments(lines: string[], indent: string, node: FieldNode): void {
  lines.push(indent + '// ' + node.label + (node.readOnly ? '（只读）' : ''))
  if (node.help) lines.push(indent + '// ' + node.help)
}

function emitFields(lines: string[], indent: string, fields: FieldNode[], context: Context): void {
  for (const node of fields) {
    pushComments(lines, indent, node)
    if (node.kind === 'object' && node.children?.length) {
      lines.push(indent + node.key + ': {')
      emitFields(lines, indent + INDENT, node.children, context)
      lines.push(indent + '},')
      continue
    }
    if (node.kind === 'objectArray' && node.element) {
      const current = valueFor(context, node)
      const items = Array.isArray(current) ? current : []
      const element = node.element
      if (!items.length) {
        lines.push(indent + node.key + ': [],')
        continue
      }
      lines.push(indent + node.key + ': [')
      items.forEach((_item, index) => {
        const elementAt = mapPaths(element, index)
        lines.push(indent + INDENT + '{')
        emitFields(lines, indent + INDENT + INDENT, elementAt.children ?? [], context)
        lines.push(indent + INDENT + '},')
      })
      lines.push(indent + '],')
      continue
    }
    lines.push(indent + node.key + ': ' + literal(valueFor(context, node), indent) + ',')
  }
}

/** Deterministic pseudo-source for one module; `overrides` maps concrete schema paths to new values. */
export function generateModuleSource(module: ConfigModule, overrides: Record<string, JsonValue> = {}): string {
  const lines: string[] = [
    '/**',
    ' * 演示源码 — 由 FieldNode 树生成，仅用于在桩后端下预演 diff，不会写入磁盘。',
    ' * 文件：' + module.file,
    ' * 导出：' + module.exportName + (module.typeName ? '（' + module.typeName + '）' : ''),
    ' */',
    'import type { ' + (module.typeName ?? 'Record<string, unknown>') + ' } from "@/types/' + module.id + '"',
    '',
    'export const ' + module.exportName + ': ' + (module.typeName ?? 'Record<string, unknown>') + ' = {',
  ]
  emitFields(lines, INDENT, module.fields, { fields: module.fields, overrides })
  lines.push('}', '')
  return lines.join('\n')
}

export const countEditableLeaves = (fields: FieldNode[]): number =>
  fields.reduce((total, node) => {
    if (isContainer(node.kind)) {
      if (node.children?.length) return total + countEditableLeaves(node.children)
      if (node.element) return total + countEditableLeaves([node.element])
      return total
    }
    return total + (node.readOnly ? 0 : 1)
  }, 0)
