import { describe, expect, it } from 'vitest'
import type { ConfigModule, FieldNode } from '@shared/contract'
import {
  concretePath,
  collectFieldKinds,
  countLeaves,
  countReadOnly,
  filterFields,
  findFieldByPath,
  flattenFields,
  getValueAtPath,
  groupModules,
  parsePath,
  readOnlyReason,
  setValueAtPath,
} from '../fields'

const leaf = (path: string, overrides: Partial<FieldNode> = {}): FieldNode => ({
  path,
  key: path.split('.').pop() as string,
  label: overrides.label ?? path,
  kind: 'string',
  optional: false,
  value: '',
  origin: 'literal',
  readOnly: false,
  ...overrides,
})

const fields: FieldNode[] = [
  leaf('title', { label: '站点标题', help: '站点名称，显示在浏览器标签中', value: 'Firefly' }),
  leaf('themeColor', {
    label: '主题色',
    kind: 'object',
    value: { hue: 165, defaultMode: 'system' },
    children: [
      leaf('themeColor.hue', { label: '主题色相', help: '范围 0-360', kind: 'number', value: 165 }),
      leaf('themeColor.defaultMode', {
        label: '默认模式',
        help: '首次访问时的亮暗模式',
        kind: 'enum',
        value: 'system',
        options: [
          { value: 'dark', label: '暗色', help: '始终使用暗色主题' },
          { value: 'system', label: '跟随系统' },
        ],
      }),
    ],
  }),
  leaf('keywords', { label: '站点关键词', kind: 'stringArray', value: ['Firefly', 'Astro'] }),
  leaf('favicon', {
    label: 'Favicon 图标',
    kind: 'objectArray',
    value: [{ src: '/a.png' }, { src: '/b.png' }],
    element: {
      path: 'favicon[]',
      key: 'favicon',
      label: '图标项',
      kind: 'object',
      optional: false,
      origin: 'literal',
      readOnly: false,
      children: [leaf('favicon[].src', { label: '图标文件路径', value: '/a.png' })],
    },
  }),
  leaf('injectHead', {
    label: '注入 head',
    kind: 'unknown',
    origin: 'computed',
    readOnly: true,
    tsType: 'string | ((ctx: HeadContext) => string)',
    value: '<!-- x -->',
  }),
]

const moduleOf = (id: string, group: string, title = id): ConfigModule => ({
  id,
  file: 'src/config/' + id + '.ts',
  exportName: id,
  title,
  group,
  fields: [leaf('title', { label: '标题' })],
  editable: true,
})

describe('flattenFields', () => {
  it('emits containers before their children, depth first', () => {
    const flat = flattenFields(fields)
    expect(flat.map((item) => item.path)).toEqual([
      'title',
      'themeColor',
      'themeColor.hue',
      'themeColor.defaultMode',
      'keywords',
      'favicon',
      'favicon[]',
      'favicon[].src',
      'injectHead',
    ])
    expect(flat.find((item) => item.path === 'themeColor.hue')?.depth).toBe(1)
    expect(flat.find((item) => item.path === 'favicon[].src')?.depth).toBe(2)
  })

  it('builds a lowercase search haystack from label, help, path, kind and enum options', () => {
    const flat = flattenFields(fields)
    const mode = flat.find((item) => item.path === 'themeColor.defaultMode')
    expect(mode?.searchText).toContain('默认模式')
    expect(mode?.searchText).toContain('首次访问时的亮暗模式')
    expect(mode?.searchText).toContain('暗色')
    expect(mode?.searchText).toContain('枚举下拉')
  })
})

describe('filterFields', () => {
  it('returns everything for an empty query', () => {
    expect(filterFields(flattenFields(fields), '   ')).toHaveLength(flattenFields(fields).length)
  })

  it('matches on help text and on enum option labels', () => {
    const flat = flattenFields(fields)
    expect(filterFields(flat, '范围 0-360').map((item) => item.path)).toEqual(['themeColor.hue'])
    expect(filterFields(flat, '始终使用暗色主题').map((item) => item.path)).toEqual(['themeColor.defaultMode'])
  })

  it('requires every term to match (AND)', () => {
    const flat = flattenFields(fields)
    expect(filterFields(flat, '主题 色相').map((item) => item.path)).toEqual(['themeColor.hue'])
    expect(filterFields(flat, '主题 不存在')).toHaveLength(0)
  })
})

describe('groupModules', () => {
  it('orders groups 基础 / 外观 / 内容 / 集成 / 其他 and keeps unknown groups last', () => {
    const groups = groupModules([
      moduleOf('c', '内容'),
      moduleOf('z', '实验'),
      moduleOf('b', '基础'),
      moduleOf('a', '外观'),
      moduleOf('i', '集成'),
    ])
    expect(groups.map((group) => group.group)).toEqual(['基础', '外观', '内容', '集成', '实验'])
    expect(groups.map((group) => group.modules.map((module) => module.id))).toEqual([['b'], ['a'], ['c'], ['i'], ['z']])
  })
})

describe('path helpers', () => {
  it('parses dotted paths with array indices', () => {
    expect(parsePath('favicon[1].src')).toEqual([{ key: 'favicon', index: 1 }, { key: 'src' }])
    expect(parsePath('themeColor.hue')).toEqual([{ key: 'themeColor' }, { key: 'hue' }])
  })

  it('reads concrete values through array indices', () => {
    expect(getValueAtPath(fields, 'themeColor.hue')).toBe(165)
    expect(getValueAtPath(fields, 'favicon[1].src')).toBe('/b.png')
    expect(getValueAtPath(fields, 'favicon[9].src')).toBeUndefined()
  })

  it('writes immutably, creating intermediate objects', () => {
    const next = setValueAtPath(fields, 'themeColor.hue', 200)
    expect(getValueAtPath(next, 'themeColor.hue')).toBe(200)
    expect(getValueAtPath(fields, 'themeColor.hue')).toBe(165)
    expect(fields[1].value).toEqual({ hue: 165, defaultMode: 'system' })

    const appended = setValueAtPath(fields, 'favicon[2].src', '/c.png')
    expect(getValueAtPath(appended, 'favicon[2].src')).toBe('/c.png')
    expect((getValueAtPath(appended, 'favicon') as unknown[]).length).toBe(3)
  })

  it('maps template paths to concrete ones and finds nodes by either', () => {
    expect(concretePath('favicon[].src', 3)).toBe('favicon[3].src')
    expect(findFieldByPath(fields, 'favicon[3].src')?.label).toBe('图标文件路径')
    expect(findFieldByPath(fields, 'favicon[].src')?.label).toBe('图标文件路径')
    expect(findFieldByPath(fields, 'nope')).toBeNull()
  })
})

describe('statistics', () => {
  it('counts leaves, read-only nodes and distinct kinds', () => {
    expect(countLeaves(fields)).toBe(6)
    expect(countReadOnly(fields)).toBe(1)
    expect([...collectFieldKinds(fields)].sort()).toEqual(['enum', 'number', 'object', 'objectArray', 'string', 'stringArray', 'unknown'])
  })

  it('explains why a field is not editable', () => {
    const computed = leaf('x', { kind: 'number', origin: 'computed', readOnly: true })
    expect(readOnlyReason(computed)).toContain('无法安全写回')
    const unknown = leaf('y', { kind: 'unknown', readOnly: true, tsType: 'Foo | Bar' })
    expect(readOnlyReason(unknown)).toContain('Foo | Bar')
  })
})
