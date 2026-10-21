import { describe, expect, it } from 'vitest';
import { facets, matches, parseQuery, spotlightLighting, toggleToken, type CardFacts } from './spotlight';

const card = (over: Partial<CardFacts> & { name: string; kind?: CardFacts['element']['kind'] }): CardFacts => ({
  element: { id: over.name.toLowerCase().replace(/\s/g, '_'), name: over.name, kind: over.kind ?? 'module', attributes: {} },
  ...over,
});

const auth = card({
  name: 'Authorise', place: 'Payments',
  tag: { targetId: 'authorise', lifecycle: { status: 'target', phase: 'Q4', validFrom: null, validUntil: null }, ownership: { squad: 'Core', domain: 'Pay' } },
  note: 'Checks the card with the issuer', props: { pci: 'yes' },
});
const gw = card({ name: 'Bank Gateway', kind: 'container', place: 'Bank', tag: { targetId: 'gw', lifecycle: { status: 'current', phase: null, validFrom: null, validUntil: null }, ownership: { squad: 'Edge', domain: null } } });

describe('parseQuery', () => {
  it('reads words, fields, tags and quoted phrases', () => {
    expect(parseQuery('status:target #pci "bank gateway" owner:core card')).toEqual([
      { field: 'status', value: 'target' },
      { field: 'tag', value: 'pci' },
      { field: null, value: 'bank gateway' },
      { field: 'squad', value: 'core' },
      { field: null, value: 'card' },
    ]);
  });

  it('treats an unknown key as an ordinary word', () => {
    expect(parseQuery('http://x')).toEqual([{ field: null, value: 'http://x' }]);
  });
});

describe('matches', () => {
  const q = (s: string) => parseQuery(s);

  it('finds a word anywhere a card speaks of itself — name, place, notes, properties', () => {
    expect(matches(auth, q('autho'))).toBe(true);
    expect(matches(auth, q('payments'))).toBe(true);
    expect(matches(auth, q('issuer'))).toBe(true);
    expect(matches(auth, q('pci'))).toBe(true);
    expect(matches(gw, q('issuer'))).toBe(false);
  });

  it('narrows a word to one field', () => {
    expect(matches(auth, q('status:target'))).toBe(true);
    expect(matches(gw, q('status:target'))).toBe(false);
    expect(matches(gw, q('kind:container'))).toBe(true);
    expect(matches(auth, q('in:pay'))).toBe(true);
    expect(matches(auth, q('#pci'))).toBe(true);
    expect(matches(gw, q('#pci'))).toBe(false);
  });

  it('needs every word to match', () => {
    expect(matches(auth, q('squad:core status:target'))).toBe(true);
    expect(matches(auth, q('squad:core status:current'))).toBe(false);
  });

  it('matches nothing on an empty query', () => {
    expect(matches(auth, [])).toBe(false);
  });

  it('knows a kind by its words, too', () => {
    expect(matches(gw, q('kind:"software system"'))).toBe(false);
    expect(matches(card({ name: 'X', kind: 'useCase' }), q('"use case"'))).toBe(true);
  });
});

describe('facets', () => {
  it('offers the statuses, squads and kinds on the view, most common first', () => {
    const more = card({ name: 'Settle', tag: { targetId: 's', lifecycle: { status: 'target', phase: null, validFrom: null, validUntil: null }, ownership: null } });
    const f = facets([auth, gw, more]);
    expect(f.filter((x) => x.group === 'Status').map((x) => [x.label, x.count, x.token])).toEqual([['target', 2, 'status:target'], ['current', 1, 'status:current']]);
    expect(f.filter((x) => x.group === 'Kind').map((x) => x.label)).toEqual(['module', 'container']);
  });

  it('quotes a value with a space in it', () => {
    const f = facets([card({ name: 'A', tag: { targetId: 'a', lifecycle: null, ownership: { squad: 'Core Team', domain: null } } })]);
    expect(f.find((x) => x.group === 'Squad')?.token).toBe('squad:"core team"');
  });
});

describe('toggleToken', () => {
  it('adds a facet, and takes it out again', () => {
    expect(toggleToken('', 'status:target')).toBe('status:target');
    expect(toggleToken('card status:target', 'status:target')).toBe('card');
    expect(toggleToken('squad:"core team" x', 'squad:"core team"')).toBe('x');
  });
});

describe('spotlightLighting', () => {
  it('keeps the context a match sits in lit', () => {
    const lit = spotlightLighting(['m'], [{ id: 'm', name: 'M', kind: 'module', attributes: { contextId: 'ctx' } }]);
    expect([...lit]).toEqual(['m', 'ctx']);
  });
});
