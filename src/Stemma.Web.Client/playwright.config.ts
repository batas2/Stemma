import { defineConfig, devices } from '@playwright/test';

// Q128: visual regression harness. Tests boot Vite via webServer, take
// screenshots of canonical surfaces (empty state, sidebar, canvas, notes
// modal), and diff against checked-in baselines. Update baselines with
// `npx playwright test --update-snapshots`.
export default defineConfig({
  testDir: './tests/visual',
  timeout: 30_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
