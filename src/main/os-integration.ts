/** A3 — the only main-process file that talks to native dialogs / the OS shell. */
import { BrowserWindow, dialog, shell } from 'electron'
import type { ProjectPickResult, RevealResult } from './ipc/protocol'

export async function pickProjectViaDialog(): Promise<ProjectPickResult> {
  const scripted = process.env.STUDIO_STUB_PROJECT
  if (scripted) return { root: scripted, canceled: false }
  // Headless/CI runs must never block on a native dialog.
  if (process.env.STUDIO_NO_DIALOG === '1') return { root: null, canceled: true }
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const options = { title: '选择 Firefly 仓库根目录', properties: ['openDirectory' as const] }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  const root = result.filePaths[0] ?? null
  return { root: result.canceled ? null : root, canceled: result.canceled || !root }
}

export async function revealInFolder(target: string): Promise<RevealResult> {
  if (!target) return { revealed: false, path: target, reason: 'stub: empty path' }
  shell.showItemInFolder(target)
  return { revealed: true, path: target }
}
