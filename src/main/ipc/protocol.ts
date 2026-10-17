/**
 * A3 — IPC protocol map (main ⇄ preload ⇄ renderer).
 *
 * Single source of truth for the *payload* shape of every channel declared in
 * `src/shared/contract.ts` (`IPC`). contract.ts is frozen and must not be edited; this file only
 * attaches request/response types to those channel constants.
 *
 * This module is deliberately electron-free so that preload, main and vitest can all import it.
 *
 * A5: implement these channels against `src/core/**` — see `src/main/core-bridge.ts`.
 */
import { IPC, type IpcChannel } from '../../shared/contract'
import type {
  ConfigEdit,
  ConfigModule,
  MediaImportResult,
  MediaItem,
  PostCreateInput,
  PostDetail,
  PostFrontmatter,
  PostSummary,
  ProjectCheck,
  SiteIdentity,
  StudioProject,
  VerifyResult,
  WriteError,
  WriteResult,
} from '../../shared/contract'

/* ─────────────────── payload types ─────────────────── */

/**
 * A5 — the provisional A3 media shapes are gone: MediaItem / MediaImportResult are frozen in
 * contract.ts now. They are re-exported here so main and preload keep a single import site.
 */
export type { MediaImportResult, MediaItem } from '../../shared/contract'

export type ProjectPickResult = { root: string | null; canceled: boolean }
export type PostCreateResult = { ok: boolean; post: PostDetail | null; errors: WriteError[] }
export type RevealResult = { revealed: boolean; path: string; reason?: string }

/** Context handed to every handler. */
export type IpcInvokeContext = { senderUrl: string }

/* ───────────────────────── channel table ───────────────────────── */

export type IpcProtocol = {
  [IPC.projectPick]: { req: undefined; res: ProjectPickResult }
  [IPC.projectOpen]: { req: { root: string }; res: StudioProject }
  [IPC.projectCheck]: { req: { root?: string } | undefined; res: ProjectCheck }
  [IPC.schemaGet]: { req: { root: string; moduleId?: string }; res: ConfigModule[] }
  [IPC.configPreview]: { req: { root: string; edits: ConfigEdit[] }; res: WriteResult }
  [IPC.configApply]: { req: { root: string; edits: ConfigEdit[] }; res: WriteResult }
  [IPC.postsList]: { req: { root: string }; res: PostSummary[] }
  [IPC.postRead]: { req: { root: string; id: string }; res: PostDetail | null }
  [IPC.postSave]: {
    req: { root: string; id: string; frontmatter?: Partial<PostFrontmatter>; body?: string }
    res: WriteResult
  }
  [IPC.postCreate]: { req: { root: string; input: PostCreateInput }; res: PostCreateResult }
  [IPC.postDelete]: { req: { root: string; id: string }; res: WriteResult }
  [IPC.wizardApply]: { req: { root: string; identity: SiteIdentity }; res: WriteResult }
  [IPC.verifyRun]: { req: { root: string }; res: VerifyResult }
  [IPC.mediaList]: { req: { root: string }; res: MediaItem[] }
  [IPC.mediaImport]: { req: { root: string; files: string[] }; res: MediaImportResult }
  [IPC.revealInFolder]: { req: { path: string }; res: RevealResult }
}

export type IpcHandler<K extends IpcChannel> = (
  req: IpcProtocol[K]['req'],
  ctx: IpcInvokeContext,
) => IpcProtocol[K]['res'] | Promise<IpcProtocol[K]['res']>

export type IpcHandlers = { [K in IpcChannel]: IpcHandler<K> }

/**
 * A3-internal diagnostics channels. These are NOT part of the frozen contract: they only exist so
 * the renderer can hand back the evidence the harness needs (see _scratch/a3). Named with the
 * `studio:` prefix so they can never collide with a contract channel.
 */
export const DEBUG_IPC = {
  dump: 'studio:debug-dump',
  capture: 'studio:debug-capture',
} as const

/* ─────────────────── compile-time contract coverage proof ─────────────────── */

type Assert<T extends true> = T
type SameKeys<A extends PropertyKey, B extends PropertyKey> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false

/** Compile error here ⇔ IpcProtocol and contract.ts IPC drifted apart. */
export type _ProtocolCoversContract = Assert<SameKeys<keyof IpcProtocol, IpcChannel>>
