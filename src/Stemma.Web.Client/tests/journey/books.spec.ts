import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Books (F-013), driven through the app on a scratch copy of the self-model.
 *
 * Until now a book made in the app lasted until the next reload, and nothing showed it. These are
 * the steps of the feature's promise: a page made from what the canvas shows is written to the
 * sidecar as that page and nothing more, it is there after a reload, and presenting it turns pages
 * with the keys a presenter already uses while writing nothing at all.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));

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

const read = (relative: string) => readFile(join(root, relative), 'utf8');

/** `after` is `before` with lines added: every old line still there, in order, one gaining a comma. */
function onlyAdds(before: string, after: string): boolean {
  const strip = (l: string) => l.replace(/,$/, '');
  const old = before.split('\n').map(strip);
  const now = after.split('\n').map(strip);
  let i = 0;
  for (const line of now) if (i < old.length && line === old[i]) i++;
  return i === old.length;
}

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-books-'));
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

async function openBooks(page: Page) {
  await page.getByRole('button', { name: /^Views\s*\d*$/ }).first().click();
  await expect(page.getByRole('button', { name: 'New book' })).toBeVisible();
}

test('a page made from the canvas is written as that page, and is there after a reload', async ({ page }) => {
  const before = await read('stemma.layout.json');
  await openBooks(page);

  await page.getByRole('button', { name: 'New book' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Walkthrough');
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  const editor = page.getByRole('region', { name: 'Book editor: Walkthrough' });
  await expect(editor).toBeVisible();

  // Point at Roslyn, then make a page of what the canvas shows.
  await page.locator('.react-flow__node', { hasText: 'Roslyn' }).first().click();
  await editor.getByRole('button', { name: 'Add page' }).click();
  await editor.getByLabel('Narrative').fill('Roslyn is the only way into the code.');

  await expect.poll(() => read('stemma.layout.json')).toContain('Roslyn is the only way into the code.');
  const after = await read('stemma.layout.json');
  expect(onlyAdds(before, after)).toBe(true);

  const { books: booksBefore, ...restBefore } = JSON.parse(before);
  const { books: booksAfter, ...restAfter } = JSON.parse(after);
  expect(restAfter).toEqual(restBefore);
  const added = Object.entries(booksAfter as Record<string, { name: string; order: string[]; pages: Record<string, unknown> }>)
    .filter(([id]) => !(id in booksBefore));
  expect(added).toHaveLength(1);
  const [, book] = added[0];
  expect(book.name).toBe('Walkthrough');
  expect(Object.values(book.pages)).toEqual([
    { title: 'Module Map', view: 'moduleMap', focus: ['sys_roslyn'], narrative: 'Roslyn is the only way into the code.' },
  ]);

  await page.reload();
  await openBooks(page);
  await expect(page.getByRole('list', { name: 'Books' }).getByText('Walkthrough')).toBeVisible();
});

test('presenting turns pages with the keys, points at what a page names, and writes nothing', async ({ page }) => {
  const before = await snapshot(root);
  await openBooks(page);
  await page.getByRole('button', { name: 'Present Stemma in ten minutes' }).click();

  const narrative = page.getByRole('region', { name: 'Page narrative' });
  await expect(narrative.getByRole('heading')).toHaveText('Four things ship');
  // The chrome is gone: nothing to edit with, nothing between the audience and the picture.
  await expect(page.getByRole('region', { name: /^Book editor/ })).toHaveCount(0);
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(narrative.getByRole('heading')).toHaveText('A gesture becomes a diff');
  await page.keyboard.press('PageDown'); // what a clicker sends
  await expect(narrative.getByRole('heading')).toHaveText('What the engine is allowed to know');
  // This page points at two elements; the rest of its view fades.
  await expect(page.locator('.react-flow__node[style*="opacity: 0.2"]').first()).toBeAttached();
  await page.keyboard.press('PageDown');
  await expect(narrative.getByRole('heading')).toHaveText('What the engine is allowed to know');
  await page.keyboard.press('Home');
  await expect(narrative.getByRole('heading')).toHaveText('Four things ship');

  await page.keyboard.press('n');
  await expect(narrative).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(narrative).toBeVisible();

  // Looking, not editing: a drag and a double-click on a name change nothing while presenting. The
  // mouse goes where a person's would, by coordinates — a node that takes no events is the point.
  const node = page.locator('.react-flow__node:not([style*="opacity: 0.2"])').first();
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.react-flow__node input')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(narrative).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Book editor: Stemma in ten minutes' })).toBeVisible();

  await page.waitForTimeout(1_500);
  expect(await snapshot(root)).toEqual(before);
});
