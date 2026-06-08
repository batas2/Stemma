import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Code, List, ListOrdered, ListChecks, Link2,
  Quote, Table, Minus, Palette, Highlighter, Eraser, PenLine, Code2, X,
} from 'lucide-react';
import clsx from 'clsx';
import type { ArchElementKind } from '@/lib/types';
import { schemaFor } from '@/lib/propertySchema';
import { hashtagAtCaret, suggestKeys } from '@/lib/hashtags';
import { mdToEditableHtml, editableHtmlToMd } from '@/lib/markdownDom';

interface Props {
  value: string;
  kind: ArchElementKind;
  existingKeys: string[];
  onChange: (md: string) => void;
  /** Persist / reflect attributes — fired on blur and on close. Does NOT close the editor. */
  onCommit?: (md: string) => void;
  /** Explicit close (the × button / Escape). */
  onClose?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  toolbar?: boolean;
  /** Turbo toolbar (headings, colour, highlight, quote, code block, tables, task lists, rule). */
  rich?: boolean;
  className?: string;
}

type Mode = 'rich' | 'code';
interface Auto { items: string[]; index: number; left: number; top: number; }

const TEXT_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#6b7280'];
const HILITE_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff', '#fed7aa', '#fecaca'];

/** Inline WYSIWYG editor with a raw-Markdown source mode. You edit formatted text directly;
 *  markdown is the stored format (serialized on every change). The rich surface is uncontrolled —
 *  we only rewrite its DOM when `value` changes from the outside, so the caret never jumps while
 *  typing. Safe inside React Flow (keys/drag/wheel don't escape; toolbar presses don't blur). */
