/**
 * Post editor: full frontmatter form (every contract.ts field) + Markdown body with live preview.
 * Saving goes through posts:save and never claims success when the backend answers ok:false.
 */
import { useMemo, useState } from 'react'
import type { PostDetail, PostFrontmatter, WriteResult } from '@shared/contract'
import type { StudioApi } from '../../../preload/api'
import type { DataSource } from '../data/source'
import { normalizeWriteResult } from '../data/normalize'
import { errorMessage } from '../data/normalize'
import { renderMarkdown } from '../lib/markdown'
import { formatDate, isoToLocalInput, localInputToIso } from '../lib/format'

type Control = 'text' | 'textarea' | 'datetime' | 'boolean' | 'tags' | 'number' | 'select'

type FrontField = {
  key: keyof PostFrontmatter
  label: string
  help: string
  control: Control
  options?: string[]
}

const FRONT_FIELDS: FrontField[] = [
  { key: 'title', label: '标题', help: '文章标题，同时用于 <title> 与列表展示', control: 'text' },
  { key: 'published', label: '发布日期', help: 'ISO 日期；写入 YAML 时由日期类型承载', control: 'datetime' },
  { key: 'updated', label: '更新日期', help: '可选；留空表示与发布日期相同', control: 'datetime' },
  { key: 'draft', label: '草稿', help: '草稿不会进入构建产物', control: 'boolean' },
  { key: 'description', label: '摘要', help: '列表与 SEO 描述', control: 'textarea' },
  { key: 'image', label: '封面图', help: 'public/ 下的路径（/uploads/cover.webp）或完整外链', control: 'text' },
  { key: 'tags', label: '标签', help: '支持多个标签，用于列表过滤与标签云', control: 'tags' },
  { key: 'category', label: '分类', help: '留空写入 null', control: 'text' },
  {
    key: 'lang',
    label: '语言',
    help: '文章语言代码',
    control: 'select',
    options: ['zh_CN', 'zh_TW', 'en', 'ja', 'ru', 'ko'],
  },
  { key: 'pinned', label: '置顶', help: '置顶文章排在列表最前', control: 'boolean' },
  { key: 'author', label: '作者', help: '显示在文章头部', control: 'text' },
  { key: 'sourceLink', label: '原文链接', help: '转载来源，留空表示原创', control: 'text' },
  { key: 'licenseName', label: '许可名称', help: '如 CC BY-NC-SA 4.0', control: 'text' },
  { key: 'licenseUrl', label: '许可地址', help: '许可全文链接', control: 'text' },
  { key: 'comment', label: '开启评论', help: '需要先配置评论系统', control: 'boolean' },
  { key: 'password', label: '密码', help: '非空即加密；列表会显示锁标记', control: 'text' },
  { key: 'passwordHint', label: '密码提示', help: '展示给读者的提示语', control: 'text' },
  { key: 'series', label: '系列名', help: '同一系列的文章会互相关联', control: 'text' },
  { key: 'seriesOrder', label: '系列序号', help: '可选；数字越小越靠前', control: 'number' },
]

export type PostEditorProps = {
  api: StudioApi
  source: DataSource
  detail: PostDetail
  onSaved: (result: WriteResult) => void
}

