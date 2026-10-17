/**
 * A3 — the typed surface exposed to the renderer as `window.studio`.
 *
 * Every method maps 1:1 onto a contract channel (see src/main/ipc/protocol.ts). This type is the
 * renderer-facing API contract: the renderer consumes it through `src/renderer/src/global.d.ts`.
 */
import type {
  ConfigEdit,
  ConfigModule,
  PostCreateInput,
  PostDetail,
  PostFrontmatter,
  PostSummary,
  ProjectCheck,
  SiteIdentity,
  StudioProject,
  VerifyResult,
  WriteResult,
} from '../shared/contract'
import type {
  MediaImportResult,
  MediaItem,
  PostCreateResult,
  ProjectPickResult,
  RevealResult,
} from '../main/ipc/protocol'

export type StudioApi = {
  project: {
    /** 弹原生目录选择框；取消时 canceled=true, root=null */
    pick(): Promise<ProjectPickResult>
    open(root: string): Promise<StudioProject>
    check(root?: string): Promise<ProjectCheck>
  }
  schema: {
    get(root: string, moduleId?: string): Promise<ConfigModule[]>
  }
  config: {
    preview(root: string, edits: ConfigEdit[]): Promise<WriteResult>
    apply(root: string, edits: ConfigEdit[]): Promise<WriteResult>
  }
  posts: {
    list(root: string): Promise<PostSummary[]>
    read(root: string, id: string): Promise<PostDetail | null>
    save(root: string, id: string, patch: { frontmatter?: Partial<PostFrontmatter>; body?: string }): Promise<WriteResult>
    create(root: string, input: PostCreateInput): Promise<PostCreateResult>
    remove(root: string, id: string): Promise<WriteResult>
  }
  wizard: {
    apply(root: string, identity: SiteIdentity): Promise<WriteResult>
  }
  verify: {
    run(root: string): Promise<VerifyResult>
  }
  media: {
    list(root: string): Promise<MediaItem[]>
    import(root: string, files: string[]): Promise<MediaImportResult>
  }
  shell: {
    reveal(target: string): Promise<RevealResult>
  }
  /** Diagnostics bridge (A3-internal, not part of contract.ts). */
  debug: {
    dump(report: unknown): Promise<string>
    capture(): Promise<string | null>
  }
}
