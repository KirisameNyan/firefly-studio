/**
 * The single adapter between `window.studio` and the UI (data/source.ts).
 *
 * Everything the panels consume goes through here:
 *   - normalize every payload (src/core is being rewritten, payloads may drift),
 *   - fall back to the built-in demo dataset when the backend answers with stubs,
 *   - preview/apply: use the backend result when it is real, otherwise compute a *labelled*
 *     local simulation from the demo source text so the diff view stays reviewable.
 *
 * A5: when src/core/** is wired up, the only thing that changes is that `loadProject` stops
 * seeing the "stub:" mark — the demo branch (DEMO_MODULES / buildLocalPreview) then never runs.
 * If you want the demo data gone entirely, delete the two lines marked "A5: demo fallback" below and
 * the imports from './demo'.
 */
import type {
  ConfigEdit,
  ConfigModule,
  FieldNode,
  FileDiff,
  JsonValue,
  PostDetail,
  PostSummary,
  ProjectCheck,
  WriteError,
  WriteResult,
} from '@shared/contract'
import type { StudioApi } from '../../../preload/api'
import { diffLines, diffStats } from '../lib/diff'
import { findFieldByPath, setValueAtPath } from '../lib/fields'
import { DEMO_MODULES, DEMO_POST_DETAILS, DEMO_POSTS, DEMO_PROJECT, DEMO_WARNINGS } from './demo'
import { generateModuleSource } from './demoSource'
import {
  DEFAULT_FRONTMATTER,
  STUB_MARK,
  containsStubMark,
  errorMessage,
  normalizeFrontmatter,
  normalizeModules,
  normalizePostSummary,
  normalizePosts,
  normalizeProjectCheck,
  normalizeWriteResult,
} from './normalize'

export type DataOrigin = 'live' | 'demo'

export type DataSource = {
  origin: DataOrigin
  root: string
  check: ProjectCheck
  modules: ConfigModule[]
  posts: PostSummary[]
  /** Engine warnings reported by the backend. */
  warnings: string[]
  /** Adapter notes (why demo data is in use, why something was dropped). */
  notes: string[]
}

export const isDemoSource = (source: DataSource | null): boolean => source?.origin === 'demo'

/* ─────────────────────────── draft <-> edit plumbing ─────────────────────────── */

const SEPARATOR = '::'

export const draftKey = (moduleId: string, path: string): string => moduleId + SEPARATOR + path

export function parseDraftKey(key: string): { moduleId: string; path: string } {
  const index = key.indexOf(SEPARATOR)
  if (index < 0) return { moduleId: '', path: key }
  return { moduleId: key.slice(0, index), path: key.slice(index + SEPARATOR.length) }
}

/** Drafts (key -> new value) become contract ConfigEdits; unresolvable keys are dropped loudly. */
export function draftsToEdits(drafts: Record<string, JsonValue>, modules: ConfigModule[]): {
  edits: ConfigEdit[]
  dropped: WriteError[]
} {
  const edits: ConfigEdit[] = []
  const dropped: WriteError[] = []
  for (const [key, value] of Object.entries(drafts)) {
    const { moduleId, path } = parseDraftKey(key)
    const module = modules.find((candidate) => candidate.id === moduleId)
    if (!module) {
      dropped.push({ path, message: '模块 ' + moduleId + ' 不在当前数据源中，改动被忽略' })
      continue
    }
    const node = findFieldByPath(module.fields, path)
    if (!node) {
      dropped.push({ path: module.file + ' :: ' + path, message: '字段不在 schema 中，改动被忽略' })
      continue
    }
    if (node.readOnly) {
      dropped.push({ path, message: '字段为只读（' + node.origin + '），改动被忽略' })
      continue
    }
    edits.push({ moduleId, path, value })
  }
  return { edits, dropped }
}

