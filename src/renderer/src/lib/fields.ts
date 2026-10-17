/**
 * Field-tree helpers — pure functions over contract.ts types.
 *
 * The renderer never imports src/core/**: everything here works on the plain JSON shapes that come
 * over IPC (or from the built-in demo data), so the UI behaves identically for stub and real data.
 */
import type { ConfigModule, FieldKind, FieldNode, JsonValue, ValueOrigin } from '@shared/contract'

export type FlatField = {
  path: string
  key: string
  label: string
  help?: string
  kind: FieldKind
  depth: number
  readOnly: boolean
  origin: ValueOrigin
  optional: boolean
  tsType?: string
  /** Pre-lowercased haystack: path + key + label + help + kind + enum option labels. */
  searchText: string
}

const KIND_LABELS: Record<FieldKind, string> = {
  string: '单行文本',
  text: '多行文本',
  number: '数字',
  boolean: '开关',
  enum: '枚举下拉',
  stringArray: '字符串数组',
  numberArray: '数字数组',
  object: '嵌套对象',
  objectArray: '对象数组',
  record: '键值表',
  unknown: '未知类型',
}

const ORIGIN_LABELS: Record<ValueOrigin, string> = {
  literal: '源码字面量（可原地替换）',
  'const-reference': '引用同文件 const（写入目标是该 const）',
  'call-argument': 'helper 调用实参（写入目标是实参）',
  computed: '表达式 / 导入值 / spread（无法安全写回）',
  absent: '源码中不存在该键（新增需要代码生成）',
}

export const kindLabel = (kind: FieldKind): string => KIND_LABELS[kind] ?? kind
export const originLabel = (origin: ValueOrigin): string => ORIGIN_LABELS[origin] ?? origin
export const isContainer = (kind: FieldKind): boolean => kind === 'object' || kind === 'objectArray'

/** Why a control is disabled — the UI must always show a reason next to a read-only field. */
export function readOnlyReason(node: FieldNode): string {
  if (node.kind === 'unknown') {
    return `类型无法安全编辑${node.tsType ? `（${node.tsType}）` : ''}，仅展示当前值`
  }
  if (node.origin === 'computed') return originLabel('computed')
  if (node.origin === 'absent') return originLabel('absent')
  return '该字段被标记为只读'
}

const optionText = (node: FieldNode): string =>
  (node.options ?? []).map((option) => `${option.value} ${option.label ?? ''} ${option.help ?? ''}`).join(' ')

function searchTextOf(node: FieldNode, depth: number, parentLabel: string): string {
  const parts = [
    node.path,
    node.key,
    node.label,
    node.help ?? '',
    kindLabel(node.kind),
    node.tsType ?? '',
    originLabel(node.origin),
    optionText(node),
    parentLabel,
    depth > 0 ? 'nested' : '',
  ]
  return parts.join(' ').toLowerCase()
}

/**
 * Depth-first flatten. Containers are emitted before their children so a search hit on
 * "themeColor" still shows the enclosing object.
 */
export function flattenFields(nodes: FieldNode[], depth = 0, parentLabel = ''): FlatField[] {
  const out: FlatField[] = []
  for (const node of nodes) {
    out.push({
      path: node.path,
      key: node.key,
      label: node.label,
      help: node.help,
      kind: node.kind,
      depth,
      readOnly: node.readOnly,
      origin: node.origin,
      optional: node.optional,
      tsType: node.tsType,
      searchText: searchTextOf(node, depth, parentLabel),
    })
    const childLabel = (parentLabel + ' ' + node.label).trim()
    if (node.children?.length) out.push(...flattenFields(node.children, depth + 1, childLabel))
    if (node.element) out.push(...flattenFields([node.element], depth + 1, childLabel))
  }
  return out
}

/** Multi-term AND match; empty query matches everything. */
export function filterFields(items: FlatField[], query: string): FlatField[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return items
  return items.filter((item) => terms.every((term) => item.searchText.includes(term)))
}

