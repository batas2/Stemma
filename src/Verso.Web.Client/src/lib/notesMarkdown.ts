// A tiny, safe markdown renderer for element notes. Escapes HTML first, then applies a fixed
// set of inline + block transforms, so no user-authored HTML is ever injected. Supports
// **bold**, *italic*, `code`, [links](http…), bullet lists, and `#Key: value` attribute chips.
// Markdown headings are intentionally NOT supported — `#` is reserved for attribute tags.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  let t = esc(s);
  // Attribute chips: `#Key` or `#Key: value`. Done first so the value isn't re-processed.
  t = t.replace(/#([A-Za-z][\w-]*)(?::[ \t]*([^\n<]*))?/g, (_m, k: string, v?: string) =>
    `<span class="inline-block align-baseline px-1 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">#${k}${v ? `:&nbsp;<b>${v}</b>` : ''}</span>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-zinc-200 dark:bg-zinc-800">$1</code>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="text-indigo-500 underline" href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}

/** Plain, compact text for showing notes inside a canvas node: drops #tags and markdown markers. */
export function notePreview(md: string, max = 160): string {
  const text = md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')               // [label](url) → label
    .replace(/#([A-Za-z][\w-]*)(?::[ \t]*[^\n#]*)?/g, '')  // #tag / #tag: value → ''
    .replace(/[*_`#>]+/g, '')                               // emphasis / code / quote markers
    .replace(/^\s*[-+]\s+/gm, '')                           // list bullets
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function renderNotes(md: string): string {
  const out: string[] = [];
  let inList = false;
  for (const line of md.split('\n')) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul class="list-disc pl-4 space-y-0.5">'); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (line.trim() === '') { out.push('<div class="h-2"></div>'); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