export default function PostEditor({ api, source, detail, onSaved }: PostEditorProps) {
  const [baseline, setBaseline] = useState<{ frontmatter: PostFrontmatter; body: string }>({
    frontmatter: detail.frontmatter,
    body: detail.body,
  })
  const [frontmatter, setFrontmatter] = useState<PostFrontmatter>(detail.frontmatter)
  const [body, setBody] = useState(detail.body)
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('split')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WriteResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const dirtyFields = FRONT_FIELDS.filter(
    (field) => JSON.stringify(frontmatter[field.key]) !== JSON.stringify(baseline.frontmatter[field.key]),
  ).map((field) => field.label)
  const dirty = dirtyFields.length > 0 || body !== baseline.body

  const preview = useMemo(() => renderMarkdown(body), [body])

  const patch = <K extends keyof PostFrontmatter>(key: K, value: PostFrontmatter[K]): void => {
    setFrontmatter((previous) => ({ ...previous, [key]: value }))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const outcome = normalizeWriteResult(
        await api.posts.save(source.root, detail.id, { frontmatter, body }),
      )
      setResult(outcome)
      if (outcome.ok) {
        setBaseline({ frontmatter, body })
        onSaved(outcome)
      }
    } catch (error) {
      setResult({ ok: false, changed: [], diffs: [], errors: [{ path: detail.file, message: errorMessage(error) }] })
    } finally {
      setBusy(false)
    }
  }

  const renderControl = (field: FrontField): React.ReactNode => {
    const value = frontmatter[field.key]
    const dataTestId = 'frontmatter-' + String(field.key)
    switch (field.control) {
      case 'boolean': {
        const inputId = 'fm-sw-' + String(field.key)
        return (
          <div className="switch-row">
            <input
              id={inputId}
              type="checkbox"
              className="switch"
              checked={Boolean(value)}
              data-testid={dataTestId}
              onChange={(event) => patch(field.key, event.target.checked as never)}
            />
            <label className="switch-text" htmlFor={inputId}>
              {value ? '是' : '否'}
            </label>
          </div>
        )
      }
      case 'textarea':
        return (
          <textarea
            className="control"
            rows={2}
            value={String(value ?? '')}
            data-testid={dataTestId}
            onChange={(event) => patch(field.key, event.target.value as never)}
          />
        )
      case 'datetime':
        return (
          <input
            type="datetime-local"
            className="control"
            value={isoToLocalInput(typeof value === 'string' ? value : '')}
            data-testid={dataTestId}
            onChange={(event) => patch(field.key, (localInputToIso(event.target.value) || undefined) as never)}
          />
        )
      case 'tags':
        return (
          <input
            className="control"
            value={(Array.isArray(value) ? (value as string[]) : []).join(', ')}
            placeholder="用逗号分隔，如 Astro, 教程"
            data-testid={dataTestId}
            onChange={(event) =>
              patch(
                field.key,
                event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean) as never,
              )
            }
          />
        )
      case 'number':
        return (
          <input
            type="number"
            className="control"
            value={typeof value === 'number' ? value : ''}
            placeholder="留空表示不设置"
            data-testid={dataTestId}
            onChange={(event) => {
              const next = event.target.value
              patch(field.key, (next === '' ? undefined : Number(next)) as never)
            }}
          />
        )
      case 'select':
        return (
          <select
            className="control"
            value={String(value ?? '')}
            data-testid={dataTestId}
            onChange={(event) => patch(field.key, event.target.value as never)}
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )
      default:
        return (
          <input
            className="control"
            value={String(value ?? '')}
            data-testid={dataTestId}
            onChange={(event) => patch(field.key, event.target.value as never)}
          />
        )
    }
  }

  return (
    <section className="panel post-editor" data-testid="post-editor" data-post-id={detail.id}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">{frontmatter.title || '(未命名)'}</h2>
          <p className="panel-sub">
            <code>{detail.file}</code>
            <span className="dot">·</span>
            <span>{formatDate(frontmatter.published)}</span>
            <span className="dot">·</span>
            <span>{detail.wordCount} 字</span>
          </p>
        </div>
        <div className="panel-head-actions">
          {frontmatter.draft && <span className="chip chip-warn">草稿</span>}
          {detail.encrypted && <span className="chip chip-warn">已加密</span>}
          {frontmatter.pinned && <span className="chip chip-kind">置顶</span>}
          {dirty && (
            <span className="chip chip-draft" data-testid="editor-dirty">
              未保存：{dirtyFields.length > 0 ? dirtyFields.join('、') : '正文'} {body !== baseline.body ? '+ 正文' : ''}
            </span>
          )}
        </div>
      </header>

      {detail.extraKeys.length > 0 && (
        <p className="notice notice-warn" data-testid="extra-keys">
          本文件还有未知 frontmatter 键（保存时原样保留）：<code>{detail.extraKeys.join(', ')}</code>
        </p>
      )}

      <div className="editor-grid">
        <div className="frontmatter-form" data-testid="frontmatter-form">
          <h3 className="section-title">Frontmatter（{FRONT_FIELDS.length} 个字段）</h3>
          {FRONT_FIELDS.map((field) => (
            <div className="fm-row" key={String(field.key)} data-fm-key={String(field.key)}>
              <label className="fm-label">
                {field.label}
                <code>{String(field.key)}</code>
              </label>
              {renderControl(field)}
              <p className="fm-help">{field.help}</p>
            </div>
          ))}
        </div>

        <div className="body-editor">
          <div className="body-head">
            <h3 className="section-title">正文（Markdown）</h3>
            <div className="diff-modes">
              <button type="button" className={'btn' + (mode === 'edit' ? ' is-active' : '')} data-testid="mode-edit" onClick={() => setMode('edit')}>
                编辑
              </button>
              <button type="button" className={'btn' + (mode === 'split' ? ' is-active' : '')} data-testid="mode-split" onClick={() => setMode('split')}>
                并排
              </button>
              <button type="button" className={'btn' + (mode === 'preview' ? ' is-active' : '')} data-testid="mode-preview" onClick={() => setMode('preview')}>
                预览
              </button>
            </div>
          </div>
          <div className={'body-panes is-' + mode}>
            {mode !== 'preview' && (
              <textarea
                className="control body-textarea"
                value={body}
                data-testid="post-body"
                onChange={(event) => setBody(event.target.value)}
              />
            )}
            {mode !== 'edit' && (
              <div className="markdown-preview" data-testid="markdown-preview">
                {preview.error ? (
                  <p className="notice notice-error">Markdown 渲染失败：{preview.error}</p>
                ) : (
                  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: preview.html }} />
                )}
              </div>
            )}
          </div>
          <p className="muted preview-source">预览由渲染进程的 marked 生成（契约里没有 renderMarkdown 通道，已与 A5 对齐）。</p>
        </div>
      </div>

      <footer className="editor-foot">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="post-save"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存文章'}
        </button>
        {!dirty && <span className="muted">没有改动</span>}
        {result && (
          <div className={'notice ' + (result.ok ? 'notice-ok' : 'notice-error')} data-testid="post-save-result">
            {result.ok ? (
              <>
                <strong>已写入</strong>：{result.changed.join('、') || '(后端未返回文件列表)'}
                {result.diffs.length > 0 && <span className="muted"> · {result.diffs.length} 个文件有 diff</span>}
              </>
            ) : (
              <>
                <strong>保存失败</strong>（ok:false）
                <ul data-testid="post-save-errors">
                  {result.errors.map((error, index) => (
                    <li key={index}>
                      <code>{error.path || '(未提供路径)'}</code> — {error.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {failure && <span className="bad">{failure}</span>}
      </footer>
    </section>
  )
}
