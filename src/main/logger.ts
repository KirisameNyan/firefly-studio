/** A3 — one-line logger that mirrors stdout into the evidence directory. */
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export type Logger = {
  readonly file: string | null
  log(message: string): void
}

export function createLogger(filePath: string | null): Logger {
  let target: string | null = null
  if (filePath) {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true })
      target = filePath
    } catch {
      target = null
    }
  }
  return {
    file: target,
    log(message: string): void {
      const line = `[${new Date().toISOString()}] ${message}`
      console.log(`[studio-main] ${line}`)
      if (!target) return
      try {
        appendFileSync(target, line + '\n')
      } catch {
        /* ignore */
      }
    },
  }
}
