/**
 * Application shell.
 *
 * Views: 项目引导 (gate) / 配置 (config) / 文章 (posts) / 向导 (wizard).
 * All data access goes through `window.studio` — this component never imports src/core/**.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JsonValue, ProjectCheck, VerifyResult, WriteResult } from '@shared/contract'
import type { StudioApi } from '../../preload/api'
import ConfigPanel from './components/ConfigPanel'
import DiffView from './components/DiffView'
import ModuleNav from './components/ModuleNav'
import PostsPanel from './components/PostsPanel'
import ProjectGate from './components/ProjectGate'
import SaveBar from './components/SaveBar'
import WizardPanel from './components/WizardPanel'
import { errorMessage } from './data/normalize'
import {
  applyEdits,
  createDemoSource,
  draftCount,
  draftKey,
  draftsToEdits,
  loadProject,
  parseDraftKey,
  previewEdits,
  type DataSource,
  type PreviewOutcome,
} from './data/source'
import { nextFrame, sleep } from './lib/dom'
import { runEvidenceTour, type TourHost, type TourView } from './lib/evidenceTour'
import { collectFieldKinds, countReadOnly, flattenFields, getValueAtPath, groupModules, kindLabel } from './lib/fields'

const VIEWS: Array<{ id: TourView; label: string }> = [
  { id: 'gate', label: '项目' },
  { id: 'config', label: '配置' },
  { id: 'posts', label: '文章' },
  { id: 'wizard', label: '首次向导' },
]

export default function App() {
  const api = useMemo<StudioApi | null>(() => (typeof window !== 'undefined' ? (window.studio ?? null) : null), [])

  const [check, setCheck] = useState<ProjectCheck | null>(null)
  const [source, setSource] = useState<DataSource | null>(null)
  const [view, setView] = useState<TourView>('gate')
  const [busy, setBusy] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [rootInput, setRootInput] = useState('')
  const [banner, setBanner] = useState<string | null>(null)

  const [drafts, setDrafts] = useState<Record<string, JsonValue>>({})
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
  const [moduleQuery, setModuleQuery] = useState('')
  const [busyAction, setBusyAction] = useState<'idle' | 'preview' | 'apply'>('idle')
  const [previewOutcome, setPreviewOutcome] = useState<PreviewOutcome | null>(null)
  const [applyResult, setApplyResult] = useState<WriteResult | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [tourActive, setTourActive] = useState(false)

  const sourceRef = useRef<DataSource | null>(null)
  const lastRootRef = useRef<string>('')
  const draftsRef = useRef<Record<string, JsonValue>>({})
  const tourRunning = useRef(false)
  const tourStop = useRef(false)
  const autoTourStarted = useRef(false)

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  const boot = useCallback(
    async (root: string): Promise<void> => {
      if (!api) return
      setBusy(true)
      setBootError(null)
      setBanner(null)
      lastRootRef.current = root
      try {
        const loaded = await loadProject(api, root)
        sourceRef.current = loaded
        setSource(loaded)
        setCheck(loaded.check)
        setDrafts({})
        setPreviewOutcome(null)
        setApplyResult(null)
        setActiveModuleId(loaded.modules[0]?.id ?? null)
        setView(loaded.origin === 'demo' ? 'gate' : loaded.check.isFirefly ? 'config' : 'gate')
      } catch (error) {
        setBootError('读取项目失败：' + errorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [api],
  )

  useEffect(() => {
    void boot('')
  }, [boot])

  const startTour = useCallback(async (): Promise<void> => {
    if (!api || tourRunning.current || !sourceRef.current) return
    tourRunning.current = true
    tourStop.current = false
    setTourActive(true)
    const host: TourHost = {
      isStopped: () => tourStop.current,
      setView: async (next) => {
        setView(next)
        await nextFrame()
        await sleep(150)
      },
      selectModule: async (id) => {
        setActiveModuleId(id)
        await nextFrame()
        await sleep(150)
      },
      capture: async (label) => {
        await nextFrame()
        await sleep(900)
        // capturePage() occasionally never settles (Wayland + software rasterizer), so every attempt
        // is raced against a deadline and retried once. A failed frame must not stall the tour.
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          let timer: ReturnType<typeof setTimeout> | null = null
          const deadline = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 10000)
          })
          const file = await Promise.race([api.debug.capture(), deadline])
          if (timer) clearTimeout(timer)
          if (file) {
            console.log('[a4-tour] capture ' + label + ' -> ' + String(file) + ' (attempt ' + attempt + ')')
            return file
          }
          console.warn('[a4-tour] capture attempt ' + attempt + ' returned nothing for ' + label)
          await sleep(700)
        }
        return null
      },
      describe: () => {
        const current = sourceRef.current
        if (!current) return { origin: 'none' }
        const groups = groupModules(current.modules)
        return {
          origin: current.origin,
          root: current.root,
          isFirefly: current.check.isFirefly,
          fireflyVersion: current.check.fireflyVersion ?? null,
          problems: current.check.problems,
          moduleCount: current.modules.length,
          moduleIds: current.modules.map((module) => module.id),
          readOnlyModules: current.modules
            .filter((module) => countReadOnly(module.fields) > 0)
            .map((module) => module.id),
          groupCounts: Object.fromEntries(groups.map((group) => [group.group, group.modules.length])),
          fieldKinds: [...collectFieldKinds(current.modules.flatMap((module) => module.fields))].map(kindLabel).sort(),
          nodeCount: current.modules.reduce((total, module) => total + flattenFields(module.fields).length, 0),
          postCount: current.posts.length,
          draftCount: Object.keys(draftsRef.current).length,
          warnings: current.warnings,
          notes: current.notes,
        }
      },
      probe: async () => {
        const current = sourceRef.current
        const result: Record<string, unknown> = {
          rootPassedToBoot: lastRootRef.current,
          appRoot: current?.root ?? null,
          origin: current?.origin ?? null,
          checkRoot: current?.check.root ?? null,
        }
        if (!current || current.origin !== 'live') return result
        result.schemaGetRequest = { root: current.root, moduleId: 'profileConfig' }
        try {
          const modules = await api.schema.get(current.root, 'profileConfig')
          result.schemaGetModuleCount = Array.isArray(modules) ? modules.length : null
          const module = Array.isArray(modules) ? modules[0] : undefined
          result.moduleId = module?.id ?? null
          result.moduleFile = module?.file ?? null
          const links = module?.fields?.find((field) => field.key === 'links')
          result.linksNode = links
            ? {
                path: links.path,
                key: links.key,
                kind: links.kind,
                origin: links.origin,
                readOnly: links.readOnly,
                optional: links.optional,
                loc: links.loc ?? null,
                tsType: links.tsType ?? null,
                elementKind: links.element?.kind ?? null,
                elementOrigin: links.element?.origin ?? null,
                elementReadOnly: links.element?.readOnly ?? null,
                elementChildKeys: (links.element?.children ?? []).map((child) => child.key),
                valueLength: Array.isArray(links.value) ? links.value.length : null,
              }
            : null
        } catch (error) {
          result.schemaGetError = errorMessage(error)
        }
        return result
      },
      dump: (report) => api.debug.dump(report),
    }
    try {
      await runEvidenceTour(host)
    } catch (error) {
      console.error('[a4-tour] tour failed: ' + errorMessage(error))
    } finally {
      tourRunning.current = false
      setTourActive(false)
    }
  }, [api])

  // First-run onboarding: with no project open there is nothing useful on screen, so the guided
  // tour runs once per session. It is interruptible (any key or the 跳过 button) and it is also the
  // deterministic driver used to capture the acceptance frames.
  useEffect(() => {
    if (!source || autoTourStarted.current) return
    if (source.origin !== 'demo' && source.modules.length > 0) return
    autoTourStarted.current = true
    void startTour()
  }, [source, startTour])

  useEffect(() => {
    const stop = (): void => {
      tourStop.current = true
    }
    window.addEventListener('keydown', stop)
    return () => window.removeEventListener('keydown', stop)
  }, [])

  const enterDemo = useCallback((): void => {
    const demo = createDemoSource(check, ['已手动切换到内置演示数据：不读取任何仓库，写入会由后端拒绝。'])
    sourceRef.current = demo
    setSource(demo)
    setDrafts({})
    setPreviewOutcome(null)
    setApplyResult(null)
    setActiveModuleId(demo.modules[0]?.id ?? null)
    setView('config')
  }, [check])

  const changeField = useCallback(
    (moduleId: string, path: string, value: JsonValue): void => {
      setDrafts((previous) => {
        const module = sourceRef.current?.modules.find((candidate) => candidate.id === moduleId)
        const original = module ? getValueAtPath(module.fields, path) : undefined
        const key = draftKey(moduleId, path)
        const next = { ...previous }
        if (JSON.stringify(original) === JSON.stringify(value)) delete next[key]
        else next[key] = value
        return next
      })
      setPreviewOutcome(null)
      setApplyResult(null)
    },
    [],
  )

  const revertField = useCallback((key: string): void => {
    setDrafts((previous) => {
      const next = { ...previous }
      delete next[key]
      return next
    })
    setPreviewOutcome(null)
    setApplyResult(null)
  }, [])

  const revertModule = useCallback((moduleId: string): void => {
    setDrafts((previous) => {
      const next: Record<string, JsonValue> = {}
      for (const [key, value] of Object.entries(previous)) {
        if (parseDraftKey(key).moduleId !== moduleId) next[key] = value
      }
      return next
    })
    setPreviewOutcome(null)
    setApplyResult(null)
  }, [])

  const runPreview = useCallback(async (): Promise<void> => {
    const current = sourceRef.current
    if (!api || !current) return
    setBusyAction('preview')
    setBanner(null)
    try {
      const { edits, dropped } = draftsToEdits(draftsRef.current, current.modules)
      const outcome = await previewEdits(api, current, edits)
      setPreviewOutcome(outcome)
      setShowDiff(true)
      if (dropped.length) {
        setBanner('有 ' + dropped.length + ' 处改动被忽略：' + dropped.map((item) => item.path + '（' + item.message + '）').join('；'))
      }
    } catch (error) {
      setBanner('预览失败：' + errorMessage(error))
    } finally {
      setBusyAction('idle')
    }
  }, [api])

  const runApply = useCallback(async (): Promise<void> => {
    const current = sourceRef.current
    if (!api || !current) return
    setBusyAction('apply')
    setBanner(null)
    try {
      const { edits, dropped } = draftsToEdits(draftsRef.current, current.modules)
      const result = await applyEdits(api, current, edits)
      setApplyResult(result)
      if (result.ok) {
        setDrafts({})
        setPreviewOutcome(null)
      } else if (dropped.length) {
        setBanner('另有 ' + dropped.length + ' 处改动未提交。')
      }
    } catch (error) {
      setApplyResult({ ok: false, changed: [], diffs: [], errors: [{ path: '', message: errorMessage(error) }] })
    } finally {
      setBusyAction('idle')
    }
  }, [api])

  const runVerify = useCallback(async (): Promise<void> => {
    const current = sourceRef.current
    if (!api || !current) return
    setVerifyBusy(true)
    try {
      setVerify(await api.verify.run(current.root))
    } catch (error) {
      setVerify({ typeCheck: { ok: false, output: errorMessage(error) }, durationMs: 0 })
    } finally {
      setVerifyBusy(false)
    }
  }, [api])

  const pickAndOpen = useCallback(async (): Promise<void> => {
    if (!api) return
    try {
      const picked = await api.project.pick()
      if (picked?.canceled || !picked?.root) {
        setBanner('已取消目录选择（project:pick 返回 canceled=true）。')
        return
      }
      setRootInput(picked.root)
      await boot(picked.root)
    } catch (error) {
      setBootError('选择目录失败：' + errorMessage(error))
    }
  }, [api, boot])

  if (!api) {
    return (
      <div className="app">
        <section className="panel">
          <h1 className="panel-title">window.studio 未注入</h1>
          <p className="muted">
            preload 没有加载成功，渲染进程在 contextIsolation 沙箱里拿不到数据。请检查 out/preload/index.cjs 与主进程日志。
          </p>
        </section>
      </div>
    )
  }

  const notes = [...(source?.notes ?? []), ...(source?.warnings ?? []), ...(bootError ? [bootError] : [])]

  return (
    <div className="app" data-view={view} data-origin={source?.origin ?? 'none'}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🔥</span>
          <div className="brand-text">
            <h1>Firefly Studio</h1>
            <p>配置模块 · 文章管理 · 首次向导 · 保存前 diff 预览</p>
          </div>
        </div>

        <div className="topbar-meta" data-testid="origin-badge">
          {source &&
            (source.origin === 'demo' ? (
              <span className="chip chip-demo" data-testid="demo-badge" title="后端为 A3 桩数据，当前使用内置演示数据">
                演示数据
              </span>
            ) : (
              <span className="chip chip-ok">真实数据</span>
            ))}
          {check && <span className="chip chip-muted">isFirefly: {String(check.isFirefly)}</span>}
          {check?.fireflyVersion && <span className="chip chip-muted">v{check.fireflyVersion}</span>}
          {check?.root && (
            <code className="root-path" title={check.root}>
              {check.root}
            </code>
          )}
        </div>

        <nav className="tabs" data-testid="view-tabs">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={'tab' + (view === item.id ? ' is-active' : '')}
              data-view={item.id}
              disabled={item.id !== 'gate' && (!source || source.modules.length === 0)}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost" data-testid="reload" disabled={busy} onClick={() => void boot(rootInput)}>
            {busy ? '读取中…' : '重新载入'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="run-verify"
            disabled={!source || verifyBusy}
            onClick={() => void runVerify()}
          >
            {verifyBusy ? '校验中…' : '运行校验'}
          </button>
          {source?.origin === 'demo' && (
            <button type="button" className="btn btn-ghost" data-testid="run-tour" onClick={() => void startTour()}>
              演示导览
            </button>
          )}
        </div>
      </header>

      {(notes.length > 0 || banner || tourActive) && (
        <div className="banners" data-testid="banners">
          {tourActive && (
            <div className="notice notice-warn tour-banner" data-testid="tour-banner">
              首次运行导览进行中：正在依次演示 配置表单 → 保存前 diff → 文章 → 首次向导。
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="tour-skip"
                onClick={() => {
                  tourStop.current = true
                }}
              >
                跳过导览
              </button>
            </div>
          )}
          {banner && <div className="notice notice-warn">{banner}</div>}
          {source?.origin === 'demo' && (
            <div className="notice notice-warn" data-testid="demo-notice">
              <strong>演示数据</strong>：后端仍为 A3 桩实现（project:check 的 problems 含 "stub:"）。
              配置表单、文章与向导都可用；写入类操作会返回 ok:false，界面会原样显示 WriteError。
            </div>
          )}
          {notes.map((note, index) => (
            <div className="notice" key={index}>
              {note}
            </div>
          ))}
        </div>
      )}

      {verify && (
        <pre className="verify-output" data-testid="verify-output">
          {'verify:run -> typeCheck.ok=' + String(verify.typeCheck.ok) + ' (' + verify.durationMs + 'ms)\n' + verify.typeCheck.output}
        </pre>
      )}

      <main className="main">
        {view === 'gate' && (
          <ProjectGate
            check={check}
            root={rootInput}
            onRootChange={setRootInput}
            onPick={() => void pickAndOpen()}
            onOpen={() => void boot(rootInput)}
            onEnterDemo={enterDemo}
            demoAvailable
            busy={busy}
            error={bootError}
            notes={source?.notes ?? []}
          />
        )}

        {view === 'config' && source && source.modules.length > 0 && (
          <div className="config-layout">
            <ModuleNav
              modules={source.modules}
              activeId={activeModuleId}
              onSelect={setActiveModuleId}
              query={moduleQuery}
              onQuery={setModuleQuery}
              draftCountOf={(moduleId) => draftCount(drafts, moduleId)}
            />
            <ConfigPanel
              modules={source.modules}
              drafts={drafts}
              activeModuleId={activeModuleId}
              onSelectModule={setActiveModuleId}
              onChange={changeField}
              onRevertModule={revertModule}
            />
          </div>
        )}

        {view === 'config' && source && source.modules.length === 0 && (
          <section className="panel">
            <p className="muted">当前项目没有解析出配置模块：请检查 src/config 是否存在。</p>
          </section>
        )}

        {view === 'posts' && source && <PostsPanel api={api} source={source} />}
        {view === 'wizard' && source && <WizardPanel api={api} source={source} />}
      </main>

      {view === 'config' && source && source.modules.length > 0 && (
        <SaveBar
          drafts={drafts}
          modules={source.modules}
          busy={busyAction}
          previewOutcome={previewOutcome}
          applyResult={applyResult}
          onRevert={revertField}
          onRevertAll={() => {
            setDrafts({})
            setPreviewOutcome(null)
            setApplyResult(null)
          }}
          onPreview={() => void runPreview()}
          onApply={() => void runApply()}
          onOpenDiff={() => setShowDiff(true)}
        />
      )}

      {showDiff && previewOutcome && (
        <div
          className="modal"
          data-testid="diff-modal"
          role="dialog"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowDiff(false)
          }}
        >
          <div className="modal-card">
            <header className="modal-head">
              <strong>改动预览（{previewOutcome.result.diffs.length} 个文件）</strong>
              <button type="button" className="btn btn-ghost" data-testid="close-diff" onClick={() => setShowDiff(false)}>
                关闭
              </button>
            </header>
            <DiffView diffs={previewOutcome.result.diffs} view={previewOutcome.view} refusal={previewOutcome.refusal} />
          </div>
        </div>
      )}
    </div>
  )
}
