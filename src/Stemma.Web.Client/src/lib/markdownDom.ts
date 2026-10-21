// WYSIWYG bridge: markdown <-> contentEditable HTML. The editor manipulates HTML; we persist
// markdown so the on-disk/model format never changes.
//
// Inline:  **bold**, *italic*, ~~strike~~, `code`, [text](url), plus raw inline HTML for the
//          things markdown has no syntax for: <u>underline</u>, <mark>highlight</mark> and
//          <span style="color:…|background-color:…">coloured</span>.
// Blocks:  #/##/### headings, "> " blockquote, ``` fenced code, --- rule, "- "/"1." lists,
//          "- [ ]"/"- [x]" task lists, and GFM pipe tables.
// #tags stay literal text while editing (so values remain freely editable) and render as chips
// only in read-only views (see notesMarkdown).

// Quotes too: this HTML is assigned to innerHTML, and a link's URL goes inside an attribute. With `"`
// left as it was, `[x](https://a/"onmouseover="…)` closed the href and opened a handler — a script in
// a note anyone could commit, run by whoever selected the element.
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

// Inline HTML we pass through verbatim (colour / highlight / underline live as HTML in the md).
// The span carries a colour or a highlight and nothing else: a style with `url(…)` made the editor fetch
// from any server, and `position:fixed` let a note cover the screen.
// The read-only renderer (notesMarkdown) and the tag parser (hashtags) use the same rule, so all
// three agree on what in a note is markup.
export const RAW_INLINE = /<\/?(?:u|mark|sub|sup)>|<span style="(?:\s*(?:color|background-color)\s*:\s*(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\(\s*[\d.\s,%]+\))\s*;?)+">|<\/span>|<br\s*\/?>/gi;

/**
 * A character the text does not contain, to mark where a raw tag was taken out while the rest is
 * escaped and formatted.
 */
export function unusedMarker(text: string): string {
  let code = 0xe000; // the private use area: nobody types these, and if someone has, the next one
  while (text.includes(String.fromCharCode(code))) code++;
  return String.fromCharCode(code);
}

function inlineMdToHtml(s: string): string {
  // Not a fixed marker: one the text could hold drew "undefined", or put a tag in its place.
  const marker = unusedMarker(s);
  const tokens: string[] = [];
  const protectedStr = s.replace(RAW_INLINE, (m) => { tokens.push(m); return `${marker}${tokens.length - 1}${marker}`; });
  let t = escHtml(protectedStr);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(new RegExp(`${marker}(\\d+)${marker}`, 'g'), (_, i) => tokens[+i]);
  return t;
}

type ListAcc =
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'task'; items: { checked: boolean; html: string }[] };

