import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { useApp } from '@/lib/store';

const MonacoEditor = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.default })));

interface Props {
  open: boolean;
  title: string;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void> | void;
}

export function NotesModal({ open, title, initialValue, onClose, onSave }: Props) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.theme);

  useEffect(() => { if (open) setValue(initialValue); }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function trap(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const f = root.querySelectorAll<HTMLElement>(
        'a, button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', trap);
    setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('textarea, .monaco-editor textarea')?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', trap);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  async function handleSave() {
    setSaving(true);
    try { await onSave(value); onClose(); }
    finally { setSaving(false); }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-modal-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="surface-overlay rounded-lg flex flex-col w-[min(1100px,95vw)] h-[min(720px,90vh)] min-w-[800px]"
      >
        <header className="px-4 py-3 border-b border-default flex items-center gap-3">
          <h2 id="notes-modal-title" className="text-sm font-semibold text-body flex-1 truncate">{title}</h2>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-md btn-primary"
            aria-label="Save notes"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
          <button
            onClick={onClose}
            aria-label="Close notes editor"
            className="btn btn-md btn-ghost p-1.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <Suspense fallback={
            <div className="h-full flex items-center justify-center text-xs text-muted">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading editor…
            </div>
          }>
            <MonacoEditor
              language="markdown"
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              value={value}
              onChange={(v) => setValue(v ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: 'on',
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                renderLineHighlight: 'none',
                folding: false,
                glyphMargin: false,
                padding: { top: 12, bottom: 12 },
              }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
