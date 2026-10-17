import { defineConfig, devices } from '@playwright/test';
import journeys from './playwright.journey.config';

/**
 * The under-a-minute demo (commercialization plan, Phase 0 item 5): a canvas edit, the `git diff`
 * it made, and the report it shares as — recorded from the real app rather than screen-captured,
 * so it can be made again for every release and always shows what that release does.
 *
 *   npm run demo:record
 *     → ../../dist/demo/stemma-demo.mp4 and .webm (needs ffmpeg on PATH; see tests/demo/screencast.ts)
 *
 * The same production server as the journeys; not part of any test run.
 */
export default defineConfig({
  ...journeys,
  testDir: './tests/demo',
  timeout: 240_000,
  outputDir: 'test-results/demo',
  projects: [{
    name: 'chrome',
    use: {
      ...devices['Desktop Chrome'],
      channel: 'chrome',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  }],
});
