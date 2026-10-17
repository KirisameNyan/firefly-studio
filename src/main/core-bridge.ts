/**
 * A3/A5 — the one place where the real engine gets plugged in.
 *
 * A5: every contract channel is now backed by `src/core/**` (see `src/main/ipc/engine.ts`);
 * `stubs.ts` is kept only for its unit tests and is no longer part of the runtime path.
 * Nothing else in `src/main` changes: `src/main/index.ts` registers whatever map this function
 * returns, in the exact channel set of contract.ts.
 *
 * `pickProject` / `revealInFolder` stay here because they are the only OS side effects.
 */
import type { IpcHandlers } from './ipc/protocol'
import { createEngineHandlers } from './ipc/engine'
import { pickProjectViaDialog, revealInFolder } from './os-integration'

export function createCoreHandlers(): IpcHandlers {
  return createEngineHandlers({
    pickProject: pickProjectViaDialog,
    revealInFolder,
  })
}