export function RichTextEditor({
  value, kind, existingKeys, onChange, onCommit, onClose, autoFocus,
  placeholder = 'Write text…  type # for attributes', toolbar = true, rich = false, className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastMd = useRef(value);
  const [mode, setMode] = useState<Mode>('rich');
  const [codeText, setCodeText] = useState(value);
  const [empty, setEmpty] = useState(!value.trim());
  const [auto, setAuto] = useState<Auto | null>(null);
  const [palette, setPalette] = useState<'color' | 'highlight' | null>(null);
  const schemaKeys = schemaFor(kind).map((p) => p.key);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = mdToEditableHtml(value);
    lastMd.current = value;
    try { document.execCommand('styleWithCSS', false, 'false'); } catch { /* legacy flag */ }
    if (autoFocus) { el.focus(); placeCaretEnd(el); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External updates (element switch, live mirror). Never runs for our own edits.
  useLayoutEffect(() => {
    if (value === lastMd.current) return;
    lastMd.current = value;
    setEmpty(!value.trim());
    if (mode === 'rich') { if (ref.current) ref.current.innerHTML = mdToEditableHtml(value); }
    else setCodeText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function pushMd(md: string) {
    lastMd.current = md;
    setEmpty(!md.trim());
    onChange(md);
  }

  function emit() {
    if (ref.current) pushMd(editableHtmlToMd(ref.current));
  }

  function refreshAuto() {
    const el = ref.current;
    const sel = window.getSelection();
    if (mode !== 'rich' || !el || !sel || sel.rangeCount === 0) { setAuto(null); return; }
    const range = sel.getRangeAt(0);
    if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) { setAuto(null); return; }
    const textBefore = (range.startContainer.textContent ?? '').slice(0, range.startOffset);
    const hit = hashtagAtCaret(textBefore, textBefore.length);
    if (!hit) { setAuto(null); return; }
    const items = suggestKeys(schemaKeys, existingKeys, hit.partial);
    if (items.length === 0) { setAuto(null); return; }
    const rect = range.getBoundingClientRect();
    setAuto({ items, index: 0, left: rect.left || 0, top: (rect.bottom || rect.top) + 2 });
  }

  function choose(key: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const caret = range.startOffset;
    const m = /#([\w-]*)$/.exec((node.textContent ?? '').slice(0, caret));
    if (!m) return;
    const r = document.createRange();
    r.setStart(node, caret - m[0].length);
    r.setEnd(node, caret);
    r.deleteContents();
    const inserted = document.createTextNode(`#${key}: `);
    r.insertNode(inserted);
    sel.removeAllRanges();
    const after = document.createRange();
    after.setStart(inserted, inserted.length);
    after.collapse(true);
    sel.addRange(after);
    setAuto(null);
    emit();
  }

  function closeEditor() {
    onCommit?.(lastMd.current);
    onClose?.();
  }

  function onRichKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation(); // React Flow must not see Backspace/Delete (would remove the node) etc.
    if (auto) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAuto({ ...auto, index: (auto.index + 1) % auto.items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAuto({ ...auto, index: (auto.index - 1 + auto.items.length) % auto.items.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(auto.items[auto.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setAuto(null); return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); exec('bold'); return; }
    if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); exec('italic'); return; }
    if (mod && e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); exec('strikeThrough'); return; }
    if (e.key === 'Escape' && onClose) { e.preventDefault(); closeEditor(); }
  }

  function exec(command: string) {
    ref.current?.focus();
    try { document.execCommand(command); } catch { /* unsupported */ }
    emit();
  }

  function toggleCode() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed) return;
    const range = sel.getRangeAt(0);
    const code = document.createElement('code');
    code.appendChild(range.extractContents());
    range.insertNode(code);
    sel.removeAllRanges();
    const after = document.createRange();
    after.setStartAfter(code);
    after.collapse(true);
    sel.addRange(after);
    emit();
  }

  function addLink() {
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    ref.current?.focus();
    try { document.execCommand('createLink', false, url); } catch { /* unsupported */ }
    emit();
  }

  // ---- Rich (full-editor) commands ----
  function setBlock(tag: string) {
    ref.current?.focus();
    try { document.execCommand('formatBlock', false, tag); } catch { /* unsupported */ }
    emit();
  }
  function applyColor(which: 'fore' | 'back', color: string) {
    ref.current?.focus();
    try {
      document.execCommand('styleWithCSS', false, 'true');
      if (which === 'fore') document.execCommand('foreColor', false, color);
      else if (!document.execCommand('hiliteColor', false, color)) document.execCommand('backColor', false, color);
      document.execCommand('styleWithCSS', false, 'false');
    } catch { /* unsupported */ }
    setPalette(null);
    emit();
  }
  function insertHtml(html: string) {
    ref.current?.focus();
    try { document.execCommand('insertHTML', false, html); } catch { /* unsupported */ }
    emit();
  }
  function insertRule() { insertHtml('<hr><div><br></div>'); }
  function insertTaskList() {
    insertHtml('<ul data-task="true"><li data-task="true"><span class="task-box" contenteditable="false" data-checked="false">☐</span>&nbsp;</li></ul>');
  }
  function insertTable() {
    const td = '<td>&nbsp;</td>';
    const row = `<tr>${td}${td}${td}</tr>`;
    insertHtml(`<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody>${row}${row}</tbody></table><div><br></div>`);
  }
  function currentTable(): HTMLTableElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let n: Node | null = sel.getRangeAt(0).startContainer;
    while (n && n !== ref.current) {
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'TABLE') return n as HTMLTableElement;
      n = n.parentNode;
    }
    return null;
  }
  function addTableRow() {
    const t = currentTable();
    if (!t) return;
    const body = t.tBodies[0] ?? t.appendChild(document.createElement('tbody'));
    const cols = t.rows[0]?.cells.length ?? 2;
    const tr = body.insertRow(-1);
    for (let i = 0; i < cols; i++) tr.insertCell(-1).innerHTML = '&nbsp;';
    emit();
  }
  function addTableCol() {
    const t = currentTable();
    if (!t) return;
    Array.from(t.rows).forEach((r) => {
      const inHead = r.parentElement?.tagName === 'THEAD';
      const cell = document.createElement(inHead ? 'th' : 'td');
      cell.innerHTML = inHead ? 'Column' : '&nbsp;';
      r.appendChild(cell);
    });
    emit();
  }
  function clearFormat() {
    ref.current?.focus();
    try { document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'div'); } catch { /* unsupported */ }
    emit();
  }
  // Toggle a task-list checkbox when its glyph is clicked.
  function onEditorClick(e: React.MouseEvent) {
    const box = (e.target as HTMLElement)?.closest?.('.task-box') as HTMLElement | null;
    if (!box) return;
    const checked = box.getAttribute('data-checked') === 'true';
    box.setAttribute('data-checked', String(!checked));
    box.textContent = !checked ? '☑' : '☐';
    emit();
  }

  function showRich() {
    setMode('rich');
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.innerHTML = mdToEditableHtml(lastMd.current);
      el.focus();
      placeCaretEnd(el);
    });
  }
  function showCode() {
    setCodeText(lastMd.current);
    setAuto(null);
    setMode('code');
  }

  const fmt = mode === 'rich' && toolbar;
  return (
    // nodrag/nopan/nowheel + stopping pointerdown so React Flow never hijacks presses on the
    // toolbar buttons (otherwise a press starts a node drag/selection instead of clicking).
    <div
      className={clsx('relative flex flex-col min-h-0 nodrag nopan nowheel', className)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 mb-1 shrink-0">
        {fmt && !rich && (
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin min-w-0">
            <Tool onClick={() => exec('bold')} title="Bold (⌘B)"><Bold className="w-3 h-3" /></Tool>
            <Tool onClick={() => exec('italic')} title="Italic (⌘I)"><Italic className="w-3 h-3" /></Tool>
            <Tool onClick={() => exec('strikeThrough')} title="Strikethrough (⌘⇧X)"><Strikethrough className="w-3 h-3" /></Tool>
            <Tool onClick={toggleCode} title="Inline code"><Code className="w-3 h-3" /></Tool>
            <Tool onClick={() => exec('insertUnorderedList')} title="Bullet list"><List className="w-3 h-3" /></Tool>
            <Tool onClick={() => exec('insertOrderedList')} title="Numbered list"><ListOrdered className="w-3 h-3" /></Tool>
            <Tool onClick={addLink} title="Link"><Link2 className="w-3 h-3" /></Tool>
          </div>
        )}
        {fmt && rich && (
          <div className="flex flex-wrap items-center gap-0.5 min-w-0">
            <select
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => { setBlock(e.target.value); e.currentTarget.selectedIndex = 0; }}
              className="h-7 text-xs rounded border border-default bg-white dark:bg-zinc-900 px-1.5 text-body cursor-pointer"
              title="Paragraph format" defaultValue=""
            >
              <option value="" disabled>Format</option>
              <option value="div">Normal text</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="blockquote">Quote</option>
              <option value="pre">Code block</option>
            </select>
            <Sep />
            <Tool onClick={() => exec('bold')} title="Bold (⌘B)"><Bold className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={() => exec('italic')} title="Italic (⌘I)"><Italic className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={() => exec('underline')} title="Underline (⌘U)"><Underline className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={() => exec('strikeThrough')} title="Strikethrough (⌘⇧X)"><Strikethrough className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={toggleCode} title="Inline code"><Code className="w-3.5 h-3.5" /></Tool>
            <Sep />
            <div className="relative">
              <Tool onClick={() => setPalette(palette === 'color' ? null : 'color')} title="Text colour"><Palette className="w-3.5 h-3.5" /></Tool>
              {palette === 'color' && <Swatches colors={TEXT_COLORS} onPick={(c) => applyColor('fore', c)} onClose={() => setPalette(null)} />}
            </div>
            <div className="relative">
              <Tool onClick={() => setPalette(palette === 'highlight' ? null : 'highlight')} title="Highlight"><Highlighter className="w-3.5 h-3.5" /></Tool>
              {palette === 'highlight' && <Swatches colors={HILITE_COLORS} onPick={(c) => applyColor('back', c)} onClose={() => setPalette(null)} />}
            </div>
            <Sep />
            <Tool onClick={() => exec('insertUnorderedList')} title="Bullet list"><List className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={() => exec('insertOrderedList')} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={insertTaskList} title="Task list"><ListChecks className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={() => setBlock('blockquote')} title="Quote"><Quote className="w-3.5 h-3.5" /></Tool>
            <Sep />
            <Tool onClick={insertTable} title="Insert table"><Table className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={addTableRow} title="Add row (caret inside a table)"><span className="text-[10px] font-semibold px-0.5">+Row</span></Tool>
            <Tool onClick={addTableCol} title="Add column (caret inside a table)"><span className="text-[10px] font-semibold px-0.5">+Col</span></Tool>
            <Sep />
            <Tool onClick={addLink} title="Link"><Link2 className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={insertRule} title="Divider"><Minus className="w-3.5 h-3.5" /></Tool>
            <Tool onClick={clearFormat} title="Clear formatting"><Eraser className="w-3.5 h-3.5" /></Tool>
          </div>
        )}
        <span className="flex-1 min-w-0" />
        <div className="flex items-center gap-0.5 shrink-0 rounded-md border border-default p-0.5 bg-zinc-50 dark:bg-zinc-900/60">
          <ModeBtn active={mode === 'rich'} onClick={showRich} title="Rich text"><PenLine className="w-3 h-3" /></ModeBtn>
          <ModeBtn active={mode === 'code'} onClick={showCode} title="Markdown source"><Code2 className="w-3 h-3" /></ModeBtn>
        </div>
        {onClose && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); closeEditor(); }}
            title="Close editor (Esc)"
            className="shrink-0 p-1 rounded text-muted hover:text-body hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={() => { emit(); refreshAuto(); }}
          onKeyDown={onRichKeyDown}
          onKeyUp={refreshAuto}
          onMouseUp={refreshAuto}
          onClick={onEditorClick}
          onBlur={() => { window.setTimeout(() => setAuto(null), 150); onCommit?.(lastMd.current); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={clsx(
            'nodrag nopan nowheel archnote w-full h-full overflow-auto leading-relaxed outline-none bg-white dark:bg-zinc-900 border border-default rounded focus:border-indigo-500 text-zinc-900 dark:text-zinc-100',
            rich ? 'archnote-rich text-sm p-4' : 'text-xs p-2',
            mode !== 'rich' && 'hidden',
          )}
        />
        {mode === 'code' && (
          <textarea
            value={codeText}
            autoFocus
            onChange={(e) => { setCodeText(e.target.value); pushMd(e.target.value); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && onClose) { e.preventDefault(); closeEditor(); } }}
            onBlur={() => onCommit?.(lastMd.current)}
            placeholder="Write Markdown…  **bold**, ~~strike~~, - list, #owner: ABC"
            className="nodrag nopan nowheel w-full h-full resize-none font-mono text-[11px] leading-relaxed bg-zinc-50 dark:bg-zinc-950/60 border border-default rounded p-2 outline-none focus:border-indigo-500 text-zinc-900 dark:text-zinc-100"
          />
        )}
        {mode === 'rich' && empty && (
          <div className="pointer-events-none absolute left-2 top-2 text-xs text-zinc-400 dark:text-zinc-600 select-none">
            {placeholder}
          </div>
        )}
      </div>

      {auto && mode === 'rich' && (
        <ul className="fixed z-popover w-52 max-h-44 overflow-auto rounded surface-overlay text-xs py-1 shadow-lg" style={{ left: auto.left, top: auto.top }}>
          {auto.items.map((k, i) => (
            <li key={k}>
              <button
                type="button"
                onMouseDown={(ev) => { ev.preventDefault(); choose(k); }}
                className={clsx(
                  'w-full text-left px-2 py-1 font-mono',
                  i === auto.index ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                )}
              >
                #{k}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tool({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      // onMouseDown (not onClick) so the editor keeps focus + selection when a button is pressed.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className="shrink-0 p-1 rounded text-muted hover:text-body hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700 shrink-0" aria-hidden />;
}

function Swatches({ colors, onPick, onClose }: { colors: string[]; onPick: (c: string) => void; onClose: () => void }) {
  return (
    <div
      className="absolute left-0 top-full mt-1 z-popover flex flex-wrap gap-1 w-[8.5rem] p-1.5 rounded-md surface-overlay shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {colors.map((c) => (
        <button
          key={c} type="button" title={c}
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          className="w-5 h-5 rounded-full border border-black/10 dark:border-white/15 hover:scale-110 transition-transform"
          style={{ background: c }}
        />
      ))}
      <button type="button" title="Cancel" onMouseDown={(e) => { e.preventDefault(); onClose(); }} className="w-5 h-5 rounded flex items-center justify-center text-muted hover:text-body">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function ModeBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={clsx('p-1 rounded', active ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'text-muted hover:text-body hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60')}
    >
      {children}
    </button>
  );
}

function placeCaretEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
