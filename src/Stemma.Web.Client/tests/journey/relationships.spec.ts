import { test, expect } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Relationships on the canvas, driven through the app on a scratch copy of the self-model.
 *
 * Reversing is the link removed and added again, and it once added "a dependency" whatever it had been:
 * a Relation came back as `new Dependency(…, "uses")`, its label gone. The reversed link is the same
 * relationship pointing the other way, and one ⌘Z puts every byte back.
 *
 * And a picture at rest is still: every dependency and relation once flowed by default, which redrew
 * the whole canvas each frame.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const ARCH = 'Architecture/Architecture.cs';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let root: string;
const read = () => readFile(join(root, ARCH), 'utf8');

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-relink-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

test('reversing a relation keeps it a relation, with its label — and one undo puts it back', async ({ page }) => {
  const original = await readFile(join(root, ARCH));
  const dependencies = original.toString('utf8').match(/new Dependency\(/g)!.length;

  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('Three rules that win arguments');
  await page.keyboard.press('Enter');
  const edge = page.locator('.react-flow__edge[data-id="rel_fidelity_fixtures"]');
  await expect(edge).toBeAttached({ timeout: 20_000 });
  await edge.locator('.react-flow__edge-interaction').dispatchEvent('click');

  const expand = page.getByRole('button', { name: 'Expand inspector' });
  if (await expand.isVisible()) await expand.click();
  // A relation is labelled, not given a dependency's kind.
  const inspector = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Relation' }) });
  await expect(inspector.getByPlaceholder('gated by, implemented by…')).toHaveValue('gated by');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByText('Style — line, routing, ends, colour').click();
  await page.getByTitle('Reverse direction (swap start ↔ end)').click();

  await expect.poll(async () => /new Relation\("[^"]+", "mod_fidelity", "con_fidelity", "gated by"\)/.test(await read()), { timeout: 20_000 }).toBe(true);
  const after = await read();
  expect(after).not.toContain('"con_fidelity", "mod_fidelity"');
  expect(after.match(/new Dependency\(/g)!.length).toBe(dependencies);
  await expect(page.getByText('Relationship reversed')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await readFile(join(root, ARCH))).equals(original), { timeout: 20_000 }).toBe(true);
});

test('a view at rest is still: no relationship flows unless it was asked to', async ({ page }) => {
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await expect(page.locator('.react-flow__edge').first()).toBeAttached({ timeout: 20_000 });
  expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(10);
  await expect(page.locator('.react-flow__edge.animated')).toHaveCount(0);
});
