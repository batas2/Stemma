// A small, safe markdown renderer for element notes and book narratives, read-only. It draws what
// the rich editor writes (see markdownDom) and nothing else:
//
// Inline:  **bold**, *italic*, ~~strike~~, `code`, [links](http…), `#Key: value` attribute chips,
//          and the editor's few raw tags — <u>, <mark>, <sub>, <sup>, <br>, and a <span> whose style
//          is a colour or a highlight and nothing more.
// Blocks:  #/##/### headings, "> " quotes, ``` code, --- rules, "- " and "1." lists, "- [ ]" tasks,
//          and pipe tables.
//
// Everything else is escaped first, so no other markup in a note — from a pull request, an agent —
// ever reaches the page. A heading needs a space after its `#`s, so `#Key` stays a tag.

import { RAW_INLINE, unusedMarker } from './markdownDom';
import { TAG_START } from './hashtags';

function esc(s: string): string {
  // Quotes too: the text lands inside attribute values (a link's href), and an unescaped `"` there
  // ends the attribute and starts one of the author's choosing — an event handler, say. Notes and
  // book narratives come from the repository, so from pull requests and agents, not only from you.
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A link target that is a real http(s) URL, or null. */
function safeHref(raw: string): string | null {
  // `raw` is already escaped; parse what the author wrote, then hand back the escaped form.
  const unescaped = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try {
    const url = new URL(unescaped);
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/** The editor's raw tags, as drawn here: the same tags, a highlight with the app's own colours. */
function rawTag(tag: string): string {
  const lower = tag.toLowerCase();
  if (lower === '<mark>') return '<mark class="rounded-sm px-0.5 bg-amber-200/80 dark:bg-amber-400/30 text-inherit">';
  if (lower.startsWith('<br')) return '<br>';
  // The span's style passed RAW_INLINE: a colour or a highlight, nothing else, and no quote inside.
  return tag;
}

function inline(s: string): string {
  const marker = unusedMarker(s);
  const tags: string[] = [];
  let t = s.replace(RAW_INLINE, (tag) => { tags.push(tag); return `${marker}${tags.length - 1}${marker}`; });
  t = esc(t);
  // Attribute chips: `#Key` or `#Key: value`, done first so the value isn't re-processed. Not a `#`
  // inside a word or a URL — a link to a page's section is not a tag.
  t = t.replace(new RegExp(`${TAG_START}#([A-Za-z][\\w-]*)(?::[ \\t]*([^\\n#<]*))?`, 'g'), (_m, k: string, v?: string) => {
    const value = v?.trimEnd();
    return `<span class="inline-block align-baseline px-1 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">#${k}${value ? `:&nbsp;<b>${value}</b>` : ''}</span>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  t = t.replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-zinc-200 dark:bg-zinc-800">$1</code>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m: string, label: string, href: string) => {
    const safe = safeHref(href);
    return safe ? `<a class="text-indigo-500 underline" href="${safe}" target="_blank" rel="noreferrer">${label}</a>` : m;
  });
  return t.replace(new RegExp(`${marker}(\\d+)${marker}`, 'g'), (_m, i: string) => rawTag(tags[+i]));
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

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function isTableDelimiter(line: string): boolean {
  return /\|/.test(line) && /^[\s|:-]+$/.test(line) && /-/.test(line);
}

function table(lines: string[], start: number): { html: string; next: number } {
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  let j = start + 2;
  const rows: string[][] = [];
  while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') { rows.push(splitRow(lines[j])); j++; }
  const cell = (tag: 'th' | 'td', text: string, k: number) =>
    `<${tag} class="border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 align-top${tag === 'th' ? ' font-semibold' : ''}"${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(text)}</${tag}>`;
  const thead = `<thead><tr>${header.map((c, k) => cell('th', c, k)).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) => `<tr>${header.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody>`;
  return { html: `<table class="border-collapse text-left my-1">${thead}${tbody}</table>`, next: j };
}

// Sized from the text around them, so a heading suits a card, a header and the presenter alike.
const HEADING = ['', 'text-[1.2em] font-semibold leading-snug mt-1 first:mt-0', 'text-[1.1em] font-semibold leading-snug mt-1 first:mt-0', 'font-semibold mt-1 first:mt-0'];

export function renderNotes(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  let list: { tag: 'ul' | 'ol' | 'task'; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const open = list.tag === 'ol' ? '<ol class="list-decimal pl-4 space-y-0.5">'
      // Inline, because a card's own `.archnote ul` gives every list its bullets.
      : list.tag === 'task' ? '<ul class="pl-0.5 space-y-0.5" style="list-style:none">'
      : '<ul class="list-disc pl-4 space-y-0.5">';
    out.push(`${open}${list.items.map((li) => `<li>${li}</li>`).join('')}${list.tag === 'ol' ? '</ol>' : '</ul>'}`);
    list = null;
  };
  const item = (tag: 'ul' | 'ol' | 'task', html: string) => {
    if (list?.tag !== tag) { flush(); list = { tag, items: [] }; }
    list!.items.push(html);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      i++; // the closing fence
      out.push(`<pre class="my-1 px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800/80 font-mono text-[0.92em] whitespace-pre-wrap"><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flush();
      const { html, next } = table(lines, i);
      out.push(html);
      i = next;
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flush(); out.push('<hr class="my-1.5 border-zinc-300 dark:border-zinc-700">'); i++; continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level} class="${HEADING[level]}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote class="my-1 pl-2 border-l-2 border-indigo-300 dark:border-indigo-500/70 opacity-90">${quoted.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) { item('task', `${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2])}`); i++; continue; }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) { item('ul', inline(bullet[1])); i++; continue; }
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) { item('ol', inline(numbered[1])); i++; continue; }
    flush();
    out.push(line.trim() === '' ? '<div class="h-2"></div>' : `<p>${inline(line)}</p>`);
    i++;
  }
  flush();
  return out.join('');
}
