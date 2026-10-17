/**
 * A3 — single registration point for every contract channel.
 *
 * `ipcMain.handle` is called exactly once per constant in `IPC`, so a channel can never be silently
 * missing; each round trip is logged and recorded as evidence.
 */
import { ipcMain } from 'electron'
import { IPC, type IpcChannel } from '../../shared/contract'
import type { EvidenceRecorder } from '../evidence'
import type { Logger } from '../logger'
import type { IpcHandlers, IpcInvokeContext } from './protocol'

export type RegisterDeps = { logger: Logger; evidence: EvidenceRecorder }

const summarize = (value: unknown, max = 220): string => {
  let text: string
  try {
    text = value === undefined ? 'undefined' : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text === undefined) text = 'undefined'
  return text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text
}

export function registerIpcHandlers(handlers: IpcHandlers, deps: RegisterDeps): IpcChannel[] {
  const registered: IpcChannel[] = []
  for (const channel of Object.values(IPC)) {
    const handler = handlers[channel] as
      | ((req: unknown, ctx: IpcInvokeContext) => Promise<unknown>)
      | undefined
    if (typeof handler !== 'function') {
      throw new Error(`[studio-main] no handler registered for contract channel ${channel}`)
    }
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const startedAt = Date.now()
      const ctx: IpcInvokeContext = { senderUrl: event.senderFrame?.url ?? '' }
      try {
        const response = await handler(payload, ctx)
        const ms = Date.now() - startedAt
        deps.logger.log(`[ipc] ${channel} ok ${ms}ms req=${summarize(payload)} res=${summarize(response)}`)
        deps.evidence.record({ channel, ok: true, ms, request: payload, response })
        return response
      } catch (error) {
        const ms = Date.now() - startedAt
        const message = error instanceof Error ? error.message : String(error)
        deps.logger.log(`[ipc] ${channel} FAILED ${ms}ms req=${summarize(payload)} error=${message}`)
        deps.evidence.record({ channel, ok: false, ms, request: payload, error: message })
        throw error
      }
    })
    registered.push(channel)
  }
  return registered
}
