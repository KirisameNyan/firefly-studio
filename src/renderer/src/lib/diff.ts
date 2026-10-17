/**
 * Line-level diff for the pre-save preview (config.preview -> FileDiff[]).
 *
 * A FileDiff carries whole before/after texts, so classification happens here in the renderer:
 * LCS line diff, then hunk assembly with configurable context. Pure functions, unit tested.
 */
import type { FileDiff } from '@shared/contract'

export type DiffLineType = 'context' | 'added' | 'removed'

export type DiffLine = {
  type: DiffLineType
  text: string
  /** 1-based line number in `before`; null for added lines. */
  beforeNo: number | null
  /** 1-based line number in `after`; null for removed lines. */
  afterNo: number | null
}

export type DiffHunk = {
  beforeStart: number
  beforeCount: number
  afterStart: number
  afterCount: number
  lines: DiffLine[]
}

export type DiffStats = { added: number; removed: number }

/** A trailing newline must not create a phantom empty line. */
export function splitLines(text: string): string[] {
  if (!text) return []
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Classic LCS table; config files are small enough that O(n*m) is not a problem. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const n = a.length
  const m = b.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i], beforeNo: i + 1, afterNo: j + 1 })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: 'removed', text: a[i], beforeNo: i + 1, afterNo: null })
      i += 1
    } else {
      out.push({ type: 'added', text: b[j], beforeNo: null, afterNo: j + 1 })
      j += 1
    }
  }
  while (i < n) {
    out.push({ type: 'removed', text: a[i], beforeNo: i + 1, afterNo: null })
    i += 1
  }
  while (j < m) {
    out.push({ type: 'added', text: b[j], beforeNo: null, afterNo: j + 1 })
    j += 1
  }
  return out
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.type === 'added') added += 1
    else if (line.type === 'removed') removed += 1
  }
  return { added, removed }
}

/** Collapse unchanged stretches into hunks that keep `context` lines around each change. */
export function buildHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed: number[] = []
  lines.forEach((line, index) => {
    if (line.type !== 'context') changed.push(index)
  })
  if (!changed.length) return []

  const ranges: Array<[number, number]> = []
  let start = Math.max(0, changed[0] - context)
  let end = Math.min(lines.length - 1, changed[0] + context)
  for (const index of changed.slice(1)) {
    if (index - context <= end + 1) {
      end = Math.min(lines.length - 1, index + context)
    } else {
      ranges.push([start, end])
      start = Math.max(0, index - context)
      end = Math.min(lines.length - 1, index + context)
    }
  }
  ranges.push([start, end])

  return ranges.map(([from, to]) => {
    const slice = lines.slice(from, to + 1)
    const beforeNumbers = slice.map((line) => line.beforeNo).filter((value): value is number => value !== null)
    const afterNumbers = slice.map((line) => line.afterNo).filter((value): value is number => value !== null)
    return {
      beforeStart: beforeNumbers.length ? beforeNumbers[0] : 0,
      beforeCount: beforeNumbers.length,
      afterStart: afterNumbers.length ? afterNumbers[0] : 0,
      afterCount: afterNumbers.length,
      lines: slice,
    }
  })
}

export type FileDiffView = {
  file: string
  added: number
  removed: number
  lines: DiffLine[]
  hunks: DiffHunk[]
  /** True when the backend reported stats that disagree with the locally computed diff. */
  statsMismatch: boolean
}

export function viewOfFileDiff(diff: FileDiff, context = 3): FileDiffView {
  const lines = diffLines(diff.before, diff.after)
  const stats = diffStats(lines)
  return {
    file: diff.file,
    added: stats.added,
    removed: stats.removed,
    lines,
    hunks: buildHunks(lines, context),
    statsMismatch: stats.added !== diff.added || stats.removed !== diff.removed,
  }
}

export function summarizeDiffViews(views: FileDiffView[]): { files: number; added: number; removed: number } {
  return views.reduce(
    (acc, view) => ({ files: acc.files + 1, added: acc.added + view.added, removed: acc.removed + view.removed }),
    { files: 0, added: 0, removed: 0 },
  )
}

/** Side-by-side rows: removed/added lines are paired positionally inside each hunk. */
export type SideBySideRow = {
  left: DiffLine | null
  right: DiffLine | null
}

export function sideBySideRows(hunk: DiffHunk): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let pendingRemoved: DiffLine[] = []
  let pendingAdded: DiffLine[] = []
  const flush = (): void => {
    const count = Math.max(pendingRemoved.length, pendingAdded.length)
    for (let index = 0; index < count; index += 1) {
      rows.push({ left: pendingRemoved[index] ?? null, right: pendingAdded[index] ?? null })
    }
    pendingRemoved = []
    pendingAdded = []
  }
  for (const line of hunk.lines) {
    if (line.type === 'removed') pendingRemoved.push(line)
    else if (line.type === 'added') pendingAdded.push(line)
    else {
      flush()
      rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
}
