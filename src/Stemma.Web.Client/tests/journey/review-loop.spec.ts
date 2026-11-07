import { test, expect } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The review loop, as the architect sees it (F-027). The cards say where the open comments are; a
 * badge opens the card's comments; and what an agent writes from the command line — a reply, a
 * resolution, a comment of its own — lands on the open canvas without a reload. The command line
 * writes `comments.stemma.json` and nothing else, so the test writes that file the same way. In front
 * of the room the badges are not drawn.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let root: string;
const commentsFile = () => join(root, 'comments.stemma.json');

function comments(entries: { id: string; targetId: string; body: string; resolved?: boolean; thread?: { author: string; body: string }[] }[]) {
  return JSON.stringify({
    version: 1,
    comments: entries.map((e) => ({
      id: e.id, targetKind: 'element', targetId: e.targetId, author: 'Aria', createdAt: '2026-11-07T10:00:00.000Z',
      body: e.body, resolved: e.resolved ?? false,
      thread: (e.thread ?? []).map((r) => ({ ...r, createdAt: '2026-11-07T11:00:00.000Z' })),
    })),
  }, null, 2) + '\n';
}

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-review-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  await writeFile(commentsFile(), comments([
    { id: 'c_web', targetId: 'cnt_web', body: 'Should the host be a separate process?' },
    { id: 'c_done', targetId: 'cnt_cli', body: 'Name the render command.', resolved: true },
  ]));
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('What ships');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node[data-id="cnt_web"]')).toBeVisible({ timeout: 20_000 });
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

test('a card says it has open comments, and its badge opens them', async ({ page }) => {
  const web = page.locator('.react-flow__node[data-id="cnt_web"]');
  await expect(web.getByRole('button', { name: 'Show 1 open comment' })).toBeVisible();
  // A resolved comment is not counted.
  await expect(page.locator('.react-flow__node[data-id="cnt_cli"]').getByRole('button', { name: /open comment/ })).toHaveCount(0);

  await web.getByRole('button', { name: 'Show 1 open comment' }).click();

  await expect(page.getByText('Should the host be a separate process?')).toBeVisible();
  const rail = page.getByRole('button', { name: 'Comments', exact: true });
  await expect(rail).toHaveAttribute('aria-pressed', 'true');
  await expect(rail).toHaveAccessibleDescription('1 open comment');
  await expect(web).toHaveClass(/selected/);
});

test('what the command line writes is on the canvas without a reload', async ({ page }) => {
  const badge = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`).getByRole('button', { name: /^Show \d+ open comments?$/ });
  await expect(badge('cnt_web')).toHaveAccessibleName('Show 1 open comment');

  // An agent comments on another card and answers the first.
  await writeFile(commentsFile(), comments([
    { id: 'c_web', targetId: 'cnt_web', body: 'Should the host be a separate process?', thread: [{ author: 'Claude', body: 'It is one process with the window; see ADR-0017.' }] },
    { id: 'c_done', targetId: 'cnt_cli', body: 'Name the render command.', resolved: true },
    { id: 'c_git', targetId: 'sys_git', body: 'Is Git a dependency or a store here?' },
    { id: 'c_git2', targetId: 'sys_git', body: 'And which version?' },
  ]));
  await expect(badge('sys_git')).toHaveAccessibleName('Show 2 open comments', { timeout: 15_000 });

  await badge('cnt_web').click();
  await expect(page.getByText('It is one process with the window; see ADR-0017.')).toBeVisible();

  // It resolves what it answered: the badge goes, from the card and from the rail.
  await writeFile(commentsFile(), comments([
    { id: 'c_web', targetId: 'cnt_web', body: 'Should the host be a separate process?', resolved: true },
    { id: 'c_done', targetId: 'cnt_cli', body: 'Name the render command.', resolved: true },
    { id: 'c_git', targetId: 'sys_git', body: 'Is Git a dependency or a store here?' },
    { id: 'c_git2', targetId: 'sys_git', body: 'And which version?' },
  ]));
  await expect(badge('cnt_web')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Comments', exact: true })).not.toHaveAttribute('aria-describedby');
  await expect(badge('sys_git')).toHaveAccessibleName('Show 2 open comments');
});

test('a comment posted in the app is counted at once, and nothing is drawn in front of the room', async ({ page }) => {
  const web = page.locator('.react-flow__node[data-id="cnt_web"]');
  await web.getByRole('button', { name: 'Show 1 open comment' }).click();
  await page.getByLabel('New comment').fill('And who restarts it?');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(web.getByRole('button', { name: 'Show 2 open comments' })).toBeVisible();
  expect(await readFile(commentsFile(), 'utf8')).toContain('And who restarts it?');

  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Go to a view or an element/).fill('present book stemma in ten');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Presentation' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.react-flow__node[data-id="cnt_web"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Show \d+ open comments?$/ })).toHaveCount(0);
});
