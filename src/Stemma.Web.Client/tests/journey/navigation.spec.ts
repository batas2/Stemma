import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Going anywhere (F-016), on a scratch copy of the self-model: an element found by name is shown on
 * a view that draws it, even when that is not the view on screen, and Back returns to where you were.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let root: string;

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-nav-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: false });

test('an element only a view draws is found from the Module Map, and Back returns to the map', async ({ page }) => {
  await expect(tab(page, 'Module Map')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('No second store');
  await page.keyboard.press('Enter');

  // A Concept is drawn only by the views that name it, so the view that does is opened.
  await expect(tab(page, 'Three rules that win arguments')).toHaveAttribute('aria-selected', 'true');
  const card = page.locator('.react-flow__node', { hasText: 'No second store, ever' });
  await expect(card).toHaveClass(/selected/);
  await expect(page.getByText(/Showing No second store, ever in Three rules/)).toBeVisible();
  // The address keeps the place, for a reload.
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('select=con_onestore');

  await page.keyboard.press(`${mod}+BracketLeft`);
  await expect(tab(page, 'Module Map')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press(`${mod}+BracketRight`);
  await expect(tab(page, 'Three rules that win arguments')).toHaveAttribute('aria-selected', 'true');
});

test('the palette lists every view, and the inspector says where an element appears', async ({ page }) => {
  await page.keyboard.press(`${mod}+k`);
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option', { name: /Concerns/ })).toBeVisible();
  await expect(list.getByRole('option', { name: /Three rules that win arguments/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('.react-flow__node', { hasText: 'DslWriter' }).first().click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const appears = page.getByLabel('Views that draw it');
  await expect(appears.locator('[aria-current="page"]')).toHaveText('Module Map');
  await appears.getByRole('button', { name: 'Dependencies' }).click();
  await expect(tab(page, 'Dependencies')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.react-flow__node', { hasText: 'DslWriter' }).first()).toHaveClass(/selected/);
});

test('a reload comes back to the view and the element in the address', async ({ page }) => {
  // A hash change alone is not a reload; set it, then load the page again.
  await page.evaluate(() => { window.location.hash = '#view=view_principles&select=con_purity'; });
  await page.reload();
  await expect(tab(page, 'Three rules that win arguments')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await expect(page.locator('.react-flow__node', { hasText: 'The engine knows nothing about the web' })).toHaveClass(/selected/);
});
