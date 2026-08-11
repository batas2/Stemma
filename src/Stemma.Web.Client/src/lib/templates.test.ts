import { describe, it, expect } from 'vitest';
import {
  TEMPLATES, applyTemplate, boxCount, findTemplate,
  type TemplateElement, type TemplateLink, type TemplateRunner, type WorkspaceTemplate,
} from './templates';

/**
 * A template is a script of operations, and the interesting part is the ordering and the ref
 * mapping — the engine assigns ids as it writes, so nothing here may assume one in advance.
 */

/** `refusing` names refs the fake engine will not create, so the recording still happens for them. */
function recordingRunner(refusing: string[] = []) {
  const added: Array<{ ref: string; parentId?: string }> = [];
  const linked: Array<{ from: string; to: string }> = [];
  let placed: Record<string, { x: number; y: number }> = {};
  let n = 0;
  const runner: TemplateRunner = {
    addElement: async (element: TemplateElement, parentId?: string) => {
      added.push({ ref: element.ref, parentId });
      if (refusing.includes(element.ref)) return null;
      return `id_${++n}`;
    },
    addLink: async (_link: TemplateLink, from: string, to: string) => { linked.push({ from, to }); return true; },
    place: (positions) => { placed = positions; },
  };
  return { runner, added, linked, placed: () => placed };
}

const nested: WorkspaceTemplate = {
  id: 't', name: 'T', summary: '',
  elements: [
    { ref: 'child', kind: 'container', name: 'API', parent: 'sys', x: 10, y: 20 },
    { ref: 'sys', kind: 'softwareSystem', name: 'Platform', x: 0, y: 0 },
  ],
  links: [{ from: 'sys', to: 'child', kind: 'dataFlow' }],
};

describe('the shipped templates', () => {
  it('are all findable by the id the picker passes', () => {
    for (const t of TEMPLATES) expect(findTemplate(t.id)).toBe(t);
  });

  it('stay within the seven boxes every workspace brief teaches', () => {
    // A starter model that opens on a busy canvas teaches the wrong lesson on the first screen.
    for (const t of TEMPLATES) expect(boxCount(t)).toBeLessThanOrEqual(7);
  });

  it('only ever link elements they actually create', () => {
    // A link whose endpoint is missing is not drawn and reports nothing — the exact failure a
    // first-run user cannot diagnose.
    for (const t of TEMPLATES) {
      const refs = new Set(t.elements.map((e) => e.ref));
      for (const l of t.links) {
        expect(refs.has(l.from), `${t.id}: ${l.from}`).toBe(true);
        expect(refs.has(l.to), `${t.id}: ${l.to}`).toBe(true);
      }
    }
  });

  it('only nest inside a parent they actually create', () => {
    for (const t of TEMPLATES) {
      const refs = new Set(t.elements.map((e) => e.ref));
      for (const e of t.elements) if (e.parent) expect(refs.has(e.parent), `${t.id}: ${e.parent}`).toBe(true);
    }
  });

  it('give every element its own place, so nothing lands in a pile at 0,0', () => {
    for (const t of TEMPLATES) {
      const seen = new Set(t.elements.map((e) => `${e.x},${e.y}`));
      expect(seen.size, t.id).toBe(t.elements.length);
    }
  });

  it('use distinct refs and distinct names within a template', () => {
    for (const t of TEMPLATES) {
      expect(new Set(t.elements.map((e) => e.ref)).size, t.id).toBe(t.elements.length);
      expect(new Set(t.elements.map((e) => e.name)).size, t.id).toBe(t.elements.length);
    }
  });

  it('are described in the picker by what you get', () => {
    for (const t of TEMPLATES) expect(t.summary.length).toBeGreaterThan(10);
  });
});

describe('applying one', () => {
  it('creates parents before the children that need their id', async () => {
    const { runner, added } = recordingRunner();

    await applyTemplate(nested, runner);

    expect(added.map((a) => a.ref)).toEqual(['sys', 'child']);
    expect(added[1].parentId).toBe('id_1');
  });

  it('links by the ids the engine assigned, never by the template refs', async () => {
    const { runner, linked } = recordingRunner();

    await applyTemplate(nested, runner);

    expect(linked).toEqual([{ from: 'id_1', to: 'id_2' }]);
  });

  it('places every element it created, keyed by real id', async () => {
    const { runner, placed } = recordingRunner();

    await applyTemplate(nested, runner);

    expect(placed()).toEqual({ id_1: { x: 0, y: 0 }, id_2: { x: 10, y: 20 } });
  });

  it('reports what it managed to do', async () => {
    const { runner } = recordingRunner();

    const outcome = await applyTemplate(nested, runner);

    expect(outcome).toMatchObject({ elementsAdded: 2, linksAdded: 1, failed: [] });
    expect(outcome.ids).toEqual({ sys: 'id_1', child: 'id_2' });
  });

  it('skips a child whose parent could not be created', async () => {
    // Otherwise it lands claiming a parent that is not in the file — a dangling reference the
    // compiler will not catch and the canvas will not draw.
    const { runner, added } = recordingRunner(['sys']);

    const outcome = await applyTemplate(nested, runner);

    // The child is never even attempted, so nothing dangling reaches the file.
    expect(added.map((a) => a.ref)).toEqual(['sys']);
    expect(outcome.failed).toEqual(['sys', 'child']);
    expect(outcome.elementsAdded).toBe(0);
  });

  it('skips a link whose endpoint never appeared', async () => {
    const { runner, linked } = recordingRunner(['child']);

    const outcome = await applyTemplate(nested, runner);

    expect(linked).toEqual([]);
    expect(outcome.linksAdded).toBe(0);
  });

  it('still commits the arrangement when part of it failed', async () => {
    // A partial model that is laid out is recoverable; a partial model piled at the origin is not.
    const { runner, placed } = recordingRunner(['child']);

    await applyTemplate(nested, runner);

    expect(placed()).toEqual({ id_1: { x: 0, y: 0 } });
  });

  it('applies every shipped template end to end', async () => {
    for (const t of TEMPLATES) {
      const { runner } = recordingRunner();
      const outcome = await applyTemplate(t, runner);
      expect(outcome.elementsAdded, t.id).toBe(t.elements.length);
      expect(outcome.linksAdded, t.id).toBe(t.links.length);
      expect(outcome.failed, t.id).toEqual([]);
    }
  });
});
