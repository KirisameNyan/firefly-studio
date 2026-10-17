/**
 * Thin normalization layer between `window.studio` and the UI.
 *
 * The renderer must survive payload drift (A5 is rewriting src/core/** right now): every list is
 * coerced to an array, every FieldNode is re-validated, and unknown kinds degrade to "unknown"
 * instead of crashing a control. Nothing here throws.
 */
import type {
  ConfigModule,
  FieldKind,
  FieldNode,
  JsonValue,
  PostFrontmatter,
  PostSummary,
  ProjectCheck,
  WriteError,
  WriteResult,
} from '@shared/contract'

export const STUB_MARK = 'stub:'

const KINDS: FieldKind[] = [
  'string',
  'text',
  'number',
  'boolean',
  'enum',
  'stringArray',
  'numberArray',
  'object',
  'objectArray',
  'record',
  'unknown',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const asOptionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return value as JsonValue
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch {
    return undefined
  }
}

/** Recursively look for a "stub:" marker anywhere in a payload. */
export function containsStubMark(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined) return false
  if (typeof value === 'string') return value.includes(STUB_MARK)
  if (Array.isArray(value)) return value.some((item) => containsStubMark(item, depth + 1))
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => containsStubMark(item, depth + 1))
  return false
}

export function normalizeField(input: unknown): FieldNode | null {
  if (!isRecord(input)) return null
  const path = asString(input.path)
  if (!path) return null
  const rawKind = asString(input.kind)
  const children = Array.isArray(input.children)
    ? input.children.map(normalizeField).filter((node): node is FieldNode => node !== null)
    : undefined
  const element = input.element ? normalizeField(input.element) ?? undefined : undefined
  const kind: FieldKind = KINDS.includes(rawKind as FieldKind) ? (rawKind as FieldKind) : 'unknown'
  return {
    path,
    key: asString(input.key) || (path.split('.').pop() ?? path).replace(/\[\]$/, ''),
    label: asString(input.label) || path,
    help: asOptionalString(input.help),
    kind,
    options: Array.isArray(input.options)
      ? input.options
          .filter(isRecord)
          .map((option) => ({
            value: (typeof option.value === 'string' || typeof option.value === 'number' ? option.value : '') as string | number,
            label: asOptionalString(option.label),
            help: asOptionalString(option.help),
          }))
      : undefined,
    children: children?.length ? children : undefined,
    element,
    optional: Boolean(input.optional),
    value: asJsonValue(input.value),
    origin: (
      ['literal', 'const-reference', 'call-argument', 'computed', 'absent'].includes(asString(input.origin))
        ? asString(input.origin)
        : 'computed'
    ) as FieldNode['origin'],
    readOnly: Boolean(input.readOnly),
    loc: isRecord(input.loc) && typeof input.loc.file === 'string'
      ? {
          file: input.loc.file,
          start: typeof input.loc.start === 'number' ? input.loc.start : 0,
          end: typeof input.loc.end === 'number' ? input.loc.end : 0,
        }
      : undefined,
    tsType: asOptionalString(input.tsType),
  }
}

export function normalizeModules(input: unknown): ConfigModule[] {
  if (!Array.isArray(input)) return []
  const modules: ConfigModule[] = []
  for (const item of input) {
    if (!isRecord(item)) continue
    const id = asString(item.id) || asString(item.exportName)
    if (!id) continue
    const fields = Array.isArray(item.fields)
      ? item.fields.map(normalizeField).filter((node): node is FieldNode => node !== null)
      : []
    modules.push({
      id,
      file: asString(item.file),
      exportName: asString(item.exportName) || id,
      title: asString(item.title) || id,
      group: asString(item.group) || '其他',
      typeName: asOptionalString(item.typeName),
      fields,
      editable: item.editable === undefined ? true : Boolean(item.editable),
    })
  }
  return modules
}