/** Apply drafts onto the module trees so controls render the pending values. */
export function applyDrafts(modules: ConfigModule[], drafts: Record<string, JsonValue>): ConfigModule[] {
  const grouped = new Map<string, Array<{ path: string; value: JsonValue }>>()
  for (const [key, value] of Object.entries(drafts)) {
    const { moduleId, path } = parseDraftKey(key)
    const bucket = grouped.get(moduleId)
    if (bucket) bucket.push({ path, value })
    else grouped.set(moduleId, [{ path, value }])
  }
  if (!grouped.size) return modules
  return modules.map((module) => {
    const bucket = grouped.get(module.id)
    if (!bucket) return module
    let fields: FieldNode[] = module.fields
    for (const entry of bucket) fields = setValueAtPath(fields, entry.path, entry.value)
    return { ...module, fields }
  })
}

export function draftCount(drafts: Record<string, JsonValue>, moduleId?: string): number {
  const keys = Object.keys(drafts)
  if (!moduleId) return keys.length
  return keys.filter((key) => parseDraftKey(key).moduleId === moduleId).length
}

/* ─────────────────────────── preview / apply ─────────────────────────── */

export type PreviewOutcome = {
  /** backend: the payload came from config:preview. local: computed from demo source text. */
  view: 'backend' | 'local'
  result: WriteResult
  /** Non-empty when the backend refused the preview but we can still show a local simulation. */
  refusal: WriteError[]
}

/** Local, clearly-labelled simulation over the demo source text (used only in demo mode). */
export function buildLocalPreview(modules: ConfigModule[], edits: ConfigEdit[]): WriteResult {
  const byModule = new Map<string, ConfigEdit[]>()
  for (const edit of edits) {
    const bucket = byModule.get(edit.moduleId)
    if (bucket) bucket.push(edit)
    else byModule.set(edit.moduleId, [edit])
  }

  const diffs: FileDiff[] = []
  const changed: string[] = []
  const errors: WriteError[] = []

  for (const [moduleId, moduleEdits] of byModule) {
    const module = modules.find((candidate) => candidate.id === moduleId)
    if (!module) {
      errors.push({ path: moduleId, message: '演示数据中没有该模块，无法本地预演' })
      continue
    }
    const overrides: Record<string, JsonValue> = {}
    for (const edit of moduleEdits) {
      const node = findFieldByPath(module.fields, edit.path)
      if (!node) {
        errors.push({ path: module.file + ' :: ' + edit.path, message: '演示 schema 中没有该字段，已跳过' })
        continue
      }
      if (node.readOnly) {
        errors.push({ path: module.file + ' :: ' + edit.path, message: '字段为只读（' + node.origin + '），不会写入' })
        continue
      }
      overrides[edit.path] = edit.value
    }
    const before = generateModuleSource(module)
    const after = generateModuleSource(module, overrides)
    if (before === after) continue
    const stats = diffStats(diffLines(before, after))
    diffs.push({ file: module.file, before, after, added: stats.added, removed: stats.removed })
    changed.push(module.file)
  }

  return { ok: errors.length === 0, changed, diffs, errors }
}

export async function previewEdits(
  api: StudioApi,
  source: DataSource,
  edits: ConfigEdit[],
): Promise<PreviewOutcome> {
  if (!edits.length) {
    return { view: 'backend', result: { ok: true, changed: [], diffs: [], errors: [] }, refusal: [] }
  }
  try {
    const result = normalizeWriteResult(await api.config.preview(source.root, edits))
    if (result.ok) return { view: 'backend', result, refusal: [] }
    if (source.origin === 'demo') {
      return { view: 'local', result: buildLocalPreview(source.modules, edits), refusal: result.errors }
    }
    return { view: 'backend', result, refusal: [] }
  } catch (error) {
    const failure: WriteResult = { ok: false, changed: [], diffs: [], errors: [{ path: '', message: errorMessage(error) }] }
    const local = source.origin === 'demo' ? buildLocalPreview(source.modules, edits) : null
    if (local) return { view: 'local', result: local, refusal: failure.errors }
    return { view: 'backend', result: failure, refusal: [] }
  }
}

