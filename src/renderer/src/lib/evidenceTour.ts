/**
 * Scripted UI tour.
 *
 * Two jobs, one driver:
 *   1. First-run onboarding — with no project open it opens one (project.pick) or falls back to the
 *      built-in demo dataset, then walks 配置 → 保存前 diff → 文章 → 首次向导. Interruptible at any
 *      time (any key / 跳过导览 button), so it never traps a real user.
 *   2. Acceptance evidence — it drives the *real* controls (native value setters + input/change
 *      events), captures one PNG per screen through the debug bridge, snapshots the DOM facts next to
 *      each frame (reading them at the end of the run would only describe the last view) and finally
 *      hands a JSON report to the main process, which writes renderer-report.json, dumps
 *      document.body.innerText and closes the run.
 */
import { click, nextFrame, readValue, scrollIntoView, selectValue, setInputValue, sleep, waitFor } from './dom'

export type TourView = 'gate' | 'config' | 'posts' | 'wizard'

export type TourInteraction = {
  scope: 'live' | 'demo'
  kind: string
  path: string
  before: string | null
  after: string | null
  /** Value the UI recorded as a pending write for that path (null when there is no draft row). */
  pendingValue: string | null
  note?: string
}

export type TourStepRecord = {
  label: string
  at: string
  view: TourView
  captured: string | null
  note?: string
  snapshot: Record<string, unknown>
}

export type TourHost = {
  /** True once the user pressed a key or the 跳过导览 button. */
  isStopped: () => boolean
  setView: (view: TourView) => Promise<void>
  selectModule: (id: string) => Promise<void>
  capture: (label: string) => Promise<string | null>
  describe: () => Record<string, unknown>
  /** Raw read-back of the open project's schema, used to freeze IPC payload evidence. */
  probe: () => Promise<Record<string, unknown>>
  dump: (report: unknown) => Promise<string | null>
}

const attr = (selector: string, name: string): string | null =>
  document.querySelector(selector)?.getAttribute(name) ?? null

const textOf = (selector: string): string | null => {
  const element = document.querySelector(selector)
  return element ? (element.textContent ?? '').trim().slice(0, 300) : null
}

const pendingEdits = (): Array<{ key: string | null; value: string | null }> =>
  Array.from(document.querySelectorAll('[data-edit-key]')).map((element) => ({
    key: element.getAttribute('data-edit-key'),
    value: element.getAttribute('data-edit-value'),
  }))

const pendingValueOf = (draftKey: string): string | null =>
  document.querySelector('[data-edit-key="' + draftKey + '"]')?.getAttribute('data-edit-value') ?? null

/** DOM facts for the current screen — recorded next to every frame. */
function snapshot(): Record<string, unknown> {
  return {
    view: attr('.app', 'data-view'),
    origin: attr('.app', 'data-origin'),
    moduleCount: attr('[data-testid="module-nav"]', 'data-module-count'),
    activeModule: attr('[data-testid="config-panel"]', 'data-active-module'),
    fieldKindsInPanel: textOf('[data-testid="config-panel"] .panel-foot'),
    readonlyFields: document.querySelectorAll('[data-readonly="true"]').length,
    pendingCount: attr('[data-testid="save-bar"]', 'data-pending-count'),
    pendingEdits: pendingEdits(),
    previewStatus: textOf('[data-testid="preview-status"]'),
    diffFiles: attr('[data-testid="diff-view"]', 'data-diff-files'),
    diffSource: attr('[data-testid="diff-view"]', 'data-diff-view'),
    diffSimulated: Boolean(document.querySelector('[data-testid="diff-simulated"]')),
    diffRefusal: textOf('[data-testid="diff-refusal"]'),
    diffEmpty: textOf('[data-testid="diff-empty"]'),
    applyResult: textOf('[data-testid="apply-result"]'),
    applyErrors: Array.from(document.querySelectorAll('[data-testid="apply-errors"] li')).map((item) => item.textContent),
    postCountLabel: textOf('[data-testid="post-count"]'),
    postsRendered: document.querySelectorAll('[data-post-id]').length,
    encryptedRendered: document.querySelectorAll('[data-post-encrypted="true"]').length,
    draftRendered: document.querySelectorAll('[data-post-draft="true"]').length,
    editorOpen: Boolean(document.querySelector('[data-testid="post-editor"]')),
    editorFrontmatterFields: document.querySelectorAll('[data-fm-key]').length,
    markdownPreviewChars: document.querySelector('[data-testid="markdown-preview"]')?.textContent?.length ?? 0,
    wizardStep: attr('[data-testid="wizard-panel"]', 'data-wizard-step'),
    wizardResultOk: attr('[data-testid="wizard-result"]', 'data-ok'),
    wizardErrors: Array.from(document.querySelectorAll('[data-testid="wizard-errors"] li')).map((item) => item.textContent),
    checkIsFirefly: attr('[data-testid="project-check"]', 'data-is-firefly'),
    problems: textOf('[data-testid="project-problems"]'),
  }
}

