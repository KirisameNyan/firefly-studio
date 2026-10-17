/**
 * Recursive FieldNode renderer: one control per FieldKind.
 *
 * IMPORTANT: a field's live value is resolved from the *root* node of the module
 * (`getValueAtPath(rootFields, node.path)`) instead of from `node.value`. contract.ts documents
 * `value` as "the current value", but for a nested field the authoritative copy lives in the
 * enclosing container node's value — a draft written to "themeColor.defaultMode" updates
 * `themeColor.value`, and reading `node.value` of the child would show a stale value. Resolving
 * through the root also makes concrete array paths ("favicon[1].src") work.
 */
import { useState } from 'react'
import type { FieldNode, JsonValue } from '@shared/contract'
import { concretePath, getValueAtPath, kindLabel, originLabel, readOnlyReason } from '../lib/fields'
import { formatJson } from '../lib/format'

export type FieldControlProps = {
  node: FieldNode
  /** Root fields of the enclosing module — the value resolution source. */
  rootFields: FieldNode[]
  onChange: (path: string, value: JsonValue) => void
  depth?: number
}

const asText = (value: JsonValue | undefined): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return formatJson(value, 400)
}

const asStringList = (value: JsonValue | undefined): string[] =>
  Array.isArray(value) ? value.map((item) => asText(item)) : []

const asNumberList = (value: JsonValue | undefined): number[] =>
  Array.isArray(value) ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : []

const asEntries = (value: JsonValue | undefined): Array<[string, JsonValue]> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, JsonValue>)
    : []

const parsePrimitive = (text: string): JsonValue => {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const numeric = Number(trimmed)
  if (trimmed !== '' && Number.isFinite(numeric) && String(numeric) === trimmed) return numeric
  return text
}

function FieldShell({
  node,
  depth,
  readOnly,
  children,
}: {
  node: FieldNode
  depth: number
  readOnly: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={'field' + (readOnly ? ' is-readonly' : '') + (depth > 0 ? ' is-nested' : '')}
      data-field-path={node.path}
      data-field-kind={node.kind}
      data-readonly={readOnly ? 'true' : 'false'}
      data-depth={depth}
    >
      <div className="field-head">
        <span className="field-label">{node.label}</span>
        <span className="chip chip-kind">{kindLabel(node.kind)}</span>
        {node.optional && <span className="chip chip-muted">可选</span>}
        {readOnly && <span className="chip chip-warn">只读</span>}
        <code className="field-path" title={node.path}>
          {node.path}
        </code>
      </div>
      {node.help && <p className="field-help">{node.help}</p>}
      {children}
      {readOnly && (
        <p className="field-note">
          只读原因：{readOnlyReason(node)} · 来源：{originLabel(node.origin)}
          {node.tsType ? ' · 类型：' + node.tsType : ''}
        </p>
      )}
    </div>
  )
}

