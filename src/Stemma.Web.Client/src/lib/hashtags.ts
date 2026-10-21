// In-text attributes: `#Key: value` (value runs to end of line or the next `#`) — and bare
// `#Flag`. The `#Key` form (no space after `#`) is deliberately distinct from a markdown
// heading (`# text`, with a space), so the two never collide.

import { RAW_INLINE } from './markdownDom';

/**
 * Where a tag may start: not inside a word, a URL or a colour. `…/Page#Owners: Team Blue` is a link
 * to a section and `color:#ef4444` a colour; read as tags, one became a custom property nobody wrote
 * and the other a chip.
 */
export const TAG_START = '(?<![\\w/:#.=?&-])';

const TAG = new RegExp(`${TAG_START}#([A-Za-z][\\w-]*)(?::[ \\t]*([^\\n#]*))?`, 'g');

/** Every hashtag in the text → its value (empty string for a bare `#Flag`). */
export function parseHashtags(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const re = new RegExp(TAG.source, 'g');
  // The editor's raw tags are markup, not text: a colour's hex code is not a tag, and a value
  // written in a colour is the words, not the tags around them.
  const plain = text.replace(RAW_INLINE, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain)) !== null) {
    out.push({ key: m[1], value: (m[2] ?? '').trim() });
  }
  return out;
}

/** Hashtags that carry a value → a custom-property record (`#owner: ABC` → `{ owner: 'ABC' }`).
 *  Bare flags (no value) are not synced — they live only as chips in the text. */
export function hashtagProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of parseHashtags(text)) {
    if (value) out[key] = value;
  }
  return out;
}

/** Detect a hashtag being typed immediately before `caret`: returns the partial key + the index
 *  of the `#`, or null. Used to drive autocomplete. */
export function hashtagAtCaret(text: string, caret: number): { partial: string; start: number } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '#') {
      const partial = text.slice(i + 1, caret);
      // Only while still typing the key (letters / digits / - / _), not after a space or colon.
      return /^[\w-]*$/.test(partial) ? { partial, start: i } : null;
    }
    if (!/[\w-]/.test(ch)) return null;
    i--;
  }
  return null;
}

/** Suggested keys for the `#` autocomplete: schema keys + already-used keys, matching `partial`. */
export function suggestKeys(schemaKeys: string[], existingKeys: string[], partial: string): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const k of [...schemaKeys, ...existingKeys]) {
    if (!seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); all.push(k); }
  }
  const p = partial.toLowerCase();
  return all.filter((k) => k.toLowerCase().startsWith(p)).slice(0, 8);
}
