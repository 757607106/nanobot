import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const uiPort = Number(process.env.NANOBOT_E2E_UI_PORT || '4173')
const runtimeDir = path.resolve(dirname, '../tmp/web-e2e-runtime')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 ../tests/web_e2e_server.py',
    url: `http://127.0.0.1:${uiPort}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      NANOBOT_E2E_API_HOST: '127.0.0.1',
      NANOBOT_E2E_API_PORT: String(uiPort),
      NANOBOT_E2E_RUNTIME_DIR: runtimeDir,
      NANOBOT_E2E_BUILD_FRONTEND: '1',
    },
  },
})
