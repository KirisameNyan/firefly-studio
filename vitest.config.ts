import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Shared vitest config (project root). Kept permissive on purpose: A1/A2 test files under
 * `src/core/**` are picked up by the same run, and the `@shared` / `@core` aliases mirror the ones
 * in electron.vite.config.ts so nobody has to use relative climbs in tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
  },
})
