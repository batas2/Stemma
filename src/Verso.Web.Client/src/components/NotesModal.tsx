import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ArchElementKind } from '@/lib/types';
import { RichTextEditor } from './RichTextEditor';

/** Full "module window" for notes — a larger editor than the inspector's inline one. */
export function NotesModal({ open, title, value, kind, existingKeys, onChange, onClose }: {
  open: boolean;
  title: string;
  value: string;
  kind: ArchElementKind;
  existingKeys: string[];
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[720px] max-w-[92vw] max-h-[85vh] flex flex-col rounded-xl border border-default bg-white dark:bg-zinc-900 shadow-2xl">
        <div className="px-4 py-3 border-b border-default flex items-center gap-2">
          <h2 className="text-sm font-semibold flex-1 truncate">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted hover:text-body">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-auto flex-1 flex flex-col min-h-[420px]">
          <RichTextEditor value={value} onChange={onChange} kind={kind} existingKeys={existingKeys} autoFocus className="flex-1" />
          <p className="text-[11px] text-faint mt-3 leading-snug">
            Tip: <code className="px-1 rounded bg-zinc-100 dark:bg-zinc-800">#owner: ABC</code> sets a custom property you can show on the canvas.
            Type <code className="px-1 rounded bg-zinc-100 dark:bg-zinc-800">#</code> for suggestions. Edits save automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
