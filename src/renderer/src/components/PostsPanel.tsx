/** Article management: filtered list (title + tags + draft) on the left, editor on the right. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PostDetail, PostSummary, WriteError } from '@shared/contract'
import type { StudioApi } from '../../../preload/api'
import { errorMessage, normalizeWriteResult } from '../data/normalize'
import { loadPostDetail, loadPosts, type DataSource } from '../data/source'
import { formatDate } from '../lib/format'
import PostEditor from './PostEditor'

export type PostsPanelProps = {
  api: StudioApi
  source: DataSource
}

export default function PostsPanel({ api, source }: PostsPanelProps) {
  const [posts, setPosts] = useState<PostSummary[]>(source.posts)
  const [titleQuery, setTitleQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [draftOnly, setDraftOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(source.posts[0]?.id ?? null)
  const [detail, setDetail] = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [failures, setFailures] = useState<WriteError[]>([])
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newDraft, setNewDraft] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<PostSummary[]> => {
    const list = await loadPosts(api, source)
    setPosts(list)
    return list
  }, [api, source])

  useEffect(() => {
    void refresh().then((list) => {
      setSelectedId((current) => current ?? list[0]?.id ?? null)
    })
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void loadPostDetail(api, source, selectedId)
      .then((loaded) => {
        if (cancelled) return
        setDetail(loaded)
        if (!loaded) setStatus('post:read 返回 null（文件可能已被删除）')
      })
      .catch((error) => {
        if (!cancelled) setStatus('读取文章失败：' + errorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, source, selectedId])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const post of posts) for (const tag of post.tags) tags.add(tag)
    return [...tags].sort()
  }, [posts])

  const visible = useMemo(() => {
    const query = titleQuery.trim().toLowerCase()
    return posts.filter((post) => {
      if (draftOnly && !post.draft) return false
      if (tagFilter.length && !tagFilter.every((tag) => post.tags.includes(tag))) return false
      if (!query) return true
      return (
        post.title.toLowerCase().includes(query) ||
        post.slug.toLowerCase().includes(query) ||
        post.excerpt.toLowerCase().includes(query) ||
        post.tags.some((tag) => tag.toLowerCase().includes(query))
      )
    })
  }, [posts, titleQuery, tagFilter, draftOnly])

  const createPost = async (): Promise<void> => {
    setFailures([])
    setStatus(null)
    try {
      const created = await api.posts.create(source.root, {
        title: newTitle.trim() || '未命名文章',
        slug: newSlug.trim() || undefined,
        tags: newTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        draft: newDraft,
      })
      if (created?.ok && created.post) {
        setCreating(false)
        setNewTitle('')
        setNewSlug('')
        setNewTags('')
        setStatus('已创建：' + created.post.file)
        await refresh()
        setSelectedId(created.post.id)
      } else {
        setFailures(created?.errors ?? [{ path: '', message: 'post:create 返回 ok:false' }])
      }
    } catch (error) {
      setFailures([{ path: newSlug || newTitle, message: errorMessage(error) }])
    }
  }

  const deletePost = async (id: string): Promise<void> => {
    setFailures([])
    setStatus(null)
    try {
      const result = normalizeWriteResult(await api.posts.remove(source.root, id))
      if (result.ok) {
        setStatus('已删除：' + id)
        setConfirmDelete(null)
        const list = await refresh()
        setSelectedId(list[0]?.id ?? null)
      } else {
        setFailures(result.errors)
      }
    } catch (error) {
      setFailures([{ path: id, message: errorMessage(error) }])
    }
  }

  return (
    <section className="posts-panel" data-testid="posts-panel" data-post-count={posts.length}>
      <aside className="post-list-pane">
        <div className="pane-head">
          <h2 className="panel-title">
            文章
            <span className="chip chip-count" data-testid="post-count">
              {visible.length}/{posts.length}
            </span>
          </h2>
          <button type="button" className="btn btn-primary" data-testid="new-post" onClick={() => setCreating(true)}>
            新建文章
          </button>
        </div>

        <div className="post-filters">
          <input
            className="control"
            placeholder="按标题 / slug / 摘要过滤…"
            value={titleQuery}
            data-testid="post-filter-title"
            onChange={(event) => setTitleQuery(event.target.value)}
          />
          <div className="switch-row switch-row-sm">
            <input
              id="post-filter-draft"
              type="checkbox"
              className="switch"
              checked={draftOnly}
              data-testid="post-filter-draft"
              onChange={(event) => setDraftOnly(event.target.checked)}
            />
            <label className="switch-text" htmlFor="post-filter-draft">
              仅草稿
            </label>
          </div>
          <div className="tag-filter" data-testid="post-tag-filters">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={'tag-btn' + (tagFilter.includes(tag) ? ' is-active' : '')}
                data-tag={tag}
                onClick={() =>
                  setTagFilter((current) =>
                    current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
                  )
                }
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>

        {creating && (
          <div className="create-form" data-testid="create-form">
            <input className="control" placeholder="标题（必填）" value={newTitle} data-testid="new-title" onChange={(event) => setNewTitle(event.target.value)} />
            <input className="control" placeholder="slug（留空按标题生成）" value={newSlug} onChange={(event) => setNewSlug(event.target.value)} />
            <input className="control" placeholder="标签，逗号分隔" value={newTags} onChange={(event) => setNewTags(event.target.value)} />
            <div className="switch-row switch-row-sm">
              <input id="new-post-draft" type="checkbox" className="switch" checked={newDraft} onChange={(event) => setNewDraft(event.target.checked)} />
              <label className="switch-text" htmlFor="new-post-draft">
                创建为草稿
              </label>
            </div>
            <div className="row-actions">
              <button type="button" className="btn btn-primary" data-testid="create-confirm" onClick={() => void createPost()}>
                创建
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </div>
        )}

        <ul className="post-list" data-testid="post-list">
          {visible.map((post) => (
            <li key={post.id}>
              <button
                type="button"
                className={'post-item' + (post.id === selectedId ? ' is-active' : '')}
                data-post-id={post.id}
                data-post-draft={String(post.draft)}
                data-post-encrypted={String(post.encrypted)}
                onClick={() => setSelectedId(post.id)}
              >
                <span className="post-item-title">
                  {post.pinned && <span className="chip chip-kind">置顶</span>}
                  {post.draft && <span className="chip chip-warn">草稿</span>}
                  {post.encrypted && <span className="chip chip-warn" title="加密文章">🔒 加密</span>}
                  {post.title}
                </span>
                <span className="post-item-meta">
                  <span>{formatDate(post.published)}</span>
                  {post.category && <span className="dot">·</span>}
                  {post.category && <span>{post.category}</span>}
                  <span className="dot">·</span>
                  <span>{post.wordCount} 字</span>
                </span>
                <span className="post-item-tags">
                  {post.tags.map((tag) => (
                    <span className="chip chip-muted" key={tag}>
                      #{tag}
                    </span>
                  ))}
                </span>
                <span className="post-item-excerpt">{post.excerpt}</span>
              </button>
              <button
                type="button"
                className="post-delete"
                data-testid="post-delete"
                title="删除这篇文章"
                onClick={() => setConfirmDelete(post.id)}
              >
                删除
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="muted">没有匹配的文章（试试清空过滤条件）。</li>}
        </ul>

        {confirmDelete && (
          <div className="notice notice-warn" data-testid="delete-confirm">
            确认删除 <code>{confirmDelete}</code>？
            <div className="row-actions">
              <button type="button" className="btn btn-danger" data-testid="delete-confirm-yes" onClick={() => void deletePost(confirmDelete)}>
                确认删除
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {failures.length > 0 && (
          <div className="notice notice-error" data-testid="post-errors">
            <strong>操作失败（ok:false）</strong>
            <ul>
              {failures.map((error, index) => (
                <li key={index}>
                  <code>{error.path || '(未提供路径)'}</code> — {error.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {status && (
          <p className="notice" data-testid="post-status">
            {status}
          </p>
        )}
        {source.origin === 'demo' && (
          <p className="muted pane-note">演示数据：posts:save / post:create / post:delete 仍由 A3 桩实现拒绝，失败原因会原样显示。</p>
        )}
      </aside>

      <div className="post-editor-pane">
        {loading && <p className="muted">读取文章中…</p>}
        {!loading && detail && (
          <PostEditor
            key={detail.id}
            api={api}
            source={source}
            detail={detail}
            onSaved={(result) => {
              setStatus('已保存：' + (result.changed.join('、') || detail.file))
              void refresh()
            }}
          />
        )}
        {!loading && !detail && <p className="muted">从左侧选择一篇文章开始编辑。</p>}
      </div>
    </section>
  )
}
