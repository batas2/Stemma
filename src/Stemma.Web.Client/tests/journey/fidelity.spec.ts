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

  // The phase the sample gives it, read rather than assumed: when the sample's phase changed, the
  // expected file was the original, and the check passed only when it read the file before the edit.
  const phase = await field(page, 'Phase').inputValue();
  expect(phase).not.toBe('shipped 2026-10');
  await field(page, 'Phase').fill('shipped 2026-10');
  await field(page, 'Phase').press('Enter');
  const expected = original.toString('utf8').replace(`Phase: "${phase}"`, 'Phase: "shipped 2026-10"');
  expect(expected).not.toBe(original.toString('utf8'));
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

/** Drag the box labelled `element` by (dx, dy) on the canvas. */
async function drag(page: Page, element: string, dx: number, dy: number) {
  // Where the box has come to rest: a view that has just opened is still being framed.
  const node = page.locator('.react-flow__node', { hasText: element }).first();
  let box = (await node.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = (await node.boundingBox())!;
    const still = next.x === box.x && next.y === box.y && next.width === box.width;
    box = next;
    if (still) break;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 12 + dy, { steps: 8 });
  await page.mouse.up();
}

/**
 * Whether `after` is `before` with lines added and nothing else: every line of `before` is still
 * there, in order, the one before an insertion allowed to gain its comma. A file rewritten — keys
 * reordered, defaults written out — fails this however few values changed.
 */
function onlyAdds(before: string, after: string): boolean {
  const strip = (l: string) => l.replace(/,$/, '');
  const old = before.split('\n').map(strip);
  const now = after.split('\n').map(strip);
  let i = 0;
  for (const line of now) if (i < old.length && line === old[i]) i++;
  return i === old.length;
}

test('moving a box writes that box, not the file (B-014)', async ({ page }) => {
  const sidecar = join(root, 'stemma.layout.json');
  const before = await read('stemma.layout.json');
  await page.getByRole('button', { name: /^Views\s*\d*$/ }).first().click();
  await page.getByText('What ships', { exact: true }).click();
  await expect(page.locator('.react-flow__node', { hasText: 'Desktop shell' })).toBeVisible();

  await drag(page, 'Desktop shell', 60, 40);

  await expect.poll(() => readFile(sidecar, 'utf8')).not.toBe(before);
  const after = await readFile(sidecar, 'utf8');
  expect(onlyAdds(before, after)).toBe(true);
  expect(after.split('\n').length - before.split('\n').length).toBeLessThan(10);
});

test('a change made to the sidecar outside survives the next edit (B-014)', async ({ page }) => {
  const sidecar = join(root, 'stemma.layout.json');
  const pulled = (await read('stemma.layout.json')).replace(/("mod_writer": ")/, '$1Changed by a pull. ');
  expect(pulled).toContain('Changed by a pull.');
  await writeFile(sidecar, pulled);
  await page.waitForTimeout(2_000); // the watcher, and the canvas reading it again

  await page.getByRole('button', { name: /^Views\s*\d*$/ }).first().click();
  await page.getByText('What ships', { exact: true }).click();
  await expect(page.locator('.react-flow__node', { hasText: 'Desktop shell' })).toBeVisible();
  await drag(page, 'Desktop shell', 60, 40);

  await expect.poll(() => readFile(sidecar, 'utf8')).not.toBe(pulled);
  const after = await readFile(sidecar, 'utf8');
  expect(after).toContain('Changed by a pull.');
  expect(onlyAdds(pulled, after)).toBe(true);
});

/** A teammate's comments, written by hand: four spaces, raw Polish, a key Stemma does not know. */
const TEAMMATE = `{
    "version": 1,
    "comments": [
        {
            "id": "cmt_teammate",
            "targetKind": "element",
            "targetId": "cnt_cli",
            "author": "Ewa",
            "createdAt": "2026-10-16T09:00:00Z",
            "body": "Czy CLI potrzebuje własnego hosta?",
            "resolved": false,
            "labels": ["pytanie"],
            "thread": []
        }
    ]
}
`;

async function openComments(page: Page, element: string) {
  await page.locator('.react-flow__node', { hasText: element }).first().click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
}

test('a comment posted is that comment, and one pulled in meanwhile survives it (B-018)', async ({ page }) => {
  const file = join(root, 'comments.stemma.json');
  await writeFile(file, TEAMMATE);
  await openComments(page, 'stemma CLI');
  await expect(page.getByText('Czy CLI potrzebuje własnego hosta?')).toBeVisible();

  // A pull lands while the panel is open: a second comment on the same element.
  const pulled = TEAMMATE.replace('\n    ]\n}', [
    ',',
    '        {',
    '            "id": "cmt_pulled",',
    '            "targetKind": "element",',
    '            "targetId": "cnt_cli",',
    '            "author": "Ada",',
    '            "createdAt": "2026-10-17T08:00:00Z",',
    '            "body": "Przyszło z pulla.",',
    '            "resolved": false,',
    '            "thread": []',
    '        }',
    '    ]',
    '}',
  ].join('\n'));
  await writeFile(file, pulled);
  // The engine announces it, and the open panel reads the file again.
  await expect(page.getByText('Przyszło z pulla.')).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('New comment').fill('Tak, na czas renderu.');
  await page.getByLabel('New comment').press('Enter');

  await expect.poll(() => read('comments.stemma.json')).toContain('Tak, na czas renderu.');
  const after = await read('comments.stemma.json');
  expect(onlyAdds(pulled, after)).toBe(true);
  expect(after).toContain('"body": "Tak, na czas renderu."');
});

test('comments that cannot be read are said to be, and nothing is written over them (B-018)', async ({ page }) => {
  const file = join(root, 'comments.stemma.json');
  const conflicted = TEAMMATE.replace('    "version": 1,\n', '<<<<<<< HEAD\n    "version": 1,\n=======\n    "version": 2,\n>>>>>>> theirs\n');
  await writeFile(file, conflicted);
  await openComments(page, 'stemma CLI');

  await expect(page.getByRole('alert').filter({ hasText: 'comments.stemma.json' })).toBeVisible();
  await expect(page.getByLabel('New comment')).toBeDisabled();
  await page.waitForTimeout(1_000);
  expect(await read('comments.stemma.json')).toBe(conflicted);
});
