import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy, paste and one-step undo (F-015), driven through the app on a scratch copy of the self-model.
 *
 * A paste is many operations — an element each, their tags, the relationships between them — and the
 * promise is that it reads as one gesture: the file gains exactly the copies, and one ⌘Z takes every
 * byte of them back out again.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const ARCH = 'Architecture/Architecture.cs';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let root: string;
const read = (relative: string) => readFile(join(root, relative), 'utf8');

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-paste-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  // Let the sidecar be read before anything is written to it.
  await page.waitForTimeout(1_500);
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

const card = (page: Page, name: string) => page.locator('.react-flow__node', { hasText: name }).first();

test('a paste of two linked boxes adds them, their tags and their links — and one undo takes it all back', async ({ page }) => {
  const original = await readFile(join(root, ARCH));

  await card(page, 'Web host').click();
  await card(page, 'Canvas').click({ modifiers: [mod] });
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);

  await expect(card(page, 'Canvas copy')).toBeVisible({ timeout: 20_000 });
  await expect(card(page, 'Web host copy')).toBeVisible();
  // The copies are what is selected now — which is also the sign the paste has finished: the originals
  // stay selected until its last operation has landed.
  await expect(page.locator('.react-flow__node.selected', { hasText: 'copy' })).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);

  await expect.poll(async () => (await read(ARCH)).match(/new DataFlow\(/g)?.length ?? 0, { timeout: 10_000 })
    .toBe(original.toString('utf8').match(/new DataFlow\(/g)!.length + 2);
  const after = await read(ARCH);
  const added = after.split('\n').filter((line) => !original.toString('utf8').includes(line));
  // Two containers in the same system, their status and owner, and the two flows between them — the
  // flows to anything left behind stay behind.
  expect(added.filter((l) => /new Container\(/.test(l))).toHaveLength(2);
  expect(added.some((l) => /"Canvas copy", "sys_stemma", "spa"/.test(l))).toBe(true);
  expect(added.some((l) => /"Web host copy", "sys_stemma", "service"/.test(l))).toBe(true);
  expect(added.filter((l) => /new DataFlow\(/.test(l))).toHaveLength(2);
  expect(added.filter((l) => /Tag\.For\(/.test(l))).toHaveLength(2);
  expect(after).toContain('Squad: "Frontend"');

  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(async () => (await readFile(join(root, ARCH))).equals(original), { timeout: 20_000 }).toBe(true);
  await expect(card(page, 'Canvas copy')).toHaveCount(0);
});

test('duplicate puts a copy beside the original and leaves the clipboard alone', async ({ page }) => {
  await card(page, 'Web host').click();
  await page.keyboard.press(`${mod}+c`);
  await card(page, 'stemma CLI').click();
  await page.keyboard.press(`${mod}+d`);
  await expect(card(page, 'stemma CLI copy')).toBeVisible({ timeout: 20_000 });

  const original = await card(page, 'stemma CLI').boundingBox();
  const copy = await card(page, 'stemma CLI copy').boundingBox();
  expect(copy!.x).toBeGreaterThan(original!.x);
  expect(copy!.y).toBeGreaterThan(original!.y);

  // ⌘V still pastes what was copied, not what was duplicated.
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+v`);
  await expect(card(page, 'Web host copy')).toBeVisible({ timeout: 20_000 });
});

test('a copied look goes onto another box, keeps that box\'s size, and is undone in one step', async ({ page }) => {
  await card(page, 'Web host').click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).first().click();
  await page.getByTitle(/^Apply the .* style$/).first().click();
  await page.keyboard.press(`${mod}+Alt+c`);

  // The sidecar is written a moment after an edit; start from the file once it holds the look.
  await expect.poll(async () => JSON.parse(await read('stemma.layout.json')).nodeStyles?.cnt_web, { timeout: 10_000 }).toBeTruthy();
  const before = await read('stemma.layout.json');
  await card(page, 'stemma CLI').click();
  await page.keyboard.press(`${mod}+Alt+v`);
  await expect.poll(async () => (await read('stemma.layout.json')) !== before, { timeout: 10_000 }).toBe(true);
  const styles = JSON.parse(await read('stemma.layout.json')).nodeStyles;
  const { width: _w, height: _h, ...look } = styles.cnt_web;
  expect(styles.cnt_cli).toMatchObject(look);

  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => read('stemma.layout.json'), { timeout: 10_000 }).toBe(before);
});