function renderList(list: ListAcc): string {
  if (list.type === 'task') {
    return `<ul data-task="true">${list.items.map((it) =>
      `<li data-task="true"><span class="task-box" contenteditable="false" data-checked="${it.checked}">${it.checked ? '☑' : '☐'}</span> ${it.html}</li>`).join('')}</ul>`;
  }
  return `<${list.type}>${list.items.map((li) => `<li>${li}</li>`).join('')}</${list.type}>`;
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

function parseTable(lines: string[], start: number): { html: string; next: number } {
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => {
    const t = c.trim();
    if (/^:-+:$/.test(t)) return 'center';
    if (/-+:$/.test(t)) return 'right';
    if (/^:-+$/.test(t)) return 'left';
    return '';
  });
  let j = start + 2;
  const rows: string[][] = [];
  while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') { rows.push(splitRow(lines[j])); j++; }
  const align = (k: number) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '');
  const thead = `<thead><tr>${header.map((c, k) => `<th${align(k)}>${inlineMdToHtml(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map((r) => `<tr>${header.map((_, k) => `<td${align(k)}>${inlineMdToHtml(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return { html: `<table>${thead}${tbody}</table>`, next: j };
}

/** Markdown → HTML suitable for a contentEditable surface. */
export function mdToEditableHtml(md: string): string {
  if (!md.trim()) return '';
  const lines = md.split('\n');
  const blocks: string[] = [];
  let list: ListAcc | null = null;
  const flush = () => { if (list) { blocks.push(renderList(list)); list = null; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {                                   // fenced code
      flush();
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push(`<pre data-lang="${escAttr(lang)}"><code>${escHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {  // GFM table
      flush();
      const { html, next } = parseTable(lines, i);
      blocks.push(html); i = next; continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flush(); blocks.push('<hr>'); i++; continue; }  // rule
    const h = /^(#{1,3})\s+(.*)$/.exec(line);                          // heading
    if (h) { flush(); blocks.push(`<h${h[1].length}>${inlineMdToHtml(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) {                                       // blockquote
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push(`<blockquote>${buf.map(inlineMdToHtml).join('<br>')}</blockquote>`);
      continue;
    }
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);          // task list
    if (task) {
      if (list?.type !== 'task') { flush(); list = { type: 'task', items: [] }; }
      (list as { type: 'task'; items: { checked: boolean; html: string }[] }).items.push({ checked: task[1].toLowerCase() === 'x', html: inlineMdToHtml(task[2]) });
      i++; continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);                          // bullet / ordered
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul) { if (list?.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } (list as { type: 'ul'; items: string[] }).items.push(inlineMdToHtml(ul[1])); i++; continue; }
    if (ol) { if (list?.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } (list as { type: 'ol'; items: string[] }).items.push(inlineMdToHtml(ol[1])); i++; continue; }

    flush();
    blocks.push(line.trim() === '' ? '<div><br></div>' : `<div>${inlineMdToHtml(line)}</div>`);
    i++;
  }
  flush();
  return blocks.join('');
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'UL', 'OL', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE']);

function inlineToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.classList?.contains('task-box')) return ''; // checkbox glyph isn't part of the text
  const inner = Array.from(el.childNodes).map(inlineToMd).join('');
  switch (el.tagName) {
    case 'STRONG': case 'B': return inner ? `**${inner}**` : '';
    case 'EM': case 'I': return inner ? `*${inner}*` : '';
    case 'S': case 'STRIKE': case 'DEL': return inner ? `~~${inner}~~` : '';
    case 'U': return inner ? `<u>${inner}</u>` : '';
    case 'MARK': return inner ? `<mark>${inner}</mark>` : '';
    case 'CODE': return inner ? `\`${inner}\`` : '';
    case 'A': { const href = el.getAttribute('href') ?? ''; return href ? `[${inner}](${href})` : inner; }
    case 'SPAN': {
      const style = el.getAttribute('style') ?? '';
      if (/text-decoration\s*:\s*[^;]*underline/.test(style)) return inner ? `<u>${inner}</u>` : '';
      if (/(?:^|[^-])color\s*:|background(?:-color)?\s*:/.test(style)) return inner ? `<span style="${escAttr(style)}">${inner}</span>` : '';
      return inner;
    }
    case 'BR': return '';
    default: return inner;
  }
}

/** Inline serializer that turns <br> into newlines (for blockquote multi-line). */
function blockInlineToMd(el: HTMLElement): string {
  return Array.from(el.childNodes).map((n) =>
    n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR' ? '\n' : inlineToMd(n)).join('');
}

function tableToMd(table: HTMLTableElement): string[] {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return [];
  const cellText = (r: HTMLTableRowElement) => Array.from(r.cells).map((c) => inlineToMd(c).replace(/\|/g, '\\|').trim());
  const header = cellText(rows[0]);
  const out = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (let i = 1; i < rows.length; i++) out.push(`| ${cellText(rows[i]).join(' | ')} |`);
  return out;
}

/** Serialize the editor's DOM back to markdown. Tolerant of the flat block structure browsers
 *  produce in contentEditable (top-level <div>/<p> per line, lists, headings, tables, …). */
export function editableHtmlToMd(root: HTMLElement): string {
  const top = Array.from(root.childNodes);
  const hasBlocks = top.some((n) => n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((n as HTMLElement).tagName));
  if (!hasBlocks) return inlineToMd(root).trim();

  const lines: string[] = [];
  for (const n of top) {
    if (n.nodeType === Node.TEXT_NODE) { const t = n.textContent ?? ''; if (t.trim()) lines.push(t); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    switch (el.tagName) {
      case 'H1': lines.push(`# ${inlineToMd(el)}`.trimEnd()); break;
      case 'H2': lines.push(`## ${inlineToMd(el)}`.trimEnd()); break;
      case 'H3': lines.push(`### ${inlineToMd(el)}`.trimEnd()); break;
      case 'HR': lines.push('---'); break;
      case 'BLOCKQUOTE':
        blockInlineToMd(el).split('\n').forEach((l) => lines.push(`> ${l}`.trimEnd()));
        break;
      case 'PRE': {
        const lang = el.getAttribute('data-lang') ?? '';
        lines.push('```' + lang);
        (el.textContent ?? '').replace(/\n$/, '').split('\n').forEach((l) => lines.push(l));
        lines.push('```');
        break;
      }
      case 'TABLE': lines.push(...tableToMd(el as HTMLTableElement)); break;
      case 'UL': case 'OL': {
        const ordered = el.tagName === 'OL';
        const isTask = el.getAttribute('data-task') === 'true'
          || Array.from(el.children).some((li) => (li as HTMLElement).getAttribute('data-task') === 'true' || (li as HTMLElement).querySelector('.task-box'));
        Array.from(el.children).forEach((li, idx) => {
          if (isTask) {
            const box = (li as HTMLElement).querySelector('.task-box');
            const checked = box?.getAttribute('data-checked') === 'true';
            lines.push(`- [${checked ? 'x' : ' '}] ${inlineToMd(li).trim()}`.trimEnd());
          } else {
            lines.push(`${ordered ? `${idx + 1}.` : '-'} ${inlineToMd(li)}`.trimEnd());
          }
        });
        break;
      }
      default: lines.push(inlineToMd(el));
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