/** stringArray / numberArray editor: removable chips + one input. */
function ArrayEditor({
  node,
  numeric,
  value,
  onChange,
}: {
  node: FieldNode
  numeric: boolean
  value: JsonValue | undefined
  onChange: (path: string, value: JsonValue) => void
}) {
  const [draft, setDraft] = useState('')
  const items = numeric ? asNumberList(value).map(String) : asStringList(value)

  const commit = (next: string[]): void => {
    onChange(node.path, numeric ? next.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : next)
  }

  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    commit([...items, text])
    setDraft('')
  }

  return (
    <div className="array-editor">
      <div className="tag-list">
        {items.length === 0 && <span className="muted">（空数组）</span>}
        {items.map((item, index) => (
          <span className="tag" key={node.path + '#' + index}>
            <span className="tag-text">{item}</span>
            <button
              type="button"
              className="tag-remove"
              title="删除该项"
              data-testid="array-remove"
              onClick={() => commit(items.filter((_value, position) => position !== index))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="array-add-row">
        <input
          type={numeric ? 'number' : 'text'}
          className="control"
          value={draft}
          placeholder={numeric ? '输入数字后回车' : '输入内容后回车；如 /uploads/cover.webp'}
          data-testid="array-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn btn-ghost" data-testid="array-add" onClick={add}>
          添加
        </button>
      </div>
    </div>
  )
}

function RecordEditor({
  node,
  value,
  onChange,
}: {
  node: FieldNode
  value: JsonValue | undefined
  onChange: (path: string, value: JsonValue) => void
}) {
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const entries = asEntries(value)

  const commit = (pairs: Array<[string, JsonValue]>): void => {
    const next: Record<string, JsonValue> = {}
    for (const [key, item] of pairs) next[key] = item
    onChange(node.path, next)
  }

  return (
    <div className="record-editor">
      {entries.length === 0 && <p className="muted">（空键值表）</p>}
      {entries.map(([key, item], index) => (
        <div className="record-row" key={node.path + '#' + key}>
          <input className="control control-key" value={key} readOnly title="键名（不在此处改名）" />
          <input
            className="control"
            value={typeof item === 'string' ? item : formatJson(item, 200)}
            data-testid="record-value"
            onChange={(event) => {
              const pairs = entries.slice() as Array<[string, JsonValue]>
              pairs[index] = [key, parsePrimitive(event.target.value)]
              commit(pairs)
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="record-remove"
            onClick={() => commit(entries.filter((_pair, position) => position !== index))}
          >
            删除
          </button>
        </div>
      ))}
      <div className="record-row">
        <input
          className="control control-key"
          placeholder="新键名"
          value={newKey}
          data-testid="record-new-key"
          onChange={(event) => setNewKey(event.target.value)}
        />
        <input
          className="control"
          placeholder="新值"
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="record-add"
          onClick={() => {
            const key = newKey.trim()
            if (!key || entries.some(([existing]) => existing === key)) return
            commit([...entries, [key, parsePrimitive(newValue)]])
            setNewKey('')
            setNewValue('')
          }}
        >
          添加
        </button>
      </div>
    </div>
  )
}

function ReadOnlyView({ value, multiline }: { value: JsonValue | undefined; multiline: boolean }) {
  const text = asText(value)
  if (multiline) {
    return <textarea className="control" value={text} readOnly rows={3} data-testid="readonly-value" />
  }
  return <input className="control" value={text} readOnly data-testid="readonly-value" />
}

function FieldControl({ node, rootFields, onChange, depth = 0 }: FieldControlProps) {
  const readOnly = node.readOnly || node.origin === 'computed'
  /** Authoritative value for this node (see the file header comment). */
  const resolved = getValueAtPath(rootFields, node.path) ?? node.value

  if (node.kind === 'object' && node.children?.length && !readOnly) {
    return (
      <FieldShell node={node} depth={depth} readOnly={false}>
        <fieldset className="fieldset">
          <legend className="sr-only">{node.label}</legend>
          {node.children.map((child) => (
            <FieldControl key={child.path} node={child} rootFields={rootFields} onChange={onChange} depth={depth + 1} />
          ))}
        </fieldset>
      </FieldShell>
    )
  }

  if (node.kind === 'objectArray' && node.element && !readOnly) {
    const items = Array.isArray(resolved) ? resolved : []
    const elementChildren = node.element.children ?? []
    const setItems = (next: JsonValue[]): void => onChange(node.path, next)
    return (
      <FieldShell node={node} depth={depth} readOnly={false}>
        <div className="object-array" data-testid="object-array">
          {items.map((_item, index) => (
            <div className="object-card" key={node.path + '#' + index} data-object-index={index}>
              <div className="object-card-head">
                <span className="chip chip-kind">
                  {node.key}[{index}]
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="object-array-remove"
                  onClick={() => setItems(items.filter((_value, position) => position !== index))}
                >
                  删除该项
                </button>
              </div>
              {elementChildren.map((child) => (
                <FieldControl
                  key={concretePath(child.path, index)}
                  node={{ ...child, path: concretePath(child.path, index) }}
                  rootFields={rootFields}
                  onChange={onChange}
                  depth={depth + 1}
                />
              ))}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="object-array-add"
            onClick={() => {
              const blank: Record<string, JsonValue> = {}
              for (const child of elementChildren) {
                if (child.readOnly) continue
                blank[child.key] = child.kind === 'boolean' ? false : child.kind === 'number' ? 0 : ''
              }
              setItems([...items, blank])
            }}
          >
            + 新增一项 {node.key}
          </button>
        </div>
      </FieldShell>
    )
  }

  if (readOnly) {
    return (
      <FieldShell node={node} depth={depth} readOnly>
        <ReadOnlyView value={resolved} multiline={asText(resolved).length > 48 || node.kind === 'text'} />
      </FieldShell>
    )
  }

  switch (node.kind) {
    case 'boolean': {
      const checked = resolved === true
      const inputId = 'sw-' + node.path.replace(/[^a-zA-Z0-9_-]+/g, '_')
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <div className="switch-row">
            <input
              id={inputId}
              type="checkbox"
              className="switch"
              checked={checked}
              data-testid="field-checkbox"
              data-field-path={node.path}
              onChange={(event) => onChange(node.path, event.target.checked)}
            />
            <label className="switch-text" htmlFor={inputId}>
              {checked ? '已开启' : '已关闭'}
            </label>
          </div>
        </FieldShell>
      )
    }
    case 'number': {
      const value = typeof resolved === 'number' ? resolved : ''
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <input
            type="number"
            className="control"
            value={value}
            data-testid="field-number"
            data-field-path={node.path}
            onChange={(event) => {
              const next = Number(event.target.value)
              onChange(node.path, Number.isFinite(next) ? next : 0)
            }}
          />
        </FieldShell>
      )
    }
    case 'enum': {
      const options = node.options ?? []
      const current = asText(resolved)
      const selected = options.find((option) => String(option.value) === current)
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <select
            className="control"
            value={current}
            data-testid="field-enum"
            data-field-path={node.path}
            onChange={(event) => {
              const option = options.find((candidate) => String(candidate.value) === event.target.value)
              onChange(node.path, option ? option.value : event.target.value)
            }}
          >
            {!selected && <option value={current}>{current || '（未设置）'}</option>}
            {options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label ? option.label + '（' + String(option.value) + '）' : String(option.value)}
              </option>
            ))}
          </select>
          {selected?.help && <p className="option-help">选项说明：{selected.help}</p>}
        </FieldShell>
      )
    }
    case 'stringArray':
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <ArrayEditor node={node} numeric={false} value={resolved} onChange={onChange} />
        </FieldShell>
      )
    case 'numberArray':
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <ArrayEditor node={node} numeric value={resolved} onChange={onChange} />
        </FieldShell>
      )
    case 'record':
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <RecordEditor node={node} value={resolved} onChange={onChange} />
        </FieldShell>
      )
    case 'text':
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <textarea
            className="control"
            rows={3}
            value={asText(resolved)}
            data-testid="field-text"
            data-field-path={node.path}
            onChange={(event) => onChange(node.path, event.target.value)}
          />
        </FieldShell>
      )
    default:
      return (
        <FieldShell node={node} depth={depth} readOnly={false}>
          <input
            type="text"
            className="control"
            value={asText(resolved)}
            data-testid="field-string"
            data-field-path={node.path}
            onChange={(event) => onChange(node.path, event.target.value)}
          />
          {node.origin !== 'literal' && <p className="field-note">写入目标：{originLabel(node.origin)}</p>}
        </FieldShell>
      )
  }
}

export default FieldControl
