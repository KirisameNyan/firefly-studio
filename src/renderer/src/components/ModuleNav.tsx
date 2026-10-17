/** Left navigation: module search + modules grouped by 基础 / 外观 / 内容 / 集成. */
import type { ConfigModule } from '@shared/contract'
import { flattenFields, groupModules, moduleMatches } from '../lib/fields'

export type ModuleNavProps = {
  modules: ConfigModule[]
  activeId: string | null
  onSelect: (id: string) => void
  query: string
  onQuery: (query: string) => void
  draftCountOf: (moduleId: string) => number
}

export default function ModuleNav({ modules, activeId, onSelect, query, onQuery, draftCountOf }: ModuleNavProps) {
  const visible = query.trim() ? modules.filter((module) => moduleMatches(module, query)) : modules
  const groups = groupModules(visible)
  const groupSummary = groupModules(modules)
    .map((group) => group.group + ' ' + group.modules.length)
    .join(' · ')

  return (
    <nav className="module-nav" data-testid="module-nav" data-module-count={modules.length}>
      <div className="nav-head">
        <div className="nav-title">
          配置模块
          <span className="chip chip-count" data-testid="module-count">
            {modules.length}
          </span>
        </div>
        <p className="nav-sub">{groupSummary}</p>
        <input
          className="control"
          placeholder="搜索模块 / 字段 / 注释…"
          value={query}
          data-testid="module-search"
          onChange={(event) => onQuery(event.target.value)}
        />
        {query.trim() && (
          <p className="nav-sub">
            匹配 {visible.length} / {modules.length} 个模块
          </p>
        )}
      </div>
      <div className="nav-groups">
        {groups.map((group) => (
          <section className="nav-group" key={group.group}>
            <h4 className="nav-group-title">
              {group.group}
              <span className="nav-group-count">{group.modules.length}</span>
            </h4>
            <ul className="nav-list">
              {group.modules.map((module) => {
                const drafts = draftCountOf(module.id)
                const nodeCount = flattenFields(module.fields).length
                return (
                  <li key={module.id}>
                    <button
                      type="button"
                      className={'nav-item' + (module.id === activeId ? ' is-active' : '')}
                      data-module-id={module.id}
                      title={module.file}
                      onClick={() => onSelect(module.id)}
                    >
                      <span className="nav-item-title">{module.title}</span>
                      <span className="nav-item-meta">
                        <code>{module.exportName}</code>
                        <span className="nav-item-count" title="字段节点数（含嵌套）">{nodeCount}</span>
                        {drafts > 0 && <span className="chip chip-draft">{drafts} 待保存</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {visible.length === 0 && <p className="muted">没有匹配的模块</p>}
      </div>
    </nav>
  )
}