/** Non-throwing wait: used where both outcomes (opened / cancelled) are legitimate. */
async function appears(selector: string, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout
  for (;;) {
    if (document.querySelector(selector)) return true
    if (Date.now() > deadline) return false
    await sleep(100)
  }
}

/**
 * project.pick() either opens a project (scripted root in harness runs) or is cancelled. Waiting
 * blindly for the config panel would burn 45s on a cancellation, so watch both signals.
 */
async function waitForProject(timeout: number): Promise<'opened' | 'cancelled' | 'timeout'> {
  const deadline = Date.now() + timeout
  for (;;) {
    if (document.querySelector('[data-testid="config-panel"]')) return 'opened'
    const banners = document.querySelector('[data-testid="banners"]')?.textContent ?? ''
    if (banners.includes('已取消')) return 'cancelled'
    if (Date.now() > deadline) return 'timeout'
    await sleep(120)
  }
}

/** Buttons stay disabled until the previous step finished; poll instead of racing. */
async function waitForEnabled(selector: string, timeout = 8000): Promise<boolean> {
  const deadline = Date.now() + timeout
  for (;;) {
    const element = document.querySelector(selector)
    if (element && !(element as HTMLButtonElement).disabled) return true
    if (Date.now() > deadline) return false
    await sleep(60)
  }
}

