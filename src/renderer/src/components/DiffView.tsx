/** Pre-save diff review: unified or side-by-side, per file, with hunk context. */
import { useState } from 'react'
import type { FileDiff, WriteError } from '@shared/contract'
import { sideBySideRows, viewOfFileDiff } from '../lib/diff'

export type DiffViewProps = {
  diffs: FileDiff[]
  /** local = computed from demo source text because the backend refused to preview. */
  view: 'backend' | 'local'
  refusal?: WriteError[]
  emptyHint?: string
}

export default function DiffView({ diffs, view, refusal = [], emptyHint }: DiffViewProps) {
  const [mode, setMode] = useState<'unified' | 'side'>('unified')
  const views = diffs.map((diff) => viewOfFileDiff(diff))
  const totals = views.reduce(
    (acc, item) => ({ added: acc.added + item.added, removed: acc.removed + item.removed }),
    { added: 0, removed: 0 },
  )

  return (
    <div className="diff-view" data-testid="diff-view" data-diff-files={diffs.length} data-diff-view={view}>
      <header className="diff-head">
        <div className="diff-title">
          <strong>保存前预览</strong>
          <span className="chip chip-muted" data-testid="diff-file-count">
            {diffs.length} 个文件
          </span>
          <span className="chip chip-add">+{totals.added}</span>
          <span className="chip chip-del">-{totals.removed}</span>
        </div>
        <div className="diff-modes">
          <button
            type="button"
            className={'btn' + (mode === 'unified' ? ' is-active' : '')}
            data-testid="diff-mode-unified"
            onClick={() => setMode('unified')}
          >
            统一视图
          </button>
          <button
            type="button"
            className={'btn' + (mode === 'side' ? ' is-active' : '')}
            data-testid="diff-mode-side"
            onClick={() => setMode('side')}
          >
            并排视图
          </button>
        </div>
      </header>

      {view === 'local' && (
        <p className="notice notice-warn" data-testid="diff-simulated">
          本地预演：后端 config:preview 仍为桩实现（拒绝写入），下面的 diff 由演示源码文本计算，用于验证 UI 路径；
          <strong>不会写入任何文件</strong>。
        </p>
      )}

      {refusal.length > 0 && (
        <div className="notice notice-error" data-testid="diff-refusal">
          <strong>后端拒绝原因（WriteError）</strong>
          <ul>
            {refusal.map((error, index) => (
              <li key={index}>
                <code>{error.path || '(未提供路径)'}</code> — {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diffs.length === 0 ? (
        <p className="notice" data-testid="diff-empty">
          {emptyHint ?? '没有需要写入的改动：所有字段的值与源码一致。'}
        </p>
      ) : (
        views.map((fileDiff) => (
          <section className="diff-file" key={fileDiff.file} data-diff-file={fileDiff.file}>
            <div className="diff-file-head">
              <code>{fileDiff.file}</code>
              <span className="chip chip-add">+{fileDiff.added}</span>
              <span className="chip chip-del">-{fileDiff.removed}</span>
              {fileDiff.statsMismatch && <span className="chip chip-warn">后端行数与实际不一致</span>}
            </div>
            {fileDiff.hunks.map((hunk, hunkIndex) => (
              <div className="diff-hunk" key={fileDiff.file + '#' + hunkIndex}>
                <div className="diff-hunk-head">
                  @@ -{hunk.beforeStart},{hunk.beforeCount} +{hunk.afterStart},{hunk.afterCount} @@
                </div>
                {mode === 'unified'
                  ? hunk.lines.map((line, lineIndex) => (
                      <div className={'diff-line is-' + line.type} key={lineIndex}>
                        <span className="diff-gutter">{line.beforeNo ?? ''}</span>
                        <span className="diff-gutter">{line.afterNo ?? ''}</span>
                        <span className="diff-sign">
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        </span>
                        <code className="diff-text">{line.text || ' '}</code>
                      </div>
                    ))
                  : sideBySideRows(hunk).map((row, rowIndex) => (
                      <div className="diff-row-pair" key={rowIndex}>
                        <div className={'diff-line is-' + (row.left?.type ?? 'empty')}>
                          <span className="diff-gutter">{row.left?.beforeNo ?? ''}</span>
                          <span className="diff-sign">
                            {row.left ? (row.left.type === 'removed' ? '-' : ' ') : ''}
                          </span>
                          <code className="diff-text">{row.left?.text ?? ''}</code>
                        </div>
                        <div className={'diff-line is-' + (row.right?.type ?? 'empty')}>
                          <span className="diff-gutter">{row.right?.afterNo ?? ''}</span>
                          <span className="diff-sign">
                            {row.right ? (row.right.type === 'added' ? '+' : ' ') : ''}
                          </span>
                          <code className="diff-text">{row.right?.text ?? ''}</code>
                        </div>
                      </div>
                    ))}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}
