import { useState } from 'react';
import { Download, ChevronDown, FileImage, FileCode, FileText } from 'lucide-react';
import { toPng, toSvg } from 'html-to-image';
import { exportMermaid, exportDrawio } from '@/lib/api';
import { useApp } from '@/lib/store';

function download(filename: string, content: string | Blob, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function snapshotCanvas(format: 'png' | 'svg'): Promise<string | Blob | null> {
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null
    ?? document.querySelector('.react-flow') as HTMLElement | null;
  if (!el) return null;
  if (format === 'png') return await toPng(el, { backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff' });
  return await toSvg(el);
}

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const view = useApp((s) => s.view);
  const setToast = useApp((s) => s.setToast);

  function safeView() {
    return view === 'engineer' ? 'moduleMap' : view;
  }

  async function exportFormat(format: 'mermaid' | 'drawio' | 'png' | 'svg') {
    setOpen(false);
    try {
      switch (format) {
        case 'mermaid': {
          const text = await exportMermaid(safeView() as 'c4Context' | 'moduleMap' | 'dependencyGraph');
          download(`verso-${safeView()}.md`, '```mermaid\n' + text + '\n```\n', 'text/markdown');
          break;
        }
        case 'drawio': {
          const xml = await exportDrawio();
          download('verso.drawio', xml, 'application/xml');
          break;
        }
        case 'png': {
          const dataUrl = await snapshotCanvas('png') as string;
          if (!dataUrl) { setToast({ kind: 'error', text: 'Could not snapshot the canvas' }); return; }
          download('verso.png', await (await fetch(dataUrl)).blob(), 'image/png');
          break;
        }
        case 'svg': {
          const svg = await snapshotCanvas('svg') as string;
          if (!svg) { setToast({ kind: 'error', text: 'Could not snapshot the canvas' }); return; }
          // toSvg returns a data URL; convert to xml directly.
          if (svg.startsWith('data:image/svg+xml')) {
            const xml = decodeURIComponent(svg.split(',')[1] ?? '');
            download('verso.svg', xml, 'image/svg+xml');
          } else {
            download('verso.svg', svg, 'image/svg+xml');
          }
          break;
        }
      }
      setToast({ kind: 'success', text: `Exported ${format}` });
    } catch (e) {
      setToast({ kind: 'error', text: `Export failed: ${(e as Error).message}` });
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export this view"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <Download className="w-3.5 h-3.5" />
        Export <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-1 w-48 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-50 overflow-hidden"
        >
          <button onClick={() => exportFormat('png')} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-center gap-2">
            <FileImage className="w-3.5 h-3.5 text-rose-500" /> PNG
          </button>
          <button onClick={() => exportFormat('svg')} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <FileImage className="w-3.5 h-3.5 text-amber-500" /> SVG
          </button>
          <button onClick={() => exportFormat('drawio')} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <FileCode className="w-3.5 h-3.5 text-emerald-500" /> draw.io XML
          </button>
          <button onClick={() => exportFormat('mermaid')} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <FileText className="w-3.5 h-3.5 text-indigo-500" /> Mermaid (.md)
          </button>
        </div>
      )}
    </div>
  );
}
