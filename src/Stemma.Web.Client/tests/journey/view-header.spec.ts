import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Self-explaining views (F-014), driven through the app on a scratch copy of the self-model.
 *
 * A header is added and written from the canvas, as one field and nothing else, and is there after a
 * reload; it is shown, read-only, when the view is presented; and a backdrop shape under a card no
 * longer covers it (B-019).
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/StemmaArchitecture', import.meta.url));

let root: string;
const read = (relative: string) => readFile(join(root, relative), 'utf8');

/** Change the scratch copy's sidecar before the app reads it. */
async function editSidecar(edit: (sidecar: Record<string, any>) => void) {
  const sidecar = JSON.parse(await read('stemma.layout.json'));
  edit(sidecar);
  await writeFile(join(root, 'stemma.layout.json'), JSON.stringify(sidecar, null, 2));
}

async function openWorkspace(page: Page, activeView?: string) {
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  if (activeView) {
    await page.addInitScript(([r, id]) => {
      localStorage.setItem(`stemma.activeView:${r}`, id);
      localStorage.setItem(`stemma.openViews:${r}`, JSON.stringify([id]));
    }, [root, activeView]);
  }
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  // The view opened last is the last tab; the app opens on the Module Map.
  if (activeView) await page.getByRole('tab').last().click();
}

test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stemma-header-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

test('a header is added from the Layout panel, written as the one field edited, and there after a reload', async ({ page }) => {
  await openWorkspace(page);
  const before = JSON.parse(await read('stemma.layout.json'));

  await page.getByRole('button', { name: 'Layout & arrange' }).click();
  await page.getByRole('button', { name: 'Add a header' }).click();
  const header = page.getByRole('region', { name: 'About this view: Module Map' });
  await expect(header).toBeVisible();

  await header.getByRole('button', { name: 'Edit the message' }).click();
  await header.getByRole('textbox', { name: 'Message' }).fill('Every part of Stemma, and who it talks to.');
  await page.keyboard.press('Enter');
  await expect(header).toContainText('Every part of Stemma, and who it talks to.');

  await expect.poll(async () => JSON.parse(await read('stemma.layout.json')).views?.moduleMap?.header)
    .toEqual({ message: 'Every part of Stemma, and who it talks to.' });
  const after = JSON.parse(await read('stemma.layout.json'));
  const { moduleMap, ...otherViews } = after.views;
  expect(otherViews).toEqual(before.views);
  expect({ ...after, views: undefined }).toEqual({ ...before, views: undefined });
  expect(Object.keys(moduleMap)).toEqual(['header']);

  await page.reload();
  await expect(page.getByRole('region', { name: 'About this view: Module Map' }))
    .toContainText('Every part of Stemma, and who it talks to.', { timeout: 30_000 });
});

test('a presented view shows its header, read-only, over the picture', async ({ page }) => {
  await editSidecar((s) => {
    s.views['custom:view_shape'].header = {
      message: 'Four things ship, and one of them is the model.',
      context: 'Read it **left to right**.',
    };
  });
  await openWorkspace(page);
  await page.getByRole('button', { name: /^Views\s*\d*$/ }).first().click();
  await page.getByRole('button', { name: 'Present Stemma in ten minutes' }).click();

  const header = page.locator('[data-view-header]');
  await expect(header).toContainText('Four things ship, and one of them is the model.');
  // Presented, the context is said rather than shown: the picture gets the room.
  await expect(header).not.toContainText('left to right');
  await expect(header.getByRole('button', { name: /^Edit the/ })).toHaveCount(0);
  // The picture is framed below the header, not under it: once the camera has settled, nothing the
  // page lights starts above the header's lower edge.
  await page.waitForTimeout(1_200);
  const band = (await header.boundingBox())!;
  const lit = page.locator('.react-flow__node:not([style*="opacity: 0.2"])');
  expect(await lit.count()).toBeGreaterThan(0);
  for (let i = 0; i < await lit.count(); i++) {
    const box = await lit.nth(i).boundingBox();
    if (box) expect(box.y).toBeGreaterThanOrEqual(band.y + band.height - 1);
  }
});

