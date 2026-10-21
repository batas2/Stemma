import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Find on the view (F-018), on a scratch copy of the self-model: a question asked of the canvas lights
 * the answer and fades the rest, Enter walks the answer, and Escape puts the canvas back. Nothing is
 * written.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let root: string;

async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(path.slice(dir.length + 1), (await readFile(path)).toString('base64'));
  }
  return files;
}

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-find-'));
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

const opacity = (page: Page, name: string) =>
  page.locator('.react-flow__node', { hasText: name }).first().evaluate((el) => getComputedStyle(el).opacity);

test('a squad chip lights what that squad owns, Enter walks it, and Escape puts the canvas back', async ({ page }) => {
  const before = await snapshot(root);
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press(`${mod}+f`);
  const bar = page.getByRole('search', { name: 'Find on this view' });
  await expect(bar.getByLabel('Find')).toBeFocused();

  // "Frontend" owns the Canvas; "Core" owns the Web host.
  await bar.getByRole('button', { name: /^Frontend/ }).click();
  await expect(bar.getByLabel('Find')).toHaveValue('squad:frontend');
  await expect(bar).toContainText(/\d+ match/);
  expect(await opacity(page, 'Canvas')).toBe('1');
  expect(Number(await opacity(page, 'Web host'))).toBeLessThan(0.5);

  // Enter walks the matches, selecting each.
  await bar.getByLabel('Find').press('Enter');
  await expect(bar).toContainText(/1 of \d+/);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

  // A word that matches nothing fades nothing and says so.
  await bar.getByLabel('Find').fill('no-such-thing-anywhere');
  await expect(bar).toContainText('No matches');
  expect(await opacity(page, 'Web host')).toBe('1');

  await bar.getByLabel('Find').press('Escape');
  await expect(bar).toHaveCount(0);
  expect(await opacity(page, 'Web host')).toBe('1');

  await page.waitForTimeout(1_500);
  expect(await snapshot(root)).toEqual(before);
});

test('hide takes the rest away, and a field narrows a word to itself', async ({ page }) => {
  await page.keyboard.press(`${mod}+f`);
  const bar = page.getByRole('search', { name: 'Find on this view' });
  await bar.getByLabel('Find').fill('status:current kind:container');
  await bar.getByRole('radio', { name: 'Hide the rest' }).click();
  await expect(page.locator('.react-flow__node', { hasText: 'Web host' }).first()).toBeVisible();
  // A module is not a container, whatever its status.
  await expect(page.locator('.react-flow__node', { hasText: 'DslWriter' })).toHaveCount(0);
});
