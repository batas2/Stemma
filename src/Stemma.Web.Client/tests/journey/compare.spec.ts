import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What changed (F-017), on a scratch repository holding the self-model: an evening's edits — one
 * rename, one deletion — compared with the last commit are drawn as a changed card and a ghost, and
 * comparing writes nothing at all.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));
let root: string;

function git(...args: string[]) {
  execFileSync('git', args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, '.no-global-config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com',
    },
    stdio: 'ignore',
  });
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.parentPath.includes('.git')) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(path.slice(dir.length + 1), (await readFile(path)).toString('base64'));
  }
  return files;
}

test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'stemma-compare-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'The model as it was');
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

const card = (page: Page, name: string) => page.locator('.react-flow__node', { hasText: name }).first();

test('a rename and a deletion are drawn as a changed card and a ghost, and comparing writes nothing', async ({ page }) => {
  // The evening's edits: rename one container, delete another.
  await card(page, 'stemma CLI').click();
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('stemma command line');
  await page.keyboard.press('Enter');
  await expect(card(page, 'stemma command line')).toBeVisible({ timeout: 20_000 });

  await card(page, 'Desktop shell').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Delete Desktop shell/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(card(page, 'Desktop shell')).toHaveCount(0, { timeout: 20_000 });

  // The status bar has been counting.
  await expect(page.getByRole('button', { name: /changes? since the last commit/ })).toBeVisible({ timeout: 20_000 });

  const before = await snapshot(root);
  await page.getByRole('button', { name: /^Compare/ }).click();
  await page.getByRole('menuitem', { name: /The last commit/ }).click();

  const bar = page.getByRole('region', { name: 'Comparison' });
  await expect(bar).toContainText('Compared with the last commit');
  await expect(card(page, 'stemma command line')).toContainText('Changed');
  await expect(page.locator('[data-ghost="cnt_desktop"]')).toContainText('Desktop shell');

  await bar.getByRole('button', { name: /Changes/ }).click();
  const list = page.getByRole('region', { name: 'Changes' });
  await expect(list).toContainText('Renamed from “stemma CLI”');
  await expect(list).toContainText('Desktop shell');

  // Selecting the changed card, the inspector says what changed about it.
  await list.getByRole('button', { name: /stemma command line/ }).click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('Changed since the last commit');

  await bar.getByRole('button', { name: /Done/ }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('[data-ghost]')).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(await snapshot(root)).toEqual(before);
});
