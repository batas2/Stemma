import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screencast } from './screencast';

/**
 * The demo, under a minute: a box renamed on the canvas, the `git diff` that made, and the report a
 * reader opens. Every frame is the real app on a scratch copy of AuroraRail, and the diff shown is
 * the one the edit actually produced, so the demo cannot claim more than the release does.
 *
 * Playwright records no pointer, so a drawn one follows the mouse; captions say what is happening.
 */

const SAMPLE = fileURLToPath(new URL('../../../../samples/AuroraRail', import.meta.url));
const OUT = fileURLToPath(new URL('../../../../dist/demo/', import.meta.url));
const FROM = 'Basket';
const TO = 'Shopping Basket';

let root: string;
let scratch: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Stemma', '-c', 'user.email=stemma@localhost', ...args], { cwd: root, encoding: 'utf8' });

/** Installed into every document the demo shows: the app, the diff and the report. */
const OVERLAY = () => {
  const install = () => {
    if (document.getElementById('demo-caption') || !document.body) return;
    const style = document.createElement('style');
    style.textContent = `
      #demo-caption { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 2147483647;
        white-space: nowrap; padding: 14px 26px; border-radius: 14px; background: rgba(15, 15, 20, 0.86); color: #fff;
        font: 600 23px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 0.005em;
        text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.25); opacity: 0; transition: opacity 260ms ease;
        pointer-events: none; }
      #demo-caption.on { opacity: 1; }
      #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 26px; height: 26px; pointer-events: none;
        transform: translate(-100px, -100px); }
      #demo-cursor::after { content: ''; position: absolute; left: -9px; top: -9px; width: 44px; height: 44px; border-radius: 50%;
        background: rgba(99, 102, 241, 0.28); transform: scale(0); transition: transform 160ms ease; }
      #demo-cursor.down::after { transform: scale(1); }`;
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-4 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.head.appendChild(style);
    document.body.append(caption, cursor);
    const at = sessionStorage.getItem('demo-cursor');
    if (at) cursor.style.transform = at;
  };
  addEventListener('mousemove', (e) => {
    install();
    const cursor = document.getElementById('demo-cursor');
    const t = `translate(${e.clientX}px, ${e.clientY}px)`;
    if (cursor) cursor.style.transform = t;
    try { sessionStorage.setItem('demo-cursor', t); } catch { /* file:// */ }
  }, true);
  addEventListener('mousedown', () => document.getElementById('demo-cursor')?.classList.add('down'), true);
  addEventListener('mouseup', () => document.getElementById('demo-cursor')?.classList.remove('down'), true);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install);
  else install();
  (window as unknown as { demoCaption: (text: string) => void }).demoCaption = (text: string) => {
    install();
    const el = document.getElementById('demo-caption')!;
    el.classList.remove('on');
    setTimeout(() => {
      el.textContent = text;
      if (text) el.classList.add('on');
    }, text && el.textContent ? 280 : 0);
  };
};

const say = (page: Page, text: string) => page.evaluate((t) => (window as unknown as { demoCaption: (t: string) => void }).demoCaption(t), text);
const hold = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Move the pointer to the middle of `target` the way a hand would. */
async function glide(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
}

async function click(page: Page, target: Locator) {
  await glide(page, target);
  await hold(page, 220);
  await target.click();
}

/** Zoom in under the pointer, a notch at a time, as a scroll wheel does. */
async function zoomIn(page: Page, notches: number) {
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -100);
    await hold(page, 90);
  }
}

