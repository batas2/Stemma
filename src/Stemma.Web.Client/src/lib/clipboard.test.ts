import { describe, expect, it } from 'vitest';
import {
  buildClip, clipText, copiedIds, copyName, pasteLook, pasteOrigin, planPaste, type CopyContext,
} from './clipboard';
import type { ArchModel } from './types';

const arch: ArchModel = {
  filePath: 'Architecture/Architecture.cs',
  elements: [
    { id: 'ctx_pay', name: 'Payments', kind: 'boundedContext', attributes: {} },
    { id: 'mod_auth', name: 'Authorise', kind: 'module', attributes: { contextId: 'ctx_pay' } },
    { id: 'mod_settle', name: 'Settle', kind: 'module', attributes: { contextId: 'ctx_pay' } },
    { id: 'sys_bank', name: 'Bank', kind: 'softwareSystem', attributes: {} },
    { id: 'cnt_gw', name: 'Gateway', kind: 'container', attributes: { systemId: 'sys_bank', kind: 'service' } },
    { id: 'risk_1', name: 'Bank is slow', kind: 'risk', attributes: { aboutId: 'cnt_gw' } },
    { id: 'per_1', name: 'Merchant', kind: 'person', attributes: { role: 'external' } },
  ],
  links: [
    { id: 'df_1', fromId: 'mod_auth', toId: 'mod_settle', kind: 'dataFlow', attributes: { payload: 'Authorised', direction: 'oneway' } },
    { id: 'dep_1', fromId: 'mod_settle', toId: 'cnt_gw', kind: 'dependency', attributes: { kind: 'calls' } },
  ],
  tags: [{ targetId: 'mod_auth', lifecycle: { status: 'target', phase: 'Q4', validFrom: null, validUntil: null }, ownership: { squad: 'Pay', domain: null } }],
};

const ctx: CopyContext = {
  viewKey: 'moduleMap',
  boxes: {
    ctx_pay: { x: 74, y: 48, w: 520, h: 200 },
    mod_auth: { x: 100, y: 100, w: 200, h: 90 },
    mod_settle: { x: 380, y: 120, w: 200, h: 90 },
    cnt_gw: { x: 700, y: 100, w: 200, h: 90 },
    risk_1: { x: 700, y: 300, w: 200, h: 90 },
  },
  nodeStyles: { mod_auth: { borderWidth: 3, borderStyle: 'dashed', fillColor: '#fde68a', width: 260, height: 120 } },
  edgeStyles: { df_1: { thickness: 3, lineStyle: 'solid', color: '#f00' } },
  customProps: { mod_auth: { tier: 'gold' } },
  note: (id) => (id === 'mod_auth' ? 'Checks the card' : ''),
};

describe('copiedIds', () => {
  it('takes the modules drawn inside a copied bounded context', () => {
    expect(copiedIds(arch, ['ctx_pay'])).toEqual(['ctx_pay', 'mod_auth', 'mod_settle']);
  });

  it('ignores ids that are not elements', () => {
    expect(copiedIds(arch, ['nope', 'per_1'])).toEqual(['per_1']);
  });
});

describe('buildClip', () => {
  it('keeps each element, its tags and its looks, and only the links between copied elements', () => {
    const clip = buildClip(arch, ['mod_auth', 'mod_settle'], ctx)!;
    expect(clip.elements.map((e) => e.id)).toEqual(['mod_auth', 'mod_settle']);
    expect(clip.links.map((l) => l.id)).toEqual(['df_1']); // dep_1 leaves the copy, so it stays behind
    const auth = clip.elements[0];
    expect(auth.lifecycle?.status).toBe('target');
    expect(auth.ownership?.squad).toBe('Pay');
    expect(auth.note).toBe('Checks the card');
    expect(auth.customProps).toEqual({ tier: 'gold' });
    // A copy is the size of what it copies.
    expect(auth.nodeStyle?.width).toBe(260);
    expect(clip.links[0].edgeStyle?.color).toBe('#f00');
  });

  it('remembers where each sat relative to the others', () => {
    const clip = buildClip(arch, ['mod_auth', 'mod_settle'], ctx)!;
    expect(clip.origin).toEqual({ x: 100, y: 100 });
    expect(clip.elements.map((e) => e.offset)).toEqual([{ x: 0, y: 0 }, { x: 280, y: 20 }]);
    expect(clip.size).toEqual({ w: 480, h: 110 });
  });

  it('lays out in a row what was not drawn on the view', () => {
    const clip = buildClip(arch, ['mod_auth', 'per_1'], ctx)!;
    const person = clip.elements.find((e) => e.id === 'per_1')!;
    expect(person.offset.y).toBeGreaterThan(90);
  });

  it('is nothing when nothing copyable is selected', () => {
    expect(buildClip(arch, [], ctx)).toBeNull();
  });

  it('reads as the names, one per line', () => {
    expect(clipText(buildClip(arch, ['mod_auth', 'mod_settle'], ctx)!)).toBe('Authorise\nSettle');
  });
});

describe('copyName', () => {
  it('says copy, and counts once that is taken', () => {
    expect(copyName('Settle', new Set())).toBe('Settle copy');
    expect(copyName('Settle', new Set(['Settle copy']))).toBe('Settle copy 2');
    expect(copyName('Settle', new Set(['Settle copy', 'Settle copy 2']))).toBe('Settle copy 3');
  });
});

