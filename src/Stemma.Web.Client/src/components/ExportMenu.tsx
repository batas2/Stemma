import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, FileImage, FileCode, FileText, Globe } from 'lucide-react';
import { exportMermaid, exportDrawio } from '@/lib/api';
import { useApp } from '@/lib/store';
import { generateAndDownloadReport } from '@/report/generateReport';

function download(filename: string, content: string | Blob, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

  // F-001: single-file interactive HTML report. Recipients download it from Drive (or wherever
  // it's shared) and open it locally — Drive's preview doesn't run JavaScript (spec Q1-A).
  async function exportReport() {
    setOpen(false);
    const ws = useApp.getState().workspace;
    if (!ws) { setToast({ kind: 'error', text: 'Open a workspace first' }); return; }
    try {
      const r = await generateAndDownloadReport(ws.rootPath);
      const mb = (r.bytes / 1024 / 1024).toFixed(1);
      setToast({
        kind: r.oversize ? 'info' : 'success',
        text: `Report exported (${mb} MB). Share it anywhere — recipients download and open it.`,
      });
    } catch (e) {
      setToast({ kind: 'error', text: `Report failed: ${(e as Error).message}` });
    }
  }

  async function exportFormat(format: 'mermaid' | 'drawio' | 'png' | 'svg') {
    setOpen(false);
    // Image formats are rendered by the canvas (it has the flow context to fit ALL nodes,
    // even ones dragged far off-screen) — see the stemma:export-image handler in ArchCanvas.
    if (format === 'png' || format === 'svg') {
      window.dispatchEvent(new CustomEvent('stemma:export-image', { detail: { format } }));
      return;
    }
    try {
      if (format === 'mermaid') {
        const v = view === 'concerns' ? 'moduleMap' : view;
        const text = await exportMermaid(v);
        download(`stemma-${v}.md`, '```mermaid\n' + text + '\n```\n', 'text/markdown');
      } else {
        const xml = await exportDrawio();
        download('stemma.drawio', xml, 'application/xml');
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
          <ExportItem onClick={exportReport} icon={Globe} accent="text-sky-500" label="Architecture report (.html)" />
          <ExportItem onClick={() => exportFormat('png')} icon={FileImage} accent="text-rose-500" label="PNG" border />
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