export async function runEvidenceTour(host: TourHost): Promise<void> {
  const steps: TourStepRecord[] = []
  const interactions: TourInteraction[] = []
  const failures: string[] = []
  let currentView: TourView = 'gate'
  const state: { phase: 'live' | 'demo' | 'none' } = { phase: 'none' }
  let pendingAfterInteractions: Array<{ key: string | null; value: string | null }> = []

  const trace = (message: string): void => {
    // main.log captures renderer console output — the only way to see where a scripted step stalled.
    console.log('[a4-tour] trace ' + message)
  }
  trace('tour start')

  const stopped = (): boolean => host.isStopped()

  const capture = async (label: string, view: TourView = currentView, note?: string): Promise<void> => {
    if (stopped()) {
      failures.push('stopped before ' + label)
      return
    }
    try {
      const file = await host.capture(label)
      steps.push({ label, at: new Date().toISOString(), view, captured: file, note, snapshot: snapshot() })
      console.log('[a4-tour] step ' + label + ' -> ' + String(file))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push('capture ' + label + ': ' + message)
      steps.push({ label, at: new Date().toISOString(), view, captured: null, note: 'FAILED: ' + message, snapshot: snapshot() })
    }
  }

  const guard = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (stopped()) return
    try {
      await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(label + ': ' + message)
      trace('FAILED ' + label + ': ' + message)
    }
  }

  const go = async (view: TourView): Promise<void> => {
    await host.setView(view)
    currentView = view
  }

  const selectSiteConfig = async (): Promise<void> => {
    if (document.querySelector('[data-module-id="siteConfig"]')) {
      click(document.querySelector('[data-module-id="siteConfig"]'))
      await sleep(300)
    } else {
      await host.selectModule('siteConfig')
    }
    await waitFor('[data-testid="field-list"]', 8000)
  }

  const runInteractions = async (scope: 'live' | 'demo'): Promise<void> => {
    const enumSelector = 'select[data-field-path="themeColor.defaultMode"]'
    if (document.querySelector(enumSelector)) {
      const before = readValue(document.querySelector(enumSelector))
      // Pick a value that actually differs, so the frame shows a real state change.
      const target = before === 'dark' ? 'light' : 'dark'
      selectValue(document.querySelector(enumSelector), target)
      await sleep(250)
      interactions.push({
        scope,
        kind: 'enum',
        path: 'themeColor.defaultMode',
        before,
        after: readValue(document.querySelector(enumSelector)),
        pendingValue: pendingValueOf('siteConfig::themeColor.defaultMode'),
        note: '下拉切换（原生 change 事件），目标值与当前值不同',
      })
    }

    const boolSelector = '[data-field-path="card.border"] input.switch'
    if (document.querySelector(boolSelector)) {
      const before = readValue(document.querySelector(boolSelector))
      click(document.querySelector(boolSelector))
      await sleep(250)
      interactions.push({
        scope,
        kind: 'boolean',
        path: 'card.border',
        before,
        after: readValue(document.querySelector(boolSelector)),
        pendingValue: pendingValueOf('siteConfig::card.border'),
        note: '开关点击（0 -> 1）',
      })
    }

    const inputSelector = '[data-field-path="keywords"] [data-testid="array-input"]'
    if (document.querySelector(inputSelector)) {
      const before = textOf('[data-field-path="keywords"] .tag-list')
      setInputValue(document.querySelector(inputSelector), 'Astro 7')
      await sleep(100)
      click(document.querySelector('[data-field-path="keywords"] [data-testid="array-add"]'))
      await sleep(250)
      interactions.push({
        scope,
        kind: 'stringArray',
        path: 'keywords',
        before,
        after: textOf('[data-field-path="keywords"] .tag-list'),
        pendingValue: pendingValueOf('siteConfig::keywords'),
        note: '新增标签 "Astro 7"',
      })
    }
  }

  const previewAndApply = async (): Promise<void> => {
    await guard('preview', async () => {
      if (!(await waitForEnabled('[data-testid="preview-button"]'))) throw new Error('preview-button 始终 disabled')
      click(document.querySelector('[data-testid="preview-button"]'))
      await waitFor('[data-testid="preview-status"]', 30000)
      await sleep(300)
      click(document.querySelector('[data-testid="open-diff"]'))
      await waitFor('[data-testid="diff-view"]', 8000)
    })
    await capture('diff-preview', currentView, '保存前 diff 预览（config:preview 的返回）')

    // Close the diff dialog again: leaving it open would overlay every following frame.
    await guard('close diff', async () => {
      click(document.querySelector('[data-testid="close-diff"]'))
      await sleep(300)
      if (document.querySelector('[data-testid="diff-view"]')) throw new Error('diff 弹层没有关闭')
    })

    await guard('apply', async () => {
      if (!(await waitForEnabled('[data-testid="apply-button"]'))) throw new Error('apply-button 始终 disabled')
      click(document.querySelector('[data-testid="apply-button"]'))
      await waitFor('[data-testid="apply-result"]', 30000)
      await sleep(250)
    })
    await capture('apply-result', currentView, 'config:apply 的返回：changed / diffs，或 WriteError 列表')
  }

  const postsPhase = async (prefix: string): Promise<void> => {
    await guard('posts list ' + prefix, async () => {
      await go('posts')
      await waitFor('[data-testid="post-list"]', 15000)
      if (document.querySelector('[data-tag="Astro"]')) click(document.querySelector('[data-tag="Astro"]'))
      await sleep(300)
    })
    await capture(prefix + '-posts-list', 'posts', '文章列表：标题/日期/标签/草稿/加密标记 + 标签过滤')

    await guard('post editor ' + prefix, async () => {
      const items = Array.from(document.querySelectorAll('[data-post-id]'))
      click(items.length > 1 ? items[1] : items[0])
      await waitFor('[data-testid="post-editor"]', 15000)
      await sleep(500)
    })
    await capture(prefix + '-post-editor', 'posts', 'frontmatter 全字段表单 + 正文编辑 + 实时 Markdown 预览')
  }

  const wizardPhase = async (): Promise<void> => {
    await guard('wizard step 1', async () => {
      await go('wizard')
      await waitFor('[data-testid="wizard-step-0"]', 8000)
      setInputValue(document.querySelector('[data-testid="wz-title"]'), 'Firefly')
      setInputValue(document.querySelector('[data-testid="wz-subtitle"]'), 'Demo site')
      setInputValue(document.querySelector('[data-testid="wz-site-url"]'), 'https://example.com')
      await sleep(200)
    })
    await capture('wizard-site', 'wizard', '首次向导第一步：站点信息（默认值全部是占位符）')

    await guard('wizard step 2', async () => {
      click(document.querySelector('[data-testid="wizard-next"]'))
      await sleep(250)
      setInputValue(document.querySelector('[data-testid="wz-author"]'), 'Neko')
      setInputValue(document.querySelector('[data-testid="wz-bio"]'), '你好，这里是 Firefly Studio')
      setInputValue(document.querySelector('[data-testid="wz-social-url-0"]'), 'https://github.com/Neko')
      await sleep(200)
    })
    await capture('wizard-author', 'wizard', '首次向导第二步：作者与社交链接')

    await guard('wizard step 3', async () => {
      click(document.querySelector('[data-testid="wizard-next"]'))
      await sleep(200)
      setInputValue(document.querySelector('[data-testid="wz-theme-hue"]'), '250')
      await waitFor('[data-testid="wz-hue-preview"]', 8000)
      await sleep(250)
    })
    await capture('wizard-summary', 'wizard', '首次向导第三步：主题色相 + 将提交的 SiteIdentity')

    await guard('wizard apply', async () => {
      click(document.querySelector('[data-testid="wizard-apply"]'))
      await waitFor('[data-testid="wizard-result"]', 30000)
      // The result card (changed / WriteError list) is below the fold; scroll it into view so the
      // frame shows it rather than the form that produced it.
      scrollIntoView('[data-testid="wizard-result"]')
      await sleep(400)
    })
    await capture('wizard-result', 'wizard', 'wizard.apply 的返回：changed / diffs，或 WriteError 列表')
  }

  /* ── 1. first-run gate ── */
  await sleep(400)
  await capture('gate', 'gate', '打开 Firefly 仓库 引导页 + project:check 结果')

  /* ── 2. open a project (or the demo dataset) ── */
  await guard('open project', async () => {
    click(document.querySelector('[data-testid="pick-project"]'))
    trace('pick clicked')
    const outcome = await waitForProject(45000)
    trace('pick outcome: ' + outcome)
    if (outcome === 'opened') {
      state.phase = 'live'
      trace('project opened (live)')
      return
    }
    if (!click(document.querySelector('[data-testid="enter-demo"]'))) throw new Error('既没有打开项目，也没有演示入口')
    if (!(await appears('[data-testid="config-panel"]', 12000))) throw new Error('演示项目没有渲染出配置面板')
    state.phase = 'demo'
  })

  await guard('config form', async () => {
    await go('config')
    await selectSiteConfig()
    await sleep(300)
  })
  await capture('config-form', 'config', '25 模块导航 + siteConfig 全字段类型表单（含 help 文本与只读字段）')

  await guard('interactions', async () => {
    await runInteractions(state.phase === 'live' ? 'live' : 'demo')
  })
  pendingAfterInteractions = pendingEdits()
  await capture('config-interactions', 'config', 'enum / boolean / stringArray 三种控件交互后的待保存改动')

  await guard('readonly field', async () => {
    let target = document.querySelector('[data-readonly="true"]')
    if (!target) {
      // Real projects may keep read-only (computed) fields in a different module than the showcase one.
      const info = host.describe() as { readOnlyModules?: string[] }
      const candidate = info.readOnlyModules?.[0]
      if (candidate) {
        await host.selectModule(candidate)
        await sleep(350)
        target = document.querySelector('[data-readonly="true"]')
      }
    }
    const path = target?.getAttribute('data-field-path')
    if (path) scrollIntoView('[data-field-path="' + path + '"]')
    await sleep(350)
  })
  await capture('config-readonly', 'config', '只读字段（unknown / computed）与只读原因')

  await previewAndApply()

  await postsPhase(state.phase === 'live' ? 'live' : 'demo')
  await wizardPhase()

  /* ── 3. if the run started on demo data, also open the real repository and re-check the write path ── */
  if (state.phase === 'demo' && !stopped()) {
    trace('second phase: open the scripted repository')
    const opened = await (async () => {
      await go('gate')
      await sleep(300)
      click(document.querySelector('[data-testid="pick-project"]'))
      return (await waitForProject(30000)) === 'opened'
    })()
    if (opened) {
      state.phase = 'live'
      await guard('live config form', async () => {
        await go('config')
        await selectSiteConfig()
        await sleep(300)
      })
      await capture('live-config-form', 'config', '真实 Firefly 仓库：core 解析出的模块表单')
      await guard('live interactions', async () => {
        await runInteractions('live')
      })
      pendingAfterInteractions = pendingEdits()
      await previewAndApply()
      await postsPhase('live')
    } else {
      failures.push('二次打开真实仓库失败（pick 未返回 root）')
    }
  }

  /* ── 4. report ── */
  let probe: Record<string, unknown> = {}
  await guard('schema probe', async () => {
    probe = await host.probe()
  })
  const report = {
    generatedAt: new Date().toISOString(),
    tour: 'a4-renderer-evidence',
    phase: state.phase,
    describe: host.describe(),
    probe,
    steps,
    interactions,
    pendingAfterInteractions,
    finalSnapshot: snapshot(),
    failures,
    domTextLength: document.body.innerText.length,
  }

  try {
    const file = await host.dump(report)
    console.log('[a4-tour] report written: ' + String(file))
  } catch (error) {
    console.error('[a4-tour] dump failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  await nextFrame()
}
