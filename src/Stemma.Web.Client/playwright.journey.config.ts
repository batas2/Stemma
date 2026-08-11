import { defineConfig, devices } from '@playwright/test';

/**
 * The journey harness (F-003), separate from the visual one on purpose.
 *
 * A visual test only needs the front end, so `playwright.config.ts` boots Vite and nothing else. A
 * journey test needs the engine: it creates a workspace on disk, applies real operations, and reads
 * back the C# they wrote. So this one runs the *production* server, which serves the built SPA and
 * the API from a single origin — the same shape a packaged Stemma runs in.
 *
 *   npx playwright test --config playwright.journey.config.ts
 *
 * Point it at a server you already have running with STEMMA_BASE_URL, which skips the build.
 */
const external = process.env.STEMMA_BASE_URL;
const PORT = 5188;

export default defineConfig({
  testDir: './tests/journey',
  // The first run builds the front end and restores the backend; neither is quick.
  timeout: 120_000,
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  // The installed Chrome rather than Playwright's own build, which is the same choice
  // `stemma render` makes (`Channel = "chrome"`): Playwright ships browsers per distribution and
  // stops resolving one the moment the machine is newer than the version pinned here.
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  ...(external ? {} : {
    webServer: {
      command: `npm run build && ASPNETCORE_URLS=http://127.0.0.1:${PORT} dotnet run --project ../Stemma.Web -c Release --no-launch-profile`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  }),
});