describe('planPaste', () => {
  it('declares a context before its modules, and points them at the copy', () => {
    const plan = planPaste(buildClip(arch, ['ctx_pay'], ctx)!, arch, { at: { x: 0, y: 0 } });
    expect(plan.elements.map((e) => e.from)).toEqual(['ctx_pay', 'mod_auth', 'mod_settle']);
    expect(plan.elements[1].context).toEqual({ copied: 'ctx_pay' });
    expect(plan.elements.map((e) => e.name)).toEqual(['Payments copy', 'Authorise copy', 'Settle copy']);
  });

  it('keeps a reference to an element that was not copied, while it exists', () => {
    const plan = planPaste(buildClip(arch, ['risk_1', 'cnt_gw'], ctx)!, arch, { at: { x: 0, y: 0 } });
    const gw = plan.elements.find((e) => e.from === 'cnt_gw')!;
    const risk = plan.elements.find((e) => e.from === 'risk_1')!;
    expect(gw.system).toEqual({ existing: 'sys_bank' });
    expect(gw.containerKind).toBe('service');
    // The risk was copied with what it is about, so it is about the copy.
    expect(risk.about).toEqual({ copied: 'cnt_gw' });
  });

  it('drops a reference to an element the target model does not have', () => {
    const elsewhere: ArchModel = { ...arch, elements: arch.elements.filter((e) => e.id !== 'sys_bank' && e.id !== 'ctx_pay'), tags: [] };
    const plan = planPaste(buildClip(arch, ['cnt_gw', 'mod_auth'], ctx)!, elsewhere, { at: { x: 0, y: 0 } });
    expect(plan.elements.find((e) => e.from === 'cnt_gw')!.system).toBeNull();
    expect(plan.elements.find((e) => e.from === 'mod_auth')!.context).toBeNull();
  });

  it('lets where a module lands decide its context, as a drop does', () => {
    const clip = buildClip(arch, ['mod_auth'], ctx)!;
    const inside = planPaste(clip, arch, { at: { x: 10, y: 10 }, contextAt: () => 'ctx_pay' });
    const outside = planPaste(clip, arch, { at: { x: 2000, y: 2000 }, contextAt: () => null });
    expect(inside.elements[0].context).toEqual({ existing: 'ctx_pay' });
    expect(outside.elements[0].context).toBeNull();
  });

  it('asks where the middle of the box lands, not its corner', () => {
    const clip = buildClip(arch, ['mod_settle'], ctx)!;
    const asked: { x: number; y: number }[] = [];
    planPaste(clip, arch, { at: { x: 0, y: 0 }, contextAt: (p) => { asked.push(p); return null; } });
    expect(asked).toEqual([{ x: 100, y: 46 }]);
  });

  it('places each element by its offset from the copy\'s corner', () => {
    const plan = planPaste(buildClip(arch, ['mod_auth', 'mod_settle'], ctx)!, arch, { at: { x: 1000, y: 500 } });
    expect(plan.elements.map((e) => e.position)).toEqual([{ x: 1000, y: 500 }, { x: 1280, y: 520 }]);
  });

  it('carries each link kind\'s own attribute', () => {
    const plan = planPaste(buildClip(arch, ['mod_auth', 'mod_settle', 'cnt_gw'], ctx)!, arch, { at: { x: 0, y: 0 } });
    const flow = plan.links.find((l) => l.from === 'df_1')!;
    const dep = plan.links.find((l) => l.from === 'dep_1')!;
    expect(flow).toMatchObject({ kind: 'dataFlow', payload: 'Authorised', direction: 'oneway', dependencyKind: null });
    expect(dep).toMatchObject({ kind: 'dependency', dependencyKind: 'calls', payload: null });
  });

  it('keeps a person\'s role', () => {
    const plan = planPaste(buildClip(arch, ['per_1'], ctx)!, arch, { at: { x: 0, y: 0 } });
    expect(plan.elements[0].role).toBe('external');
  });
});

describe('pasteOrigin', () => {
  const clip = buildClip(arch, ['mod_auth'], ctx)!;

  it('cascades back onto the view it came from, a step further each time', () => {
    const at = (n: number) => pasteOrigin(clip, { viewKey: 'moduleMap', pasteCount: n, originalsOnScreen: true, viewportCentre: { x: 0, y: 0 } });
    expect(at(0)).toEqual({ x: 132, y: 132 });
    expect(at(1)).toEqual({ x: 164, y: 164 });
  });

  it('centres on what is on screen anywhere else', () => {
    const at = pasteOrigin(clip, { viewKey: 'custom:v1', pasteCount: 0, originalsOnScreen: true, viewportCentre: { x: 500, y: 300 } });
    expect(at).toEqual({ x: 500 - clip.size.w / 2, y: 300 - clip.size.h / 2 });
  });
});

describe('pasteLook', () => {
  it('takes the copied look and keeps the size of the box it lands on', () => {
    const look = { borderWidth: 3, borderStyle: 'dashed' as const, fillColor: '#000', width: 900, height: 900 };
    expect(pasteLook({ borderWidth: 1, borderStyle: 'solid', width: 120, height: 60 }, look))
      .toEqual({ borderWidth: 3, borderStyle: 'dashed', fillColor: '#000', width: 120, height: 60 });
    expect(pasteLook(undefined, look)).toEqual({ borderWidth: 3, borderStyle: 'dashed', fillColor: '#000' });
  });
});
