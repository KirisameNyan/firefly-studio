import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * A3 — three-process build (main / preload / renderer).
 *
 * Entries follow the electron-vite convention and are auto-discovered:
 *   src/main/index.ts, src/preload/index.ts, src/renderer/index.html
 *
 * preload is emitted as CommonJS (`out/preload/index.cjs`) on purpose: an ESM preload would force
 * `sandbox: false`, while the CJS bundle keeps `sandbox: true` + `contextIsolation: true`.
 *
 * main externalizes runtime dependencies on purpose. With `typescript` inlined, the main-process
 * bundle built its own TS host and the schema engine classified `profileConfig.links` as read-only,
 * so the first-run wizard failed with 「字段只读」 in the built app only. `typescript` is therefore a
 * runtime dependency (see package.json), not a devDependency.
 */
const alias = {
  '@shared': resolve('src/shared'),
  '@core': resolve('src/core'),
}

export default defineConfig({
  main: {
    // Externalize runtime deps: `typescript` must be require()d from node_modules, not inlined.
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { outDir: 'out/main' },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      // Sandboxed preloads cannot require() third-party modules: bundle everything.
      externalizeDeps: false,
      lib: { entry: resolve('src/preload/index.ts'), fileName: 'index', formats: ['cjs'] },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: { outDir: 'out/renderer' },
  },
})
