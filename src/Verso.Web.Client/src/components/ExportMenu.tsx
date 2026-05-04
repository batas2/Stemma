import { useEffect, useRef, useState } from 'react';
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
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onAway(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

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
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export this view"
        className="btn btn-md btn-ghost border-default bg-zinc-100 dark:bg-zinc-900"
      >
        <Download className="w-3.5 h-3.5" />
        Export <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-48 rounded surface-overlay z-popover overflow-hidden"
        >
          <ExportItem onClick={() => exportFormat('png')} icon={FileImage} accent="text-rose-500" label="PNG" />
          <ExportItem onClick={() => exportFormat('svg')} icon={FileImage} accent="text-amber-500" label="SVG" border />
          <ExportItem onClick={() => exportFormat('drawio')} icon={FileCode} accent="text-emerald-500" label="draw.io XML" border />
          <ExportItem onClick={() => exportFormat('mermaid')} icon={FileText} accent="text-indigo-500" label="Mermaid (.md)" border />
        </div>
      )}
    </div>
  );
}

function ExportItem({ onClick, icon: Icon, accent, label, border }: {
  onClick: () => void; icon: typeof FileImage; accent: string; label: string; border?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-center gap-2 ${border ? 'border-t border-subtle' : ''}`}
    >
      <Icon className={`w-3.5 h-3.5 ${accent}`} /> {label}
    </button>
  );
}