export function moduleMatches(module: ConfigModule, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = [
    module.id,
    module.title,
    module.file,
    module.group,
    module.typeName ?? '',
    ...flattenFields(module.fields).map((field) => field.searchText),
  ]
    .join(' ')
    .toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

const templatePath = (path: string): string => path.replace(/\[\d+\]/g, '[]')

/** Locate a node by schema path; concrete array indices match the "[]" template. */
export function findFieldByPath(nodes: FieldNode[], path: string): FieldNode | null {
  const wanted = templatePath(path)
  for (const node of nodes) {
    if (templatePath(node.path) === wanted) return node
    if (node.children?.length) {
      const found = findFieldByPath(node.children, path)
      if (found) return found
    }
    if (node.element) {
      const found = findFieldByPath([node.element], path)
      if (found) return found
    }
  }
  return null
}

export const GROUP_ORDER = ['基础', '外观', '内容', '集成', '其他']

export type ModuleGroup = { group: string; modules: ConfigModule[] }

/** Group modules for the left navigation, in the canonical group order. */
export function groupModules(modules: ConfigModule[]): ModuleGroup[] {
  const buckets = new Map<string, ConfigModule[]>()
  for (const module of modules) {
    const group = module.group?.trim() || '其他'
    const bucket = buckets.get(group)
    if (bucket) bucket.push(module)
    else buckets.set(group, [module])
  }
  const known = GROUP_ORDER.filter((group) => buckets.has(group))
  const extra = [...buckets.keys()].filter((group) => !GROUP_ORDER.includes(group)).sort()
  return [...known, ...extra].map((group) => ({ group, modules: buckets.get(group) ?? [] }))
}

/* path traversal */

export type PathSegment = { key: string; index?: number }

/** "navbar.items[2].label" -> [{key:"navbar"},{key:"items",index:2},{key:"label"}] */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  for (const raw of path.split('.')) {
    const match = /^([^\[\]]*)(?:\[(\d*)\])?$/.exec(raw.trim())
    if (!match) continue
    const key = match[1]
    const indexText = match[2]
    if (!key && indexText === undefined) continue
    segments.push(indexText === undefined || indexText === '' ? { key } : { key, index: Number(indexText) })
  }
  return segments
}

function readValue(value: JsonValue | undefined, segments: PathSegment[], index: number | undefined): JsonValue | undefined {
  let current = value
  if (index !== undefined) {
    if (!Array.isArray(current)) return undefined
    current = current[index]
  }
  if (!segments.length) return current
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
  const [segment, ...rest] = segments
  return readValue((current as Record<string, JsonValue>)[segment.key], rest, segment.index)
}

export function getValueAtPath(nodes: FieldNode[], path: string): JsonValue | undefined {
  const segments = parsePath(path)
  if (!segments.length) return undefined
  const head = segments[0]
  const node = nodes.find((candidate) => candidate.key === head.key)
  if (!node) return undefined
  return readValue(node.value, segments.slice(1), head.index)
}

function writeValue(
  current: JsonValue | undefined,
  segments: PathSegment[],
  index: number | undefined,
  value: JsonValue,
): JsonValue {
  if (index !== undefined) {
    const array = Array.isArray(current) ? [...current] : []
    while (array.length <= index) array.push(null)
    array[index] = writeValue(array[index], segments, undefined, value)
    return array
  }
  if (!segments.length) return value
  const [segment, ...rest] = segments
  const object: Record<string, JsonValue> =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, JsonValue>) }
      : {}
  object[segment.key] = writeValue(object[segment.key], rest, segment.index, value)
  return object
}

/** Immutable write; returns a new tree so React state updates stay predictable. */
export function setValueAtPath(nodes: FieldNode[], path: string, value: JsonValue): FieldNode[] {
  const segments = parsePath(path)
  if (!segments.length) return nodes
  const head = segments[0]
  return nodes.map((node) =>
    node.key === head.key ? { ...node, value: writeValue(node.value, segments.slice(1), head.index, value) } : node,
  )
}

/** "items[].label" + 2 -> "items[2].label" */
export const concretePath = (templatePath: string, index: number): string =>
  templatePath.replace('[]', '[' + index + ']')

/* statistics */

export function collectFieldKinds(nodes: FieldNode[], into = new Set<FieldKind>()): Set<FieldKind> {
  for (const node of nodes) {
    into.add(node.kind)
    if (node.children?.length) collectFieldKinds(node.children, into)
    if (node.element) collectFieldKinds([node.element], into)
  }
  return into
}

export function countLeaves(nodes: FieldNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (isContainer(node.kind)) {
      if (node.children?.length) total += countLeaves(node.children)
      else if (node.element) total += countLeaves([node.element])
      continue
    }
    total += 1
  }
  return total
}

export function countReadOnly(nodes: FieldNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.readOnly) total += 1
    if (node.children?.length) total += countReadOnly(node.children)
    if (node.element) total += countReadOnly([node.element])
  }
  return total
}
