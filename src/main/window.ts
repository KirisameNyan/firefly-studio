/** A3 — the single BrowserWindow factory (security defaults live here). */
import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { Logger } from './logger'

/** Must match `build.lib.fileName` + the cjs extension emitted by electron.vite.config.ts. */
export const PRELOAD_FILENAME = 'index.cjs'

export type CreateWindowOptions = { offscreen: boolean; logger: Logger }

export function createMainWindow({ offscreen, logger }: CreateWindowOptions): BrowserWindow {
  const preload = path.join(import.meta.dirname, '..', 'preload', PRELOAD_FILENAME)
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    title: 'Firefly Studio',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      ...(offscreen ? { offscreen: true } : {}),
    },
  })

  if (offscreen) {
    // With --ozone-platform=headless the initial window is clamped to 1x1, which would make
    // capturePage() return a 1x1 bitmap. Force a real surface before the first paint.
    win.setBounds({ x: 0, y: 0, width: 1180, height: 760 })
    win.setContentSize(1180, 760)
  }

  logger.log(`[window] created id=${win.id} preload=${preload} offscreen=${offscreen} bounds=${JSON.stringify(win.getBounds())}`)

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    logger.log(`[window] blocked navigation to ${url}`)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logger.log(`[window] did-fail-load code=${code} desc=${description} url=${url}`)
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.log(`[window] preload-error ${preloadPath}: ${error.message}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.log(`[window] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  // Single-argument form on purpose: passing the deprecated `level/message/line/sourceId`
  // parameters makes Electron emit a deprecation warning on every console message.
  win.webContents.on('console-message', (details) => {
    logger.log(
      `[renderer:console] ${details.message} level=${details.level} ${details.sourceId}:${details.lineNumber}`,
    )
  })
  win.once('ready-to-show', () => {
    if (!offscreen) win.show()
    logger.log(`[window] ready-to-show visible=${win.isVisible()}`)
  })
  if (!offscreen) {
    // In this sandbox the GPU process is unstable and ready-to-show sometimes never fires (no
    // composited frame). Without a shown window capturePage() then fails with UnknownVizError.
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!win.isVisible()) {
          win.show()
          logger.log('[window] forced show() 400ms after did-finish-load (ready-to-show never fired)')
        }
      }, 400)
    })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    logger.log(`[window] loadURL ${rendererUrl}`)
    void win.loadURL(rendererUrl)
  } else {
    const indexHtml = path.join(import.meta.dirname, '..', 'renderer', 'index.html')
    logger.log(`[window] loadFile ${indexHtml}`)
    void win.loadFile(indexHtml)
  }
  return win
}
