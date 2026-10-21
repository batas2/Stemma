import { test, expect } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Steps (F-020), on a scratch copy of the self-model, whose book walks "a gesture becomes a diff" one
 * arrow at a time: Next lights the next arrow before it turns the page, Back unwinds them, and a step
 * can be recorded by clicking a relationship.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let root: string;

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-steps-'));
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

test('a page lights its arrows one at a time before the page turns, and Back unwinds them', async ({ page }) => {
  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('present book stemma in ten');
  await page.keyboard.press('Enter');
  const nav = page.getByRole('navigation', { name: 'Presentation' });
  const card = page.locator('[data-book-narrative]');

  await page.keyboard.press('ArrowRight');
  await expect(nav).toContainText('2 / 3');
  await expect(card).toContainText('A gesture becomes a diff');
  await expect(card).not.toContainText('Step');

  await page.keyboard.press('ArrowRight');
  await expect(nav).toContainText('2 / 3');
  await expect(card).toContainText('Step 1 of 6');
  await expect(card).toContainText('You rename a box.');
  await expect(page.locator('.stemma-edge-label', { hasText: '①' })).toHaveCount(1);

  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(card).toContainText('Step 6 of 6');
  await expect(page.locator('.stemma-edge-label', { hasText: '⑥' })).toHaveCount(1);

  await page.keyboard.press('ArrowRight');
  await expect(nav).toContainText('3 / 3');

  // Back into the page arrives where it ended, and unwinds a step at a time.
  await page.keyboard.press('ArrowLeft');
  await expect(card).toContainText('Step 6 of 6');
  await page.keyboard.press('ArrowLeft');
  await expect(card).toContainText('Step 5 of 6');
});

test('recording turns clicked relationships into the page\'s steps', async ({ page }) => {
  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('open edit book drawing without');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('region', { name: /Book editor/ });
  await expect(editor).toBeVisible();

  await editor.getByRole('button', { name: 'Record' }).click();
  const edges = page.locator('.react-flow__edge');
  await expect(edges.first()).toBeAttached();
  const first = await edges.nth(0).getAttribute('data-id');
  const second = await edges.nth(1).getAttribute('data-id');
  // The page frames its view; an arrow may sit outside the window, which a click on it does not mind.
  await page.locator(`.react-flow__edge[data-id="${first}"] .react-flow__edge-interaction`).dispatchEvent('click');
  await page.locator(`.react-flow__edge[data-id="${second}"] .react-flow__edge-interaction`).dispatchEvent('click');
  await editor.getByRole('button', { name: /Recording/ }).click();

  await expect(editor.getByLabel('What to say at step 2')).toBeVisible();
  await expect.poll(async () => {
    // Read between writes: a file caught half-written is simply read again.
    try {
      const sidecar = JSON.parse(await readFile(join(root, 'stemma.layout.json'), 'utf8'));
      return sidecar.books.book_agent.pages.command.steps;
    } catch { return null; }
  }, { timeout: 10_000 }).toEqual([first, second]);
});
