import { test, expect } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The presenter's console (F-019): opened from a presentation, it shows what to say and what comes
 * next, turns the pages of the window on the projector, and knows when the presentation has ended.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let root: string;

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-console-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

test('the console follows the presentation, turns its pages, and ends it', async ({ page, context }) => {
  // Present the sample's first book from the palette.
  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('present book stemma in ten');
  await page.keyboard.press('Enter');
  const projector = page.getByRole('navigation', { name: 'Presentation' });
  await expect(projector).toContainText('1 /');

  // P opens the console in another window.
  const [consoleWindow] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('p')]);
  await consoleWindow.waitForLoadState();
  const now = consoleWindow.getByRole('region', { name: 'Now' });
  await expect(now).toContainText(/Now · 1 of \d+/, { timeout: 20_000 });
  await expect(consoleWindow.getByRole('region', { name: 'Next' })).not.toContainText('This is the last page');

  // The words are on the console now; the projector shows the picture alone.
  await expect(page.locator('[data-book-narrative]')).toHaveCount(0);

  // Next on the console turns the projector's page, and the keys work there too.
  await consoleWindow.getByRole('button', { name: /^Next/ }).click();
  await expect(projector).toContainText('2 /');
  await expect(now).toContainText(/Now · 2 of/);
  await consoleWindow.keyboard.press('ArrowLeft');
  await expect(projector).toContainText('1 /');

  // A page chosen from the list.
  await consoleWindow.getByRole('list', { name: 'Pages' }).getByRole('button').nth(2).click();
  await expect(projector).toContainText('3 /');

  await consoleWindow.getByRole('button', { name: /^End/ }).click();
  await expect(projector).toHaveCount(0);
  await expect(consoleWindow.getByText('The presentation has ended')).toBeVisible();
});
