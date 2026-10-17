import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fidelity, driven rather than asserted on the engine alone (B-006…B-015).
 *
 * The engine's suite compares every operation's output byte for byte. What it cannot see is the
 * path in between: the inspector that sends the operation, the browser's copy of the workspace,
 * the watcher, the second read that races the first. Each of those broke the contract at least
 * once while the engine's own tests were green — opening a workspace wrote its sidecar; a view
 * pulled in while the canvas was open was saved into a second file — and each was found by doing
 * this by hand. These are the same steps, on a scratch copy of the self-model.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const ARCH = join('Architecture', 'Architecture.cs');

let root: string;

/** Every file of the workspace, as bytes, so "nothing changed" can be asserted rather than hoped. */
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

/** A model-only copy — no project file — so the run needs no SDK and touches nothing shared. */
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-fidelity-'));
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

/** An editable row of the Properties panel, found by the field it edits. */
function field(page: Page, name: string) {
  return page.locator('li', { has: page.locator(`label[title="Show ${name} on the canvas"]`) })
    .locator('input:not([type=checkbox]), select').first();
}

async function inspect(page: Page, element: string) {
  await page.locator('.react-flow__node', { hasText: element }).first().click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(field(page, 'Name')).toHaveValue(element);
}

test('opening a workspace writes nothing (B-012)', async ({ page }) => {
  const before = await snapshot(root);
  // Long enough for the sidecar to be read twice — from the open and from the first refresh — and
  // for any write that follows to land.
  await page.waitForTimeout(3_000);
  expect(await snapshot(root)).toEqual(before);
});

test('an edit in the inspector changes its own argument, and undo puts the bytes back (B-007, B-009)', async ({ page }) => {
  const original = await readFile(join(root, ARCH));
  await inspect(page, 'stemma CLI');

  await field(page, 'Phase').fill('shipped 2026-10');
  await field(page, 'Phase').press('Enter');
  const expected = original.toString('utf8').replace('Phase: "shipped 2026-08"', 'Phase: "shipped 2026-10"');
  await expect.poll(() => read(ARCH)).toBe(expected);

  const undo = page.locator('button[title^="Undo"]');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => (await readFile(join(root, ARCH))).equals(original)).toBe(true);
});

test('an edit made outside is shown, and not written back (B-008)', async ({ page }) => {
  const outside = (await read(ARCH)).replace('"Roslyn")', '"Roslyn compiler")');
  await writeFile(join(root, ARCH), outside);

  await expect(page.locator('.react-flow__node', { hasText: 'Roslyn compiler' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4_000); // several watcher polls
  expect(await read(ARCH)).toBe(outside);
});

test('a view pulled in while the canvas is open is edited where it is (B-010, B-015)', async ({ page }) => {
  const pulled = [
    'using Stemma.Model;',
    '',
    'namespace StemmaArchitecture;',
    '',
    'public static class Pulled',
    '{',
    '    public static View Define() => new(',
    '        Id: "view_pulled",',
    '        Name: "Pulled from a teammate",',
    '        BaseView: "all",',
    '        ElementIds: new[] { "sys_git" });',
    '}',
    '',
  ].join('\n');
  await writeFile(join(root, 'Views', 'Pulled.cs'), pulled);
  const views = await readdir(join(root, 'Views'));

  await page.reload();
  await page.getByRole('button', { name: /^Views\s*\d*$/ }).first().click();
  await page.getByText('Pulled from a teammate', { exact: true }).click();
  await page.getByRole('button', { name: /^Elements$/ }).first().click();
  await page.locator('li', { hasText: 'Roslyn' }).first()
    .dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 400, y: 500 } });

  await expect.poll(() => read(join('Views', 'Pulled.cs')))
    .toBe(pulled.replace('new[] { "sys_git" }', 'new[] { "sys_git", "sys_roslyn" }'));
  expect(await readdir(join(root, 'Views'))).toEqual(views);
});
