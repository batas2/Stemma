import { describe, it, expect } from 'vitest';
import { parseHashtags, hashtagProps, hashtagAtCaret, suggestKeys } from './hashtags';

describe('hashtag parsing', () => {
  it('extracts #Key: value attributes (value runs to end of line)', () => {
    expect(hashtagProps('Owned by #owner: Alice\n#status: current')).toEqual({
      owner: 'Alice',
      status: 'current',
    });
  });

  it('value runs to end of line or the next #', () => {
    expect(hashtagProps('#mitigation: add retry + backoff #state: open')).toEqual({
      mitigation: 'add retry + backoff',
      state: 'open',
    });
  });

  it('bare #flag has no value and is not synced to props', () => {
    expect(parseHashtags('this is #urgent')).toEqual([{ key: 'urgent', value: '' }]);
    expect(hashtagProps('this is #urgent')).toEqual({});
  });

  it('does NOT treat a markdown heading ("# text") as a tag', () => {
    expect(parseHashtags('# Heading with a space')).toEqual([]);
  });
});

describe('hashtag autocomplete', () => {
  it('detects a tag being typed at the caret', () => {
    expect(hashtagAtCaret('#ow', 3)).toEqual({ partial: 'ow', start: 0 });
  });

  it('fires immediately after the bare #', () => {
    expect(hashtagAtCaret('#', 1)).toEqual({ partial: '', start: 0 });
  });

  it('stops suggesting once a space or colon follows', () => {
    expect(hashtagAtCaret('#owner: ', 8)).toBeNull();
  });

  it('suggests schema + existing keys by prefix', () => {
    expect(suggestKeys(['owner', 'status', 'tech'], ['team'], 't')).toEqual(['tech', 'team']);
  });

  it('returns every key for an empty partial (just typed #)', () => {
    expect(suggestKeys(['owner', 'status'], [], '')).toEqual(['owner', 'status']);
  });

  it('de-duplicates schema vs existing keys case-insensitively', () => {
    expect(suggestKeys(['Owner'], ['owner'], 'o')).toEqual(['Owner']);
  });
});

// A colour the editor writes (`<span style="color:#ef4444">`) and a link to a page section
// (`…/Page#Owners: Team Blue`) both have a `#` followed by letters. Neither is a tag: one became a
// chip, the other a custom property nobody wrote.
describe('what is not a tag', () => {
  it('a colour\'s hex code', () => {
    expect(parseHashtags('<span style="color: #ef4444">red</span> and <span style="background-color:#fde68a">hi</span>')).toEqual([]);
  });

  it('a URL\'s fragment', () => {
    expect(hashtagProps('see https://wiki.example.com/Page#Owners: Team Blue\nmore')).toEqual({});
  });

  it('while a tag after either still is', () => {
    expect(hashtagProps('<span style="color:#ef4444">red</span> #owner: Perform')).toEqual({ owner: 'Perform' });
    expect(parseHashtags('(#urgent)')).toEqual([{ key: 'urgent', value: '' }]);
  });
});
