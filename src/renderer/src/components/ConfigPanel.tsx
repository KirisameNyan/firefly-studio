/** Right side of the config view: module header + recursive form + in-module field search. */
import { useMemo, useState } from 'react'
import type { ConfigModule, JsonValue } from '@shared/contract'
import { applyDrafts } from '../data/source'
import { countLeaves, countReadOnly, filterFields, findFieldByPath, flattenFields, kindLabel } from '../lib/fields'
import FieldControl from './FieldControl'

export type ConfigPanelProps = {
  modules: ConfigModule[]
  drafts: Record<string, JsonValue>
  activeModuleId: string | null
  onSelectModule: (id: string) => void
  onChange: (moduleId: string, path: string, value: JsonValue) => void
  onRevertModule: (moduleId: string) => void
}

export default function ConfigPanel({
  modules,
  drafts,
  activeModuleId,
  onChange,
  onRevertModule,
}: ConfigPanelProps) {
  const [query, setQuery] = useState('')
  const effective = useMemo(() => applyDrafts(modules, drafts), [modules, drafts])
  const module = effective.find((candidate) => candidate.id === activeModuleId) ?? effective[0] ?? null

  const flat = useMemo(() => (module ? flattenFields(module.fields) : []), [module])
  const matches = useMemo(() => filterFields(flat, query), [flat, query])
  const searching = query.trim().length > 0

  if (!module) {
    return (
      <section className="panel">
        <p className="muted">当前数据源没有可编辑的配置模块。</p>
      </section>
    )
  }

  const moduleDrafts = Object.keys(drafts).filter((key) => key.startsWith(module.id + '::')).length
  const leaves = countLeaves(module.fields)
  const readOnlyFields = countReadOnly(module.fields)

  return (
    <section className="panel config-panel" data-testid="config-panel" data-active-module={module.id}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">{module.title}</h2>
          <p className="panel-sub">
            <code>{module.file}</code>
            <span className="dot">·</span>
            <code>{module.exportName}</code>
            {module.typeName && (
              <>
                <span className="dot">·</span>
                <code>{module.typeName}</code>
              </>
            )}
          </p>
        </div>
        <div className="panel-head-actions">
          <span className="chip chip-kind">{module.group}</span>
          <span className="chip chip-muted">{leaves} 个叶字段</span>
          {readOnlyFields > 0 && <span className="chip chip-warn">{readOnlyFields} 个只读</span>}
          {moduleDrafts > 0 && (
            <button type="button" className="btn btn-ghost" data-testid="revert-module" onClick={() => onRevertModule(module.id)}>
              还原本模块（{moduleDrafts}）
            </button>
          )}
        </div>
      </header>

      <div className="field-search-row">
        <input
          className="control"
          placeholder={'在「' + module.title + '」内搜索字段 / 注释 / 路径…'}
          value={query}
          data-testid="field-search"
          onChange={(event) => setQuery(event.target.value)}
        />
        {searching && (
          <span className="search-summary" data-testid="field-search-summary">
            匹配 {matches.length} / {flat.length} 个节点
          </span>
        )}
      </div>

      {searching ? (
        <div className="field-list" data-testid="field-search-results">
          {matches.slice(0, 60).map((item) => {
            const node = findFieldByPath(module.fields, item.path)
            if (!node) return null
            return (
              <FieldControl
                key={item.path}
                node={node}
                rootFields={module.fields}
                depth={item.depth}
                onChange={(path, value) => onChange(module.id, path, value)}
              />
            )
          })}
          {matches.length === 0 && <p className="muted">没有匹配的字段。</p>}
          {matches.length > 60 && <p className="muted">仅显示前 60 个匹配节点，请细化关键词。</p>}
        </div>
      ) : (
        <div className="field-list" data-testid="field-list">
          {module.fields.map((node) => (
            <FieldControl
              key={node.path}
              node={node}
              rootFields={module.fields}
              onChange={(path, value) => onChange(module.id, path, value)}
            />
          ))}
        </div>
      )}

      <footer className="panel-foot">
        <span className="muted">
          控件类型：{' '}
          {[...new Set(flat.filter((field) => field.depth >= 0).map((field) => field.kind))].map((kind) => kindLabel(kind)).join(' · ')}
        </span>
        <span className="muted">整体可编辑：{module.editable ? '是' : '否（computed 字段较多）'}</span>
      </footer>
    </section>
  )
}
