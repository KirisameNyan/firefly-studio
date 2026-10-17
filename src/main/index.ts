/**
 * A3 — Electron main process entry.
 *
 * Boot order: evidence/logger → contract channel registration → window → renderer driven demo.
 * Everything the harness needs to verify is written to STUDIO_EVIDENCE_DIR (default: ./.studio-evidence).
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { IPC } from '../shared/contract'
import { createCoreHandlers } from './core-bridge'
import { EvidenceRecorder } from './evidence'
import { DEBUG_IPC } from './ipc/protocol'
import { registerIpcHandlers } from './ipc/register'
import { createLogger } from './logger'
import { createMainWindow } from './window'

const evidenceDir = process.env.STUDIO_EVIDENCE_DIR ?? path.join(process.cwd(), '.studio-evidence')
const logger = createLogger(path.join(evidenceDir, 'main.log'))
const evidence = new EvidenceRecorder(evidenceDir)

const offscreen = process.env.STUDIO_OFFSCREEN === '1'
const autocloseMs = Number(process.env.STUDIO_AUTOCLOSE_MS ?? '0')

if (offscreen) {
  // Offscreen fallback for sandboxes where connecting to the Wayland socket is denied.
  app.commandLine.appendSwitch('headless')
  app.commandLine.appendSwitch('ozone-platform', 'headless')
}
// The GPU process dies with exit_code=139 in this sandbox (no DRM render node), which makes
// webContents.capturePage() fail with UnknownVizError. Software rasterization fixes the capture.
if (offscreen || process.env.STUDIO_DISABLE_GPU === '1') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

async function captureWindow(win: BrowserWindow, reason: string): Promise<string | null> {
  // UnknownVizError means "no composited frame yet" — retry instead of giving up on the evidence.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const image = await win.webContents.capturePage()
      const file = evidence.writeBinary('window.png', image.toPNG())
      const size = image.getSize()
      logger.log(
        `[capture] ${reason} -> ${file} ${size.width}x${size.height} visible=${win.isVisible()} attempt=${attempt}`,
      )
      return file
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.log(`[capture] ${reason} attempt=${attempt} FAILED: ${message}`)
      if (attempt === 3) return null
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
  }
  return null
}

async function captureDomText(win: BrowserWindow): Promise<void> {
  try {
    const text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
    const file = evidence.writeJson('renderer-dom.json', { text })
    logger.log(`[renderer] painted DOM text (${text.length} chars) -> ${file}`)
  } catch (error) {
    logger.log(`[renderer] DOM read FAILED: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function scheduleAutoclose(reason: string): void {
  if (!autocloseMs) return
  logger.log(`[shutdown] autoclose in ${autocloseMs}ms (${reason})`)
  setTimeout(() => app.quit(), autocloseMs)
}

function registerDebugChannels(win: BrowserWindow): void {
  ipcMain.handle(DEBUG_IPC.dump, async (_event, report: unknown) => {
    const file = evidence.writeJson('renderer-report.json', report)
    logger.log(`[renderer] report received -> ${file}`)
    await captureDomText(win)
    scheduleAutoclose('renderer report received')
    setTimeout(() => void captureWindow(win, 'after renderer report'), 250)
    return file
  })
  ipcMain.handle(DEBUG_IPC.capture, async () => captureWindow(win, 'renderer requested capture'))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    logger.log(`[shutdown] ${evidence.records.length} ipc round trips -> ${evidence.flush()}`)
  } catch (error) {
    logger.log(`[shutdown] evidence flush failed: ${error instanceof Error ? error.message : String(error)}`)
  }
})

app
  .whenReady()
  .then(() => {
    logger.log(
      `[boot] electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} platform=${process.platform}`,
    )
    logger.log(
      `[boot] argv=${process.argv.slice(1).join(' ')} offscreen=${offscreen} evidenceDir=${evidenceDir} XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR ?? '(unset)'} WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? '(unset)'}`,
    )

    const channels = registerIpcHandlers(createCoreHandlers(), { logger, evidence })
    logger.log(`[ipc] registered ${channels.length}/${Object.keys(IPC).length} contract channels: ${channels.join(', ')}`)

    const win = createMainWindow({ offscreen, logger })
    registerDebugChannels(win)
    win.webContents.once('did-finish-load', () => logger.log('[window] did-finish-load'))

    if (autocloseMs > 0) {
      // Last-resort watchdog: a run must always terminate even if the renderer never reports.
      setTimeout(() => {
        logger.log('[shutdown] watchdog fired (renderer never reported)')
        void captureWindow(win, 'watchdog').then(() => setTimeout(() => app.quit(), 300))
      }, autocloseMs * 3)
    }
  })
  .catch((error: unknown) => {
    logger.log(`[fatal] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    app.exit(1)
  })
