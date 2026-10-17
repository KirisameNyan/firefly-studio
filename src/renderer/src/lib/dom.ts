/**
 * DOM helpers used by the scripted evidence tour (lib/evidenceTour.ts).
 *
 * The tour drives the *real* controls — native value setter + input/change events — so the recorded
 * before/after values prove the React handlers and the pending-edit pipeline actually work.
 */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 16)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function qs<T extends Element = Element>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

/** Wait until a selector exists (React paint), or throw after `timeout` ms. */
export async function waitFor<T extends Element = Element>(selector: string, timeout = 4000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const found = document.querySelector<T>(selector)
    if (found) return found
    if (Date.now() > deadline) throw new Error('tour: selector not found: ' + selector)
    await sleep(50)
  }
}

export function click(element: Element | null): boolean {
  if (!element) return false
  ;(element as HTMLElement).click()
  return true
}

function nativeSet(element: Element, value: string): void {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(element, value)
}

/** Set a controlled input/textarea and let React observe it. */
export function setInputValue(element: Element | null, value: string): boolean {
  if (!element) return false
  nativeSet(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

export function selectValue(element: Element | null, value: string): boolean {
  if (!element) return false
  nativeSet(element, value)
  element.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

export function readValue(element: Element | null): string | null {
  if (!element) return null
  if (element instanceof HTMLInputElement && element.type === 'checkbox') return String(element.checked)
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return element.value
  }
  return null
}

export function scrollIntoView(selector: string): boolean {
  const element = document.querySelector(selector)
  if (!element) return false
  element.scrollIntoView({ block: 'center' })
  return true
}
