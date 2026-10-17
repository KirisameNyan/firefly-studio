import type { StudioApi } from '../../preload/api'

declare global {
  interface Window {
    /** Injected by src/preload/index.ts via contextBridge. */
    studio: StudioApi
  }
}

export {}
