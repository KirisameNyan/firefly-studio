import { describe, expect, it } from 'vitest'
import { DEMO_MODULES, DEMO_POSTS } from '../demo'
import { generateModuleSource } from '../demoSource'
import { applyDrafts, buildLocalPreview, draftKey, draftsToEdits, parseDraftKey } from '../source'
import { collectFieldKinds, flattenFields, getValueAtPath } from '../../lib/fields'

describe('demo dataset', () => {
  it('ships 25 modules in the four groups', () => {
    expect(DEMO_MODULES).toHaveLength(25)
    const groups = new Set(DEMO_MODULES.map((module) => module.group))
    expect([...groups].sort()).toEqual(['内容', '基础', '外观', '集成'])
  })

  it('covers every FieldKind, including read-only fields', () => {
    const kinds = [...collectFieldKinds(DEMO_MODULES.flatMap((module) => module.fields))].sort()
    expect(kinds).toEqual([
      'boolean',
      'enum',
      'number',
      'numberArray',
      'object',
      'objectArray',
      'record',
      'string',
      'stringArray',
      'text',
      'unknown',
    ])
    const readOnly = flattenFields(DEMO_MODULES.flatMap((module) => module.fields)).filter((field) => field.readOnly)
    expect(readOnly.length).toBeGreaterThanOrEqual(2)
    expect(DEMO_POSTS.length).toBeGreaterThanOrEqual(6)
  })
})

describe('generateModuleSource', () => {
  const siteConfig = DEMO_MODULES[0]

  it('emits label, help and value lines for the tree', () => {
    const source = generateModuleSource(siteConfig)
    expect(source).toContain('// 站点标题')
    expect(source).toContain('// 站点名称，显示在浏览器标签、导航栏左上角与 OpenGraph 元数据中')
    expect(source).toContain('title: "Firefly Studio",')
    expect(source).toContain('defaultMode: "system",')
    expect(source).toContain('（只读）')
  })

  it('renders override values and array elements by index', () => {
    const source = generateModuleSource(siteConfig, { 'themeColor.hue': 250, 'favicon[1].src': '/dark.png' })
    expect(source).toContain('hue: 250,')
    expect(source).toContain('src: "/dark.png",')
  })
})

describe('preview pipeline', () => {
  it('turns drafts into edits and back into a diff', () => {
    const drafts = { [draftKey('siteConfig', 'card.border')]: true }
    const { edits, dropped } = draftsToEdits(drafts, DEMO_MODULES)
    expect(dropped).toHaveLength(0)
    expect(edits).toEqual([{ moduleId: 'siteConfig', path: 'card.border', value: true }])

    const result = buildLocalPreview(DEMO_MODULES, edits)
    expect(result.ok).toBe(true)
    expect(result.changed).toEqual(['src/config/siteConfig.ts'])
    expect(result.diffs[0].added).toBeGreaterThan(0)
    expect(result.diffs[0].before).toContain('border: false,')
    expect(result.diffs[0].after).toContain('border: true,')
  })

  it('applies drafts onto the tree without touching the original', () => {
    const drafts = { [draftKey('siteConfig', 'keywords')]: ['a', 'b'] as never }
    const applied = applyDrafts(DEMO_MODULES, drafts)
    expect(getValueAtPath(applied[0].fields, 'keywords')).toEqual(['a', 'b'])
    expect(getValueAtPath(DEMO_MODULES[0].fields, 'keywords')).toEqual(['Firefly', 'Fuwari', 'Astro', 'ACGN'])
  })

  it('reports read-only and unknown paths instead of silently writing them', () => {
    const drafts = {
      [draftKey('siteConfig', 'injectHead')]: 'x' as never,
      [draftKey('siteConfig', 'does.not.exist')]: 1 as never,
      [draftKey('ghostModule', 'title')]: 'x' as never,
    }
    const { edits, dropped } = draftsToEdits(drafts, DEMO_MODULES)
    expect(edits).toHaveLength(0)
    expect(dropped).toHaveLength(3)
    expect(dropped.map((item) => item.message).join(' ')).toContain('只读')
  })

  it('round-trips draft keys', () => {
    const key = draftKey('siteConfig', 'themeColor.hue')
    expect(parseDraftKey(key)).toEqual({ moduleId: 'siteConfig', path: 'themeColor.hue' })
  })
})