test('a filled backdrop under a card leaves the card on top and clickable (B-019)', async ({ page }) => {
  await editSidecar((s) => {
    s.views['custom:view_shape'].shapes = [
      { id: 'sh_zone', kind: 'rect', x: -400, y: -400, w: 3200, h: 2400, z: -1, fill: '#fde68a', stroke: '#d97706', strokeWidth: 2 },
    ];
  });
  await openWorkspace(page, 'view_shape');
  await expect(page.locator('[data-shape-backdrop] rect').first()).toBeAttached();

  // Once the view has been framed: the fit is animated, and a box measured mid-flight is elsewhere.
  await page.waitForTimeout(1_000);
  const node = page.locator('.react-flow__node').first();
  const box = (await node.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // What is under the pointer at the card's centre is the card, not the zone drawn behind it.
  const onTop = await page.evaluate(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('.react-flow__node') ? 'card' : `${hit?.tagName}.${hit?.getAttribute('class')}`;
  }, [cx, cy]);
  expect(onTop).toBe('card');

  await page.mouse.click(cx, cy);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
});

test('a card on a backdrop’s edge keeps its click, and the backdrop is gripped by its edge (B-019)', async ({ page }) => {
  // Where the first card sits, in flow coordinates, read from the canvas itself.
  await openWorkspace(page, 'view_shape');
  await page.waitForTimeout(1_000);
  const card = await page.locator('.react-flow__node').first().evaluate((el) => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((el as HTMLElement).style.transform)!;
    return { id: (el as HTMLElement).dataset.id!, x: +m[1], y: +m[2], w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight };
  });
  // A zone whose top edge runs straight through the middle of that card, and one well clear of
  // every card, below them.
  await editSidecar((s) => {
    s.views['custom:view_shape'].shapes = [
      { id: 'sh_edge', kind: 'rect', x: card.x - 160, y: card.y + card.h / 2, w: card.w + 320, h: 400, z: -1, fill: '#fde68a', stroke: '#d97706', strokeWidth: 2 },
      { id: 'sh_clear', kind: 'ellipse', x: card.x, y: card.y + 1600, w: 600, h: 300, z: -1, fill: '#bfdbfe', stroke: '#2563eb', strokeWidth: 2 },
    ];
  });
  await openWorkspace(page, 'view_shape');
  await page.waitForTimeout(1_000);
  const node = page.locator(`.react-flow__node[data-id="${card.id}"]`);
  const box = (await node.boundingBox())!;

  // On the zone's edge, inside the card: the card.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(`.react-flow__node[data-id="${card.id}"].selected`)).toHaveCount(1);

  // On a backdrop's own outline — the ellipse's curve, not its bounding box — the backdrop, which
  // shows its selection frame. Its empty middle is left to the pane.
  const scale = box.width / card.w;
  const vp = await page.locator('.react-flow__viewport').evaluate((el) => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec((el as HTMLElement).style.transform)!;
    const r = el.parentElement!.getBoundingClientRect();
    return { x: +m[1] + r.left, y: +m[2] + r.top, zoom: +m[3] };
  });
  const toScreen = (fx: number, fy: number) => ({ x: vp.x + fx * vp.zoom, y: vp.y + fy * vp.zoom });
  const middle = toScreen(card.x + 300, card.y + 1600 + 150);
  await page.mouse.click(middle.x, middle.y);
  await expect(page.locator('[data-shape-overlay] rect[stroke-dasharray="4 4"]')).toHaveCount(0);
  const top = toScreen(card.x + 300, card.y + 1600);
  await page.mouse.click(top.x, top.y);
  await expect(page.locator('[data-shape-overlay] rect[stroke-dasharray="4 4"]')).toHaveCount(1);
  expect(scale).toBeGreaterThan(0);
});
