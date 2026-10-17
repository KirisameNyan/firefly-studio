/** First-run guide: open a Firefly checkout, show project:check results, or enter demo data. */
import { useState } from 'react'
import type { ProjectCheck } from '@shared/contract'

export type ProjectGateProps = {
  check: ProjectCheck | null
  root: string
  onRootChange: (root: string) => void
  onPick: () => void
  onOpen: () => void
  onEnterDemo: () => void
  demoAvailable: boolean
  busy: boolean
  error: string | null
  notes: string[]
}

export default function ProjectGate({
  check,
  root,
  onRootChange,
  onPick,
  onOpen,
  onEnterDemo,
  demoAvailable,
  busy,
  error,
  notes,
}: ProjectGateProps) {
  const [manual, setManual] = useState('')
  const effectiveRoot = root || manual

  return (
    <section className="panel gate" data-testid="project-gate">
      <h1 className="gate-title">欢迎使用 Firefly Studio</h1>
      <p className="gate-sub">
        选择一个 Firefly 仓库根目录（含 <code>src/config</code> 与 <code>src/content</code>），Studio 会读取
        25 个配置模块与文章列表。所有写操作都会先经过 diff 预览。
      </p>

      <div className="gate-actions">
        <button type="button" className="btn" data-testid="pick-project" onClick={onPick} disabled={busy}>
          选择目录…
        </button>
        <input
          className="control gate-input"
          placeholder="也可以直接粘贴仓库绝对路径"
          value={effectiveRoot}
          data-testid="project-root"
          onChange={(event) => {
            setManual(event.target.value)
            onRootChange(event.target.value)
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          data-testid="open-project"
          onClick={onOpen}
          disabled={busy || !effectiveRoot}
        >
          打开项目
        </button>
      </div>

      {error && (
        <p className="notice notice-error" data-testid="gate-error">
          {error}
        </p>
      )}

      {check && (
        <div className="card" data-testid="project-check" data-is-firefly={String(check.isFirefly)}>
          <h3 className="card-title">project:check 检测结果</h3>
          <ul className="kv">
            <li>
              <span>是否 Firefly 仓库</span>
              <strong className={check.isFirefly ? 'ok' : 'bad'}>{check.isFirefly ? '是' : '否'}</strong>
            </li>
            <li>
              <span>仓库根目录</span>
              <code>{check.root || '(后端未返回路径)'}</code>
            </li>
            <li>
              <span>Firefly 版本</span>
              <code>{check.fireflyVersion ?? '(未知)'}</code>
            </li>
          </ul>
          {check.problems.length > 0 && (
            <div className="notice notice-warn" data-testid="project-problems">
              <strong>问题清单（{check.problems.length}）</strong>
              <ul>
                {check.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <ul className="notes" data-testid="gate-notes">
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}

      {demoAvailable && (
        <div className="card card-demo" data-testid="demo-cta">
          <h3 className="card-title">手边没有 Firefly 仓库？先浏览演示数据</h3>
          <p className="muted">
            内置 25 个配置模块（覆盖全部 FieldKind，含只读字段与 help 文本）、6 篇示例文章与首次向导。
            界面会持续标注「演示数据」，且演示模式下的 root 不是真实仓库——写入只会在后端失败，不会碰到你的项目。
          </p>
          <button type="button" className="btn btn-primary" data-testid="enter-demo" onClick={onEnterDemo}>
            进入演示项目
          </button>
        </div>
      )}
    </section>
  )
}
