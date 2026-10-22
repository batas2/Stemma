import { describe, expect, it } from 'vitest';
import { impliedCaption, linkCaption, linkLabel } from './linkLabel';

const flow = (payload: string, technology?: string) => ({ kind: 'dataFlow' as const, attributes: { payload, ...(technology ? { technology } : {}) } });

describe('linkCaption (ADR-0027)', () => {
  it('reads a data flow as C4 does: what moves, then how', () => {
    expect(linkCaption(flow('places orders', 'HTTPS/JSON'))).toBe('places orders [HTTPS/JSON]');
  });

  it('leaves the editable label alone, so an inline edit never writes the technology into the payload', () => {
    expect(linkLabel(flow('places orders', 'HTTPS/JSON'))).toBe('places orders');
  });

  it('says only the technology when there is no payload, and only the payload when there is no technology', () => {
    expect(linkCaption(flow('', 'gRPC'))).toBe('[gRPC]');
    expect(linkCaption(flow('orders'))).toBe('orders');
  });

  it('gives a dependency no technology: it has none', () => {
    expect(linkCaption({ kind: 'dependency', attributes: { kind: 'calls', technology: 'x' } })).toBe('calls');
  });
});

describe('impliedCaption', () => {
  it('says each thing once, two in full, then a count', () => {
    expect(impliedCaption([flow('uses'), flow('uses')])).toBe('uses');
    expect(impliedCaption([flow('uses'), flow('pays', 'HTTPS')])).toBe('uses · pays [HTTPS]');
    expect(impliedCaption([flow('a'), flow('b'), flow('c'), flow('d')])).toBe('a · b +2');
  });
});
