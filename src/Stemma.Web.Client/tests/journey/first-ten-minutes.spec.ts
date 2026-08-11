import { test, expect, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The first ten minutes (F-003), driven rather than described.
 *
 * Walking this path by hand on 2026-08-01 found six stops between launching Stemma and having one
 * named element on a canvas. The unit tests cover each decision in isolation; this covers the thing
 * the record is actually about — that the whole path exists, is short, and does not ask anyone for
 * a filesystem path.
 *
 * It writes real workspaces to the default location, because "you never have to type a path" is the
 * claim under test and the default location is what makes it true. Each one is removed afterwards.
 */

const created: string[] = [];

/** Mirrors `WorkspaceScaffold.Slug` — where a model created by name actually lands. */
function slug(name: string): string {
  return name.trim().replace(/[^\w\-. ]/g, '').replace(/ /g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

function uniqueName(prefix: string): string {
  const name = `${prefix} ${Date.now().toString(36)}`;
  created.push(join(homedir(), 'stemma', slug(name)));
  return name;
}

test.afterAll(async () => {
  for (const path of created) await rm(path, { recursive: true, force: true });
});

// "From launch" means nothing is open. The backend holds one workspace per process and reopens it
// on reload, so without this the second test lands on the previous one's canvas rather than on the
// start screen — which is correct behaviour and the wrong starting point for this measurement.
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
});

/** The prompt dialog is the same surface for every question the start screen asks. */
async function answerPrompt(page: Page, value: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill(value);
  await dialog.getByRole('textbox').press('Enter');
}

test.describe('from nothing to a model', () => {
  test('AC1/AC2 — a template lands a model in three interactions and no typed path', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Stemma' })).toBeVisible();

    const started = Date.now();

    // 1 — the door.
    await page.getByRole('button', { name: 'Start from a template' }).click();
    // 2 — which one.
    await page.getByRole('dialog').getByText('A system and its containers').click();
    // 3 — what it is called. Nothing here is a filesystem path.
    await answerPrompt(page, uniqueName('Journey Template'));

    // The C4 template is five boxes; wait for the model, not for a spinner.
    await expect(page.locator('.react-flow__node')).toHaveCount(5, { timeout: 60_000 });

    const seconds = (Date.now() - started) / 1000;
    // AC1's budget is sixty seconds for a person who is also reading and deciding. The machine's
    // share of it is what this asserts; the number is recorded in the feature record.
    expect(seconds, `template to canvas took ${seconds.toFixed(1)}s`).toBeLessThan(60);
    console.log(`AC1 (template route): ${seconds.toFixed(1)}s, 3 interactions`);
  });

  test('AC5/AC6/AC7 — empty model, first element, and the C# it wrote', async ({ page }) => {
    await page.goto('/');

    const started = Date.now();

    // 1 — the other door.
    await page.getByRole('button', { name: 'Start empty' }).click();
    // 2 — the name.
    await answerPrompt(page, uniqueName('Journey Empty'));

    // AC5 — an open-but-empty model explains itself instead of showing a bare grid.
    const guide = page.getByRole('region', { name: 'Empty model' });
    await expect(guide).toBeVisible({ timeout: 60_000 });

    // 3 — the primary action, which is a real button rather than a click target on an SVG.
    await page.getByRole('button', { name: 'Add your first bounded context' }).click();

    // AC6 — straight into the name field. No menu hunt, no separate rename step.
    const rename = page.getByRole('textbox', { name: 'Element name' });
    await expect(rename).toBeVisible({ timeout: 30_000 });
    await expect(rename).toBeFocused();
    // 4 — type, Enter, done.
    await rename.fill('Ordering');
    await rename.press('Enter');

    const seconds = (Date.now() - started) / 1000;
    expect(seconds, `empty to first named element took ${seconds.toFixed(1)}s`).toBeLessThan(60);
    console.log(`AC1 (empty route): ${seconds.toFixed(1)}s, 4 interactions`);

    // AC7 — the premise, demonstrated at the one moment it can be: the box is a line of C#, quoted
    // from the file rather than rendered from the model.
    const strip = page.getByRole('status', { name: 'What that added to your source' });
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(strip).toContainText('new BoundedContext');
    await expect(strip).toContainText('Architecture.cs');

    // AC5 again — the guidance is gone for good now that the model has something in it.
    await expect(guide).toBeHidden();

    // And it stays gone, and the explainer does not come back for a second element.
    await strip.getByRole('button', { name: 'Dismiss' }).click();
    await expect(strip).toBeHidden();

    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByRole('region', { name: 'Empty model' })).toBeHidden();
    await expect(page.getByRole('status', { name: 'What that added to your source' })).toBeHidden();
  });
});
