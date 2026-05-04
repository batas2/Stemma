import { useState, useMemo } from 'react';
import { Eye, Code2 } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  value: string;
  onChange: (value: string) => void;
  height?: string;
}

/**
 * Minimal Markdown editor: source on the left, rendered preview on the right (or stacked).
 * No external dependency for the renderer; we do a small subset (headings, bold, italic,
 * inline code, fenced code, paragraphs, lists, links). Good enough for ADR / capability
 * narrative editing without the overhead of pulling in a full Markdown library.
 */
export function MarkdownEditor({ value, onChange, height = '100%' }: Props) {
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('split');
  const html = useMemo(() => renderMarkdown(value), [value]);

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-1 bg-zinc-50 dark:bg-zinc-900/50">
        <button
          onClick={() => setMode('edit')}
          className={clsx('flex items-center gap-1 text-[11px] px-2 py-0.5 rounded',
            mode === 'edit' ? 'bg-zinc-200 dark:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60')}
        >
          <Code2 className="w-3 h-3" /> Source
        </button>
        <button
          onClick={() => setMode('split')}
          className={clsx('text-[11px] px-2 py-0.5 rounded',
            mode === 'split' ? 'bg-zinc-200 dark:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60')}
        >
          Split
        </button>
        <button
          onClick={() => setMode('preview')}
          className={clsx('flex items-center gap-1 text-[11px] px-2 py-0.5 rounded',
            mode === 'preview' ? 'bg-zinc-200 dark:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60')}
        >
          <Eye className="w-3 h-3" /> Preview
        </button>
      </div>
      <div className="flex-1 flex min-h-0">
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="# Decision title&#10;&#10;## Context&#10;Why this decision is needed.&#10;&#10;## Decision&#10;What was chosen.&#10;&#10;## Consequences&#10;What changes as a result."
            className="flex-1 p-3 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none resize-none font-mono text-xs leading-relaxed border-r border-zinc-200 dark:border-zinc-800 last:border-r-0"
          />
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div
            className="flex-1 p-3 overflow-auto scrollbar-thin prose prose-sm dark:prose-invert text-xs"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

/** Render a tiny safe subset of Markdown to HTML. */
function renderMarkdown(input: string): string {
  if (!input) return '<p class="text-zinc-400 italic">Empty</p>';
  // Strip frontmatter for the preview.
  let text = input;
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) text = text.slice(end + 4).replace(/^\n+/, '');
  }
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Fenced code blocks first.
  text = text.replace(/```\w*\n([\s\S]*?)```/g, (_, body) =>
    `<pre class="bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-auto"><code class="text-[11px]">${escape(body)}</code></pre>`);
  const lines = text.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (line.startsWith('## ')) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h2 class="text-sm font-semibold mt-3 mb-1">${escape(line.slice(3))}</h2>`); }
    else if (line.startsWith('### ')) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h3 class="text-xs font-semibold mt-2 mb-1">${escape(line.slice(4))}</h3>`); }
    else if (line.startsWith('# ')) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h1 class="text-base font-bold mt-3 mb-1">${escape(line.slice(2))}</h1>`); }
    else if (/^[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul class="list-disc pl-5 my-1">'); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s/, ''))}</li>`);
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p class="my-1">${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');

  function inline(s: string): string {
    let r = escape(s);
    r = r.replace(/`([^`]+)`/g, '<code class="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-[11px]">$1</code>');
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-indigo-500 underline" target="_blank" rel="noreferrer">$1</a>');
    return r;
  }
}
