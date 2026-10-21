// @vitest-environment happy-dom
// Reading a note wrote every note to localStorage: each read of a section copied the whole section
// into the browser's cache, and the canvas reads notes once per element. On a 290-element model
// that was 290 writes of the whole notes section — about 100 MB — on every change to a note, and
// typing in one froze the window for most of a second. A section is now written to the browser's
// cache when it changes, once, and never while it is being read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchLayout: vi.fn(),
  patchLayoutSidecar: vi.fn(async () => null),
}));

const ROOT = '/ws/notes';
const N = 200;

function manyNotes(): Record<string, string> {
  const notes: Record<string, string> = {};
  for (let i = 0; i < N; i++) notes[`e${i}`] = `Note ${i} #owner: Team`;
  return notes;
}

async function session(file: unknown) {
  vi.resetModules();
  const api = vi.mocked(await import('./api'));
  vi.clearAllMocks();
  api.patchLayoutSidecar.mockResolvedValue(null);
  api.fetchLayout.mockImplementation(async () => structuredClone(file));
  const layout = await import('./layout');
  const notes = await import('./elementNotes');
  const styles = await import('./nodeStyles');
  return { api, layout, notes, styles };
}

let writes: string[] = [];
const setItem = Storage.prototype.setItem;

beforeEach(() => {
  localStorage.clear();
  writes = [];
  Storage.prototype.setItem = function (key: string, value: string) { writes.push(key); return setItem.call(this, key, value); };
});
afterEach(() => { Storage.prototype.setItem = setItem; });

describe('the browser\'s copy of a section', () => {
  it('is not written while notes are read, however many', async () => {
    const s = await session({ version: 1, views: {}, notes: manyNotes() });
    await s.layout.primeLayoutSidecar(ROOT);
    writes = [];

    for (let i = 0; i < N; i++) s.notes.loadNote(ROOT, `e${i}`);
    s.notes.loadNotes(ROOT);
    s.styles.loadNodeStyles(ROOT);

    expect(writes).toEqual([]);
  });

  it('is written once when the sidecar is read, so the next open draws it', async () => {
    const s = await session({ version: 1, views: {}, notes: { e1: 'From the file.' } });
    localStorage.setItem(`stemma.notes:${ROOT}`, JSON.stringify({ e1: 'Stale.', e2: 'Removed by a teammate.' }));
    writes = [];
    await s.layout.primeLayoutSidecar(ROOT);

    expect(writes.filter((k) => k === `stemma.notes:${ROOT}`)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`stemma.notes:${ROOT}`)!)).toEqual({ e1: 'From the file.' });
  });

  it('is written once for each note saved', async () => {
    const s = await session({ version: 1, views: {}, notes: manyNotes() });
    await s.layout.primeLayoutSidecar(ROOT);
    writes = [];

    s.notes.saveNote(ROOT, 'e3', 'Typed.');

    expect(writes.filter((k) => k.startsWith('stemma.notes:'))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`stemma.notes:${ROOT}`)!).e3).toBe('Typed.');
  });

  it('is what is drawn before the sidecar is read, with what was saved meanwhile', async () => {
    localStorage.setItem(`stemma.notes:${ROOT}`, JSON.stringify({ e1: 'Remembered.' }));
    const s = await session({ version: 1, views: {} });
    s.api.fetchLayout.mockReturnValue(new Promise(() => {}));
    void s.layout.primeLayoutSidecar(ROOT);

    s.notes.saveNote(ROOT, 'e2', 'Typed while it loads.');

    expect(s.notes.loadNotes(ROOT)).toEqual({ e1: 'Remembered.', e2: 'Typed while it loads.' });
    expect(JSON.parse(localStorage.getItem(`stemma.notes:${ROOT}`)!)).toEqual({ e1: 'Remembered.', e2: 'Typed while it loads.' });
  });
});

describe('loadNotes', () => {
  it('is every note in one read', async () => {
    const s = await session({ version: 1, views: {}, notes: manyNotes() });
    await s.layout.primeLayoutSidecar(ROOT);

    const all = s.notes.loadNotes(ROOT);
    expect(Object.keys(all)).toHaveLength(N);
    expect(all.e7).toBe('Note 7 #owner: Team');
    // A copy: changing it changes nothing anyone else reads.
    all.e7 = 'changed';
    expect(s.notes.loadNote(ROOT, 'e7')).toBe('Note 7 #owner: Team');
  });
});
