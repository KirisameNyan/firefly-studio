import { describe, expect, it } from 'vitest'
import { IPC, type IpcChannel } from '../../shared/contract'
import type { ProjectCheck, StudioProject } from '../../shared/contract'
import { createStubHandlers } from './stubs'
import type { IpcInvokeContext } from './protocol'

const ctx: IpcInvokeContext = { senderUrl: 'test://a3' }

const handlers = createStubHandlers({
  pickProject: async () => ({ root: null, canceled: true }),
  revealInFolder: async (target) => ({ revealed: false, path: target, reason: 'test' }),
})

type LooseHandler = (req: unknown, ctx: IpcInvokeContext) => Promise<unknown>
const call = (channel: IpcChannel, req: unknown) => (handlers[channel] as LooseHandler)(req, ctx)

/** One representative request per channel, so every stub is executed at least once. */
const payloadFor = (channel: IpcChannel): unknown => {
  switch (channel) {
    case IPC.projectOpen:
    case IPC.projectCheck:
    case IPC.postsList:
    case IPC.mediaList:
    case IPC.verifyRun:
      return { root: '/tmp/project' }
    case IPC.schemaGet:
      return { root: '/tmp/project', moduleId: 'siteConfig' }
    case IPC.configPreview:
    case IPC.configApply:
      return { root: '/tmp/project', edits: [{ moduleId: 'siteConfig', path: 'title', value: 'x' }] }
    case IPC.postRead:
      return { root: '/tmp/project', id: 'src/content/posts/stub-hello.md' }
    case IPC.postSave:
      return { root: '/tmp/project', id: 'src/content/posts/stub-hello.md', body: 'x' }
    case IPC.postCreate:
      return { root: '/tmp/project', input: { title: 'Hello' } }
    case IPC.postDelete:
      return { root: '/tmp/project', id: 'x' }
    case IPC.wizardApply:
      return { root: '/tmp/project', identity: { title: 'T', author: 'A' } }
    case IPC.mediaImport:
      return { root: '/tmp/project', files: ['a.png'] }
    case IPC.revealInFolder:
      return { path: '/tmp/project/a.png' }
    case IPC.projectPick:
    default:
      return undefined
  }
}

describe('IPC protocol coverage', () => {
  it('registers exactly the channels declared in contract.ts', () => {
    expect(Object.keys(handlers).sort()).toEqual([...Object.values(IPC)].sort())
  })
})

describe('A3 stub handlers', () => {
  it('project:check returns the frozen stub shape (isFirefly false, empty root, stub problem)', async () => {
    const result = (await call(IPC.projectCheck, { root: '/tmp/project' })) as ProjectCheck
    expect(result.isFirefly).toBe(false)
    expect(result.root).toBe('')
    expect(result.problems.join(' ')).toContain('stub')
  })

  it('project:open returns a contract-shaped StudioProject', async () => {
    const result = (await call(IPC.projectOpen, { root: '/tmp/project' })) as StudioProject
    expect(result.isFirefly).toBe(false)
    expect(result.root).toBe('')
    expect(Array.isArray(result.modules)).toBe(true)
    expect(Array.isArray(result.posts)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('never claims a successful write', async () => {
    const writes: IpcChannel[] = [IPC.configApply, IPC.postSave, IPC.postDelete, IPC.wizardApply]
    for (const channel of writes) {
      const result = (await call(channel, payloadFor(channel))) as { ok: boolean }
      expect(result.ok, channel).toBe(false)
    }
  })

  it('answers every channel with a JSON-serializable payload', async () => {
    for (const channel of Object.values(IPC)) {
      const response = await call(channel, payloadFor(channel))
      expect(() => JSON.stringify(response), channel).not.toThrow()
      expect(JSON.parse(JSON.stringify(response)), channel).not.toBeUndefined()
    }
  })
})
