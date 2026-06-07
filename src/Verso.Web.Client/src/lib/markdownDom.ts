// WYSIWYG bridge: markdown <-> contentEditable HTML. The editor manipulates HTML; we persist
// markdown so the on-disk/model format never changes. Supported marks: **bold**, *italic*,
// `code`, [text](url), and `- ` bullet lists. `#tags` stay literal text while editing (so their
// values remain freely editable) and render as chips only in read-only views (see notesMarkdown).

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMdToHtml(s: string): string {
  let t = escHtml(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

/** Markdown → HTML suitable for a contentEditable surface (block-per-line as <div>, lists as <ul>). */
export function mdToEditableHtml(md: string): string {
  if (!md.trim()) return '';
  const blocks: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (list) { blocks.push(`<${list.type}>${list.items.map((li) => `<li>${li}</li>`).join('')}</${list.type}>`); list = null; }
  };
  for (const line of md.split('\n')) {
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul) { if (list?.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } list.items.push(inlineMdToHtml(ul[1])); continue; }
    if (ol) { if (list?.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } list.items.push(inlineMdToHtml(ol[1])); continue; }
    flush();
    blocks.push(line.trim() === '' ? '<div><br></div>' : `<div>${inlineMdToHtml(line)}</div>`);
  }
  flush();
  return blocks.join('');
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'UL', 'OL']);

function inlineToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(inlineToMd).join('');
  switch (el.tagName) {
    case 'STRONG': case 'B': return inner ? `**${inner}**` : '';
    case 'EM': case 'I': return inner ? `*${inner}*` : '';
    case 'S': case 'STRIKE': case 'DEL': return inner ? `~~${inner}~~` : '';
    case 'CODE': return inner ? `\`${inner}\`` : '';
    case 'A': { const href = el.getAttribute('href') ?? ''; return href ? `[${inner}](${href})` : inner; }
    case 'BR': return '';
    default: return inner;
  }
}

/** Serialize the editor's DOM back to markdown. Tolerant of the flat block structure browsers
 *  produce in contentEditable (top-level <div>/<p> per line, <ul><li> for lists). */
export function editableHtmlToMd(root: HTMLElement): string {
  const top = Array.from(root.childNodes);
  const hasBlocks = top.some((n) => n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((n as HTMLElement).tagName));
  if (!hasBlocks) return inlineToMd(root).trim();

  const lines: string[] = [];
  for (const n of top) {
    if (n.nodeType === Node.TEXT_NODE) { const t = n.textContent ?? ''; if (t.trim()) lines.push(t); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      const ordered = el.tagName === 'OL';
      Array.from(el.children).forEach((li, i) => lines.push(`${ordered ? `${i + 1}.` : '-'} ${inlineToMd(li)}`.trimEnd()));
    } else {
      lines.push(inlineToMd(el));
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
