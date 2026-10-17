/**
 * A3 — stub handlers.
 *
 * Every handler is pure (no electron, no fs) so this map can be unit tested and swapped wholesale
 * in `src/main/core-bridge.ts` once A5 lands `src/core/**`.
 *
 * Stub policy: never claim success. Any write-style channel answers `ok: false` with a
 * `stub:`-prefixed error so a UI bug can never be mistaken for a working feature.
 */
import { IPC } from '../../shared/contract'
import type {
  ConfigModule,
  PostDetail,
  PostFrontmatter,
  PostSummary,
  ProjectCheck,
  WriteResult,
} from '../../shared/contract'
import type { IpcHandlers, MediaImportResult, ProjectPickResult, RevealResult } from './protocol'

export const STUB_PREFIX = 'stub:'

const note = (channel: string, extra?: string): string =>
  `${STUB_PREFIX} ${channel} has no real implementation yet (A5 wires src/core)${extra ? ` — ${extra}` : ''}`

/** Injected by main so this module stays electron-free and unit-testable. */
export type StubDeps = {
  pickProject(): Promise<ProjectPickResult>
  revealInFolder(target: string): Promise<RevealResult>
}

const writeFailure = (channel: string, file = ''): WriteResult => ({
  ok: false,
  changed: [],
  diffs: [],
  errors: [{ path: file, message: note(channel) }],
})

export const STUB_POST_ID = 'src/content/posts/stub-hello.md'

const STUB_POST: PostSummary = {
  id: STUB_POST_ID,
  file: STUB_POST_ID,
  slug: 'stub-hello',
  title: 'Stub Post (A3 placeholder)',
  published: '2024-01-01T00:00:00.000Z',
  draft: true,
  tags: ['stub'],
  category: null,
  pinned: false,
  encrypted: false,
  cover: '',
  excerpt: 'A3 桩数据：A5 接上 src/core 后由真实文章替换。',
  wordCount: 12,
  extraKeys: [],
}

const STUB_FRONTMATTER: PostFrontmatter = {
  title: STUB_POST.title,
  published: STUB_POST.published,
  draft: true,
  description: STUB_POST.excerpt,
  image: '',
  tags: ['stub'],
  category: null,
  lang: 'zh_CN',
  pinned: false,
  author: 'A3',
  sourceLink: '',
  licenseName: '',
  licenseUrl: '',
  comment: true,
  password: '',
  passwordHint: '',
  series: '',
}

const STUB_DETAIL: PostDetail = {
  ...STUB_POST,
  frontmatter: STUB_FRONTMATTER,
  body: '# Stub\n\nA3 placeholder body.',
  raw: '---\ntitle: Stub Post (A3 placeholder)\n---\n\n# Stub\n',
}

const STUB_MODULE: ConfigModule = {
  id: 'siteConfig',
  file: 'src/config/siteConfig.ts',
  exportName: 'siteConfig',
  title: '站点配置（A3 桩数据）',
  group: '基础',
  typeName: 'SiteConfig',
  editable: false,
  fields: [
    {
      path: 'title',
      key: 'title',
      label: '站点标题',
      kind: 'string',
      optional: false,
      value: 'Firefly Studio (stub)',
      origin: 'literal',
      readOnly: false,
      loc: { file: 'src/config/siteConfig.ts', start: 0, end: 0 },
      tsType: 'string',
    },
    {
      path: 'theme.hue',
      key: 'hue',
      label: '主题色相',
      kind: 'number',
      optional: true,
      origin: 'computed',
      readOnly: true,
      tsType: 'number',
    },
  ],
}

/** Frozen acceptance shape: isFirefly false, root empty, problems mention "stub". */
const stubProjectCheck = (requestedRoot: string): ProjectCheck => ({
  isFirefly: false,
  root: '',
  problems: [note(IPC.projectCheck), `stub: request.root=${requestedRoot || '(empty)'}`],
})

export function createStubHandlers(deps: StubDeps): IpcHandlers {
  return {
    [IPC.projectPick]: async () => deps.pickProject(),
    [IPC.projectOpen]: async (req) => ({
      ...stubProjectCheck(req?.root ?? ''),
      modules: [STUB_MODULE],
      posts: [STUB_POST],
      warnings: [note(IPC.projectOpen, 'modules/posts are stub payloads')],
    }),
    [IPC.projectCheck]: async (req) => stubProjectCheck(req?.root ?? ''),
    [IPC.schemaGet]: async () => [STUB_MODULE],
    [IPC.configPreview]: async (req) => writeFailure(IPC.configPreview, req?.edits?.[0]?.moduleId ?? ''),
    [IPC.configApply]: async (req) => writeFailure(IPC.configApply, req?.edits?.[0]?.moduleId ?? ''),
    [IPC.postsList]: async () => [STUB_POST],
    [IPC.postRead]: async (req) => (req?.id ? STUB_DETAIL : null),
    [IPC.postSave]: async (req) => writeFailure(IPC.postSave, req?.id ?? ''),
    [IPC.postCreate]: async (req) => ({
      ok: false,
      post: null,
      errors: [{ path: req?.input?.title ?? '', message: note(IPC.postCreate) }],
    }),
    [IPC.postDelete]: async (req) => writeFailure(IPC.postDelete, req?.id ?? ''),
    [IPC.wizardApply]: async (req) => writeFailure(IPC.wizardApply, req?.identity?.title ?? ''),
    [IPC.verifyRun]: async () => ({
      typeCheck: { ok: false, output: note(IPC.verifyRun) },
      durationMs: 0,
    }),
    [IPC.mediaList]: async () => [],
    [IPC.mediaImport]: async (req): Promise<MediaImportResult> => {
      const files = req?.files ?? []
      return {
        imported: [],
        errors: (files.length ? files : ['']).map((file) => ({ file, message: note(IPC.mediaImport) })),
      }
    },
    [IPC.revealInFolder]: async (req) => deps.revealInFolder(req?.path ?? ''),
  }
}
