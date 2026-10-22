import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Layered layout and C4 views (F-021, F-023), driven through the app on a scratch copy of the C4 sample,
 * which has no stemma.layout.json at all.
 *
 * A container view opens laid out — cards apart, the system drawn as a boundary — and opening it writes
 * nothing. The first nudge makes the default arrangement the view's own: a layered constraint and one
 * offset, never coordinates for every card. And a rule broken in the model is marked on the cards it
 * involves, with its reason.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/FoodDelivery', import.meta.url));

let root: string;
const read = (relative: string) => readFile(join(root, relative), 'utf8');
const exists = (relative: string) => read(relative).then(() => true, () => false);

async function openContainers(page: Page) {
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
  await page.goto('/#view=view_containers');
  // Cards waiting for the layout are drawn transparent; the view is ready when none is waiting.
  await expect(page.locator('.react-flow__node', { hasText: 'Order Service' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.react-flow__node.stemma-layout-pending')).toHaveCount(0, { timeout: 30_000 });
  // The view is fitted once it is laid out, a moment later: a card grabbed before that is not where it was.
  const viewport = () => page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  let last = '';
  await expect.poll(async () => { const now = await viewport(); const still = now === last; last = now; return still; },
    { timeout: 10_000, intervals: [250] }).toBe(true);
}

/** Every card's box on screen, frames left out. */
async function cardBoxes(page: Page) {
  return page.locator('.react-flow__node').evaluateAll((nodes) => nodes
    .filter((n) => !n.querySelector('.stemma-bc-frame'))
    .map((n) => { const r = n.getBoundingClientRect(); return { id: (n as HTMLElement).dataset.id!, x: r.x, y: r.y, w: r.width, h: r.height }; }));
}

test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stemma-layered-'));
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(root, { recursive: true, force: true });
});

test('a container view nobody arranged opens laid out, inside its boundary, and opening it writes nothing', async ({ page }) => {
  await openContainers(page);

  const boxes = await cardBoxes(page);
  expect(boxes.length).toBe(17);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} and ${b.id} overlap`).toBe(false);
    }
  }
  await expect(page.locator('.stemma-system-frame')).toHaveCount(1);
  await expect(page.locator('.stemma-system-frame')).toContainText('Dishwise Platform');
  expect(await exists('stemma.layout.json'), 'opening a view writes no sidecar').toBe(false);
});

test('the first nudge writes the layered layout and one offset, not a position for every card', async ({ page }) => {
  await openContainers(page);
  const card = page.locator('.react-flow__node', { hasText: 'Event Bus' });
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 12, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => exists('stemma.layout.json'), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => {
    const view = JSON.parse(await read('stemma.layout.json')).views?.['custom:view_containers'];
    return { layout: view?.layout, offsets: Object.keys(view?.offsets ?? {}), nodes: Object.keys(view?.nodes ?? {}).length };
  }, { timeout: 10_000 }).toEqual({ layout: { kind: 'layered' }, offsets: ['cnt_bus'], nodes: 0 });
});

test('a rule the model breaks is marked on its cards and named with its reason', async ({ page }) => {
  // A client reading a database directly, which the sample's rules forbid.
  const model = join(root, 'Architecture', 'Architecture.cs');
  const source = await readFile(model, 'utf8');
  await writeFile(model, source
    .replace('        Tag.For(dispatch,', '        var peek = new DataFlow("flow_peek", "cnt_customer_app", "cnt_orders_db", "reads history", Technology: "SQL");\n\n        Tag.For(dispatch,')
    .replace('track, eta, card, send);', 'track, eta, card, send, peek);'));

  await openContainers(page);
  await page.getByText('Validation', { exact: true }).click();
  await expect(page.getByText('Customer App → Orders DB (flow_peek) is not allowed — Every client call is authenticated at the gateway')).toBeVisible({ timeout: 15_000 });
});