export async function applyEdits(api: StudioApi, source: DataSource, edits: ConfigEdit[]): Promise<WriteResult> {
  if (!edits.length) return { ok: true, changed: [], diffs: [], errors: [] }
  try {
    return normalizeWriteResult(await api.config.apply(source.root, edits))
  } catch (error) {
    return { ok: false, changed: [], diffs: [], errors: [{ path: '', message: errorMessage(error) }] }
  }
}

/* ─────────────────────────── project / posts loading ─────────────────────────── */

/**
 * The built-in demo dataset.
 *
 * `root` deliberately is NOT the real project root: a write attempt in demo mode must fail at the
 * backend instead of touching a real repository.
 */
export function createDemoSource(check: ProjectCheck | null, notes: string[] = []): DataSource {
  return {
    origin: 'demo',
    root: DEMO_PROJECT.root,
    check: check ?? { isFirefly: false, root: '', problems: ['(demo) 未检测到项目'] },
    modules: DEMO_MODULES,
    posts: DEMO_POSTS,
    warnings: DEMO_WARNINGS,
    notes,
  }
}

export async function loadProject(api: StudioApi, root: string): Promise<DataSource> {
  const notes: string[] = []
  const check = normalizeProjectCheck(await api.project.check(root))

  if (check.problems.some((problem) => problem.includes(STUB_MARK))) {
    // A5: demo fallback — once src/core/** stops answering with "stub:", this branch is dead.
    notes.push('后端返回桩数据（project:check 的 problems 含 "stub:"），已切换到内置演示数据（25 个模块）。')
    return createDemoSource(check, notes)
  }

  if (!check.isFirefly) {
    return {
      origin: 'live',
      root: check.root || root,
      check,
      modules: [],
      posts: [],
      warnings: [],
      notes: ['该目录不是合法的 Firefly 仓库，未读取任何配置。'],
    }
  }

  const opened = await api.project.open(check.root || root)
  if (containsStubMark(opened) && containsStubMark(opened.modules)) {
    // A5: demo fallback (project:open still stubbed while project:check is already real).
    notes.push('project:open 仍返回桩数据，已切换到内置演示数据（25 个模块）。')
    return createDemoSource(check, notes)
  }

  const modules = normalizeModules(opened?.modules)
  const posts = normalizePosts(opened?.posts)
  if (!modules.length) notes.push('后端返回了 0 个配置模块：请在仓库根执行 project:check 确认路径。')
  return {
    origin: 'live',
    root: check.root || root,
    check,
    modules,
    posts,
    warnings: Array.isArray(opened?.warnings) ? opened.warnings.filter((item): item is string => typeof item === 'string') : [],
    notes,
  }
}

export function demoPostDetail(id: string): PostDetail | null {
  const detail = DEMO_POST_DETAILS[id]
  if (detail) return detail
  const summary = DEMO_POSTS.find((post) => post.id === id)
  if (!summary) return null
  return { ...summary, frontmatter: { ...DEFAULT_FRONTMATTER, title: summary.title }, body: '', raw: '' }
}

export function normalizePostDetail(input: unknown): PostDetail | null {
  const summary = normalizePostSummary(input)
  if (!summary) return null
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    ...summary,
    frontmatter: normalizeFrontmatter(record.frontmatter),
    body: typeof record.body === 'string' ? record.body : '',
    raw: typeof record.raw === 'string' ? record.raw : '',
  }
}

export async function loadPosts(api: StudioApi, source: DataSource): Promise<PostSummary[]> {
  if (source.origin === 'demo') return DEMO_POSTS
  try {
    return normalizePosts(await api.posts.list(source.root))
  } catch {
    return source.posts
  }
}

export async function loadPostDetail(api: StudioApi, source: DataSource, id: string): Promise<PostDetail | null> {
  if (source.origin === 'demo') return demoPostDetail(id)
  try {
    return normalizePostDetail(await api.posts.read(source.root, id))
  } catch {
    return null
  }
}
