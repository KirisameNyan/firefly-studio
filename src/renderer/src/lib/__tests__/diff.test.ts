import { describe, expect, it } from 'vitest'
import { buildHunks, diffLines, diffStats, sideBySideRows, splitLines, viewOfFileDiff } from '../diff'

const before = ['const a = 1', 'const b = 2', 'const c = 3'].join('\n')
const after = ['const a = 1', 'const b = 20', 'const c = 3', 'const d = 4'].join('\n')

describe('splitLines', () => {
  it('ignores a trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
  })
})

describe('diffLines', () => {
  it('classifies everything as context when nothing changed', () => {
    const lines = diffLines(before, before)
    expect(lines.every((line) => line.type === 'context')).toBe(true)
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 })
  })

  it('marks removed and added lines and keeps both line numbers', () => {
    const lines = diffLines(before, after)
    const removed = lines.filter((line) => line.type === 'removed')
    const added = lines.filter((line) => line.type === 'added')
    expect(removed.map((line) => line.text)).toEqual(['const b = 2'])
    expect(removed[0].beforeNo).toBe(2)
    expect(removed[0].afterNo).toBeNull()
    expect(added.map((line) => line.text)).toEqual(['const b = 20', 'const d = 4'])
    expect(added[0].afterNo).toBe(2)
    expect(added[0].beforeNo).toBeNull()
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 })
  })
})

describe('buildHunks', () => {
  it('returns no hunks for an unchanged pair', () => {
    expect(buildHunks(diffLines(before, before))).toEqual([])
  })

  it('splits distant changes into separate hunks and keeps the context window', () => {
    const longBefore = Array.from({ length: 30 }, (_value, index) => 'line ' + index).join('\n')
    const longAfter = longBefore.replace('line 2', 'line two').replace('line 25', 'line twenty-five')
    const hunks = buildHunks(diffLines(longBefore, longAfter), 2)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].lines.map((line) => line.text)).toEqual(['line 0', 'line 1', 'line 2', 'line two', 'line 3', 'line 4'])
    expect(hunks[0].beforeStart).toBe(1)
    expect(hunks[1].beforeCount).toBe(5)
  })

  it('pairs removed/added lines for the side-by-side view', () => {
    const hunks = buildHunks(diffLines(before, after), 1)
    const rows = sideBySideRows(hunks[0])
    const changed = rows.find((row) => row.left?.type === 'removed')
    expect(changed?.left?.text).toBe('const b = 2')
    expect(changed?.right?.text).toBe('const b = 20')
    expect(rows.some((row) => row.left === null && row.right?.type === 'added')).toBe(true)
    expect(rows.some((row) => row.left?.type === 'context' && row.right?.text === 'const a = 1')).toBe(true)
  })
})

describe('viewOfFileDiff', () => {
  it('recomputes stats and flags a backend mismatch', () => {
    const view = viewOfFileDiff({ file: 'src/config/siteConfig.ts', before, after, added: 99, removed: 0 })
    expect(view.added).toBe(2)
    expect(view.removed).toBe(1)
    expect(view.statsMismatch).toBe(true)
    expect(viewOfFileDiff({ file: 'f', before, after, added: 2, removed: 1 }).statsMismatch).toBe(false)
  })
})
