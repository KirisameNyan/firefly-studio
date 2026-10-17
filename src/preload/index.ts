/**
 * A3 — preload bridge.
 *
 * Built as CommonJS (`out/preload/index.cjs`) so the renderer can keep `sandbox: true` +
 * `contextIsolation: true` + `nodeIntegration: false`. Nothing but a frozen, typed wrapper over
 * the contract channels is exposed on `window.studio` — no raw `ipcRenderer`.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type IpcChannel } from '../shared/contract'
import { DEBUG_IPC, type IpcProtocol } from '../main/ipc/protocol'
import type { StudioApi } from './api'

function invoke<K extends IpcChannel>(channel: K, request: IpcProtocol[K]['req']): Promise<IpcProtocol[K]['res']> {
  return ipcRenderer.invoke(channel, request)
}

const api: StudioApi = {
  project: {
    pick: () => invoke(IPC.projectPick, undefined),
    open: (root) => invoke(IPC.projectOpen, { root }),
    check: (root = '') => invoke(IPC.projectCheck, { root }),
  },
  schema: {
    get: (root, moduleId) => invoke(IPC.schemaGet, { root, moduleId }),
  },
  config: {
    preview: (root, edits) => invoke(IPC.configPreview, { root, edits }),
    apply: (root, edits) => invoke(IPC.configApply, { root, edits }),
  },
  posts: {
    list: (root) => invoke(IPC.postsList, { root }),
    read: (root, id) => invoke(IPC.postRead, { root, id }),
    save: (root, id, patch) => invoke(IPC.postSave, { root, id, ...patch }),
    create: (root, input) => invoke(IPC.postCreate, { root, input }),
    remove: (root, id) => invoke(IPC.postDelete, { root, id }),
  },
  wizard: {
    apply: (root, identity) => invoke(IPC.wizardApply, { root, identity }),
  },
  verify: {
    run: (root) => invoke(IPC.verifyRun, { root }),
  },
  media: {
    list: (root) => invoke(IPC.mediaList, { root }),
    import: (root, files) => invoke(IPC.mediaImport, { root, files }),
  },
  shell: {
    reveal: (target) => invoke(IPC.revealInFolder, { path: target }),
  },
  debug: {
    dump: (report) => ipcRenderer.invoke(DEBUG_IPC.dump, report) as Promise<string>,
    capture: () => ipcRenderer.invoke(DEBUG_IPC.capture) as Promise<string | null>,
  },
}

contextBridge.exposeInMainWorld('studio', api)
