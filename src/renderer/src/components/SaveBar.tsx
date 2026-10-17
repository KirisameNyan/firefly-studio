/** Sticky save bar: pending edits, preview -> diff -> apply, with honest failure display. */
import type { ConfigModule, JsonValue, WriteResult } from '@shared/contract'
import type { PreviewOutcome } from '../data/source'
import { parseDraftKey } from '../data/source'
import { getValueAtPath } from '../lib/fields'
import { formatJson } from '../lib/format'

export type SaveBarProps = {
  drafts: Record<string, JsonValue>
  modules: ConfigModule[]
  busy: 'idle' | 'preview' | 'apply'
  previewOutcome: PreviewOutcome | null
  applyResult: WriteResult | null
  onRevert: (key: string) => void
  onRevertAll: () => void
  onPreview: () => void
  onApply: () => void
  onOpenDiff: () => void
}

export default function SaveBar({
  drafts,
  modules,
  busy,
  previewOutcome,
  applyResult,
  onRevert,
  onRevertAll,
  onPreview,
  onApply,
  onOpenDiff,
}: SaveBarProps) {
  const keys = Object.keys(drafts)
  const previewReady = Boolean(previewOutcome?.result.ok && previewOutcome.result.diffs.length > 0)
  const previewDiffCount = previewOutcome?.result.diffs.length ?? 0

  return (
    <footer className="save-bar" data-testid="save-bar" data-pending-count={keys.length}>
      <div className="save-bar-left">
        <div className="save-bar-title">
          <strong>待保存改动</strong>
          <span className="chip chip-count" data-testid="pending-count">
            {keys.length}
          </span>
          {keys.length > 0 && (
            <button type="button" className="btn btn-ghost" data-testid="revert-all" onClick={onRevertAll}>
              全部还原
            </button>
          )}
        </div>
        <div className="draft-list" data-testid="pending-edits">
          {keys.length === 0 && <span className="muted">还没有改动：修改任意控件后这里会列出将被写入的字段。</span>}
          {keys.map((key) => {
            const { moduleId, path } = parseDraftKey(key)
            const module = modules.find((candidate) => candidate.id === moduleId)
            const previous = module ? getValueAtPath(module.fields, path) : undefined
            return (
              <span className="draft-row" key={key} data-edit-key={key} data-edit-value={formatJson(drafts[key], 200)}>
                <code className="draft-path">{path}</code>
                <span className="draft-delta">
                  <span className="draft-before">{formatJson(previous, 40)}</span>
                  <span className="draft-arrow">→</span>
                  <span className="draft-after">{formatJson(drafts[key], 40)}</span>
                </span>
                <button type="button" className="tag-remove" title="还原该字段" data-testid="revert-field" onClick={() => onRevert(key)}>
                  ×
                </button>
              </span>
            )
          })}
        </div>
      </div>

      <div className="save-bar-right">
        {previewOutcome && (
          <div className="save-bar-status" data-testid="preview-status">
            <span className={'chip ' + (previewOutcome.result.ok ? 'chip-ok' : 'chip-warn')}>
              预览{previewOutcome.result.ok ? '完成' : '失败'}
            </span>
            <span className="muted">
              {previewDiffCount} 个文件 · {previewOutcome.view === 'local' ? '本地预演' : '后端返回'}
            </span>
            <button type="button" className="btn btn-ghost" data-testid="open-diff" onClick={onOpenDiff}>
              查看 diff
            </button>
          </div>
        )}
        <div className="save-bar-actions">
          <button
            type="button"
            className="btn"
            data-testid="preview-button"
            disabled={busy !== 'idle' || keys.length === 0}
            onClick={onPreview}
          >
            {busy === 'preview' ? '预览中…' : '预览改动'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="apply-button"
            disabled={busy !== 'idle' || !previewReady}
            title={previewReady ? '写入源码文件' : '先预览，且必须有实际改动'}
            onClick={onApply}
          >
            {busy === 'apply' ? '写入中…' : '应用改动'}
          </button>
        </div>

        {applyResult && (
          <div className={'notice ' + (applyResult.ok ? 'notice-ok' : 'notice-error')} data-testid="apply-result">
            {applyResult.ok ? (
              <>
                <strong>写入成功</strong>：{applyResult.changed.length} 个文件
                {applyResult.changed.length > 0 && <span className="muted">（{applyResult.changed.join('、')}）</span>}
              </>
            ) : (
              <>
                <strong>写入失败</strong>（ok:false，不得显示成功）
                <ul data-testid="apply-errors">
                  {applyResult.errors.map((error, index) => (
                    <li key={index}>
                      <code>{error.path || '(未提供路径)'}</code> — {error.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </footer>
  )
}