export function normalizePostSummary(input: unknown): PostSummary | null {
  if (!isRecord(input)) return null
  const id = asString(input.id) || asString(input.file)
  if (!id) return null
  return {
    id,
    file: asString(input.file) || id,
    slug: asString(input.slug) || id.split('/').pop()?.replace(/\.(md|mdx)$/, '') || id,
    title: asString(input.title) || id,
    published: asString(input.published),
    draft: Boolean(input.draft),
    tags: asStringArray(input.tags),
    category: typeof input.category === 'string' ? input.category : null,
    pinned: Boolean(input.pinned),
    encrypted: Boolean(input.encrypted),
    cover: asString(input.cover),
    excerpt: asString(input.excerpt),
    wordCount: typeof input.wordCount === 'number' ? input.wordCount : 0,
    extraKeys: asStringArray(input.extraKeys),
  }
}

export function normalizePosts(input: unknown): PostSummary[] {
  if (!Array.isArray(input)) return []
  return input.map(normalizePostSummary).filter((post): post is PostSummary => post !== null)
}

export const DEFAULT_FRONTMATTER: PostFrontmatter = {
  title: '',
  published: '',
  draft: false,
  description: '',
  image: '',
  tags: [],
  category: null,
  lang: 'zh_CN',
  pinned: false,
  author: '',
  sourceLink: '',
  licenseName: '',
  licenseUrl: '',
  comment: true,
  password: '',
  passwordHint: '',
  series: '',
}

/** Never drop keys: unknown top-level frontmatter keys are reported through PostSummary.extraKeys. */
export function normalizeFrontmatter(input: unknown): PostFrontmatter {
  const record = isRecord(input) ? input : {}
  const merged: PostFrontmatter = {
    ...DEFAULT_FRONTMATTER,
    title: asString(record.title),
    published: asString(record.published),
    updated: asOptionalString(record.updated),
    draft: Boolean(record.draft),
    description: asString(record.description),
    image: asString(record.image),
    tags: asStringArray(record.tags),
    category: typeof record.category === 'string' && record.category ? record.category : null,
    lang: asString(record.lang, 'zh_CN'),
    pinned: Boolean(record.pinned),
    author: asString(record.author),
    sourceLink: asString(record.sourceLink),
    licenseName: asString(record.licenseName),
    licenseUrl: asString(record.licenseUrl),
    comment: record.comment === undefined ? true : Boolean(record.comment),
    password: asString(record.password),
    passwordHint: asString(record.passwordHint),
    series: asString(record.series),
  }
  if (typeof record.seriesOrder === 'number') merged.seriesOrder = record.seriesOrder
  return merged
}

export function normalizeProjectCheck(input: unknown): ProjectCheck {
  const record = isRecord(input) ? input : {}
  return {
    isFirefly: Boolean(record.isFirefly),
    root: asString(record.root),
    fireflyVersion: asOptionalString(record.fireflyVersion),
    problems: asStringArray(record.problems),
  }
}

const normalizeWriteError = (input: unknown): WriteError => {
  const record = isRecord(input) ? input : {}
  return { path: asString(record.path), message: asString(record.message, '未知错误') }
}

export function normalizeFileDiffs(input: unknown): WriteResult['diffs'] {
  if (!Array.isArray(input)) return []
  return input.filter(isRecord).map((diff) => ({
    file: asString(diff.file),
    before: asString(diff.before),
    after: asString(diff.after),
    added: typeof diff.added === 'number' ? diff.added : 0,
    removed: typeof diff.removed === 'number' ? diff.removed : 0,
  }))
}

export function normalizeWriteResult(input: unknown): WriteResult {
  const record = isRecord(input) ? input : {}
  return {
    ok: Boolean(record.ok),
    changed: asStringArray(record.changed),
    diffs: normalizeFileDiffs(record.diffs),
    errors: Array.isArray(record.errors) ? record.errors.map(normalizeWriteError) : [],
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