function diffPage(diff: string) {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = diff.trimEnd().split('\n').map((line) => {
    const kind = /^(diff|index|---|\+\+\+)/.test(line) ? 'meta'
      : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
    return `<div class="${kind}">${escape(line) || '&nbsp;'}</div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>git diff</title><style>
    body { margin: 0; min-height: 100vh; background: #0d1117; color: #c9d1d9; display: flex; align-items: center; justify-content: center;
      font: 16px/1.6 "JetBrains Mono", "Cascadia Code", ui-monospace, monospace; }
    .term { width: 1180px; padding: 24px 28px 28px; margin-bottom: 90px; background: #161b22; border: 1px solid #30363d; border-radius: 12px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.45); font-size: 14.5px; }
    .term > div { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
    .bar { display: flex; gap: 8px; margin-bottom: 18px; } .bar i { width: 12px; height: 12px; border-radius: 50%; background: #30363d; }
    .prompt { color: #7ee787; } .meta { color: #8b949e; } .hunk { color: #79c0ff; }
    .add { color: #aff5b4; background: rgba(46,160,67,0.22); } .del { color: #ffdcd7; background: rgba(248,81,73,0.22); }
  </style></head><body><div class="term"><div class="bar"><i></i><i></i><i></i></div>`
    + `<div><span class="prompt">~/aurora-rail $</span> git diff</div>${rows}`
    + `<div>&nbsp;</div><div><span class="prompt">~/aurora-rail $</span> git status --short</div><div> M Architecture/Architecture.cs</div>`
    + `</div></body></html>`;
}

test.beforeEach(async ({ page }) => {
  scratch = await mkdtemp(join(tmpdir(), 'stemma-demo-'));
  root = join(scratch, 'aurora-rail');
  // Model-only, so the demo needs no SDK and builds nothing into the folder it is filming.
  await cp(SAMPLE, root, {
    recursive: true,
    filter: (src) => !/[\\/](bin|obj)([\\/]|$)/.test(src) && !src.endsWith('.csproj'),
  });
  git('init', '--quiet');
  git('add', '.');
  git('commit', '--quiet', '-m', 'AuroraRail');

  await page.addInitScript(OVERLAY);
  await page.request.post('/api/workspace/close');
  const opened = await page.request.post('/api/workspace/open', { data: { rootPath: root } });
  expect(opened.ok()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  await page.request.post('/api/workspace/close');
  await rm(scratch, { recursive: true, force: true });
});

test('a minute of Stemma', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });

  // The stage, set before recording: the purchase path, with the canvas to itself.
  await page.getByRole('button', { name: /^Views\s*\d*$/ }).first().click();
  await page.getByText('Buy a Journey', { exact: true }).click();
  const box = page.locator('.react-flow__node', { has: page.getByText(FROM, { exact: true }) }).first();
  await expect(box).toBeVisible();
  await page.locator('aside', { hasText: 'Workspace' }).getByTitle('Collapse', { exact: true }).click();
  await page.mouse.move(640, 420);
  await hold(page, 1000);
  const stop = await screencast(page);

  // The canvas is the code.
  await say(page, 'This diagram is a C# file in your repository.');
  await hold(page, 3000);
  await glide(page, box);
  await zoomIn(page, 6);
  await hold(page, 1400);

  // An edit on the canvas.
  await say(page, 'Rename a box on the canvas…');
  await click(page, box);
  await click(page, page.getByRole('button', { name: 'Properties', exact: true }));
  const name = page.locator('li', { has: page.locator('label[title="Show Name on the canvas"]') })
    .locator('input:not([type=checkbox])').first();
  await expect(name).toHaveValue(FROM);
  await click(page, name);
  await name.press('ControlOrMeta+a');
  await name.pressSequentially(TO, { delay: 95 });
  await name.press('Enter');
  await expect(page.locator('.react-flow__node', { has: page.getByText(TO, { exact: true }) })).toBeVisible();
  await say(page, '…and Stemma renames it in Architecture.cs, the way your IDE would.');
  await hold(page, 3600);

  // The diff it made: the real one, and only the rename.
  const diff = git('diff', '--unified=1');
  expect(diff).toContain(`+        var modShoppingBasket = new Module("mod_basket", "${TO}"`);
  const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l));
  expect(changed.every((l) => /modBasket|"Basket"|modShoppingBasket|"Shopping Basket"/.test(l))).toBe(true);
  const diffFile = join(scratch, 'diff.html');
  await writeFile(diffFile, diffPage(diff));
  await page.goto(`file://${diffFile}`);
  await say(page, 'The diff is the rename, and nothing else moved.');
  await hold(page, 6500);

  // The report a reader opens.
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
  await say(page, 'Share it as one HTML file…');
  await hold(page, 900);
  await click(page, page.getByRole('button', { name: 'Export this view' }));
  const downloading = page.waitForEvent('download');
  await click(page, page.getByText('Architecture report (.html)'));
  const report = join(scratch, 'report.html');
  await (await downloading).saveAs(report);
  await hold(page, 600);
  await page.goto(`file://${report}`);
  await say(page, '…that anyone opens in a browser. Nothing to install.');
  await click(page, page.locator('.vr-navitem', { hasText: 'Buy a Journey' }));
  const card = page.locator('foreignObject', { has: page.getByText(TO, { exact: true }) }).first();
  await glide(page, card);
  await zoomIn(page, 7);
  await hold(page, 900);
  await click(page, card);
  await hold(page, 2600);
  await click(page, page.getByRole('button', { name: 'Stakeholder' }));
  await hold(page, 2200);

  await say(page, 'Stemma: the diagram is your code, and it round-trips.');
  await hold(page, 4500);

  await stop(join(OUT, 'stemma-demo'));
});
