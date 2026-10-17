/**
 * A3 — evidence recorder.
 *
 * The harness acceptance requires *artifacts*, not claims: every IPC round trip is appended to
 * `ipc-roundtrips.jsonl` and flushed to `ipc-roundtrips.json`; the window screenshot and the DOM
 * text the renderer actually painted are written next to it.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IpcChannel } from '../shared/contract'

export type RoundTripRecord = {
  seq: number
  channel: IpcChannel
  ok: boolean
  ms: number
  at: string
  request: unknown
  response?: unknown
  error?: string
}

export class EvidenceRecorder {
  readonly dir: string
  readonly records: RoundTripRecord[] = []
  private readonly jsonlPath: string

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.jsonlPath = path.join(dir, 'ipc-roundtrips.jsonl')
  }

  /** Evidence must never break the app: all writes are best-effort. */
  record(entry: Omit<RoundTripRecord, 'seq' | 'at'>): RoundTripRecord {
    const record: RoundTripRecord = { seq: this.records.length + 1, at: new Date().toISOString(), ...entry }
    this.records.push(record)
    try {
      appendFileSync(this.jsonlPath, JSON.stringify(record) + '\n')
    } catch {
      /* ignore */
    }
    return record
  }

  writeJson(name: string, value: unknown): string {
    const file = path.join(this.dir, name)
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
    return file
  }

  writeBinary(name: string, data: Buffer): string {
    const file = path.join(this.dir, name)
    writeFileSync(file, data)
    return file
  }

  flush(): string {
    return this.writeJson('ipc-roundtrips.json', this.records)
  }
}
