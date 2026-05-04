import { useState } from 'react';
import { X, Edit3, Trash2 } from 'lucide-react';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';

export function ArchInspector() {
  const arch = useApp((s) => s.arch);
  const id = useApp((s) => s.selectedElementId);
  const select = useApp((s) => s.selectElement);
  const setToast = useApp((s) => s.setToast);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  if (!arch || !id) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">Select an element on the canvas to inspect.</p>
      </aside>
    );
  }
  const e = arch.elements.find((x) => x.id === id);
  const link = arch.links.find((x) => x.id === id);
  if (!e && !link) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">No longer in model.</p>
      </aside>
    );
  }

  async function handleRename() {
    if (!e || !renameValue.trim() || renameValue === e.name) {
      setRenaming(false);
      return;
    }
    const r = await applyOperation({
      kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: e.id, newName: renameValue.trim(),
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Renamed' });
    setRenaming(false);
  }

  async function handleRemove() {
    if (!e) return;
    if (!confirm(`Remove ${e.name}?`)) return;
    const r = await applyOperation({
      kind: 'RemoveElement', opId: `op_${Date.now()}`, elementId: e.id,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Removed' }); select(null); }
  }

  if (link) {
    const from = arch.elements.find((x) => x.id === link.fromId);
    const to = arch.elements.find((x) => x.id === link.toId);
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <h2 className="text-sm font-semibold flex-1 truncate">{link.kind === 'dataFlow' ? 'Data Flow' : 'Dependency'}</h2>
          <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => select(null)} title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300 space-y-2">
          <div><span className="text-zinc-500">From</span> · {from?.name ?? link.fromId}</div>
          <div><span className="text-zinc-500">To</span> · {to?.name ?? link.toId}</div>
          {link.attributes.payload && <div><span className="text-zinc-500">Payload</span> · {link.attributes.payload}</div>}
          {link.attributes.kind && <div><span className="text-zinc-500">Kind</span> · {link.attributes.kind}</div>}
        </div>
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 mt-auto">
          <button
            onClick={async () => {
              const r = await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: link.id });
              if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
              else { setToast({ kind: 'success', text: 'Link removed' }); select(null); }
            }}
            className="w-full text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remove link
          </button>
        </div>
      </aside>
    );
  }

  if (!e) return null;
  return (
    <aside className="w-[320px] shrink-0 border-l border-zinc-800 bg-zinc-950/60 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(ev) => setRenameValue(ev.target.value)}
            onBlur={handleRename}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') handleRename();
              if (ev.key === 'Escape') setRenaming(false);
            }}
            className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-sm flex-1 outline-none focus:border-indigo-500"
          />
        ) : (
          <>
            <h2 className="text-sm font-semibold flex-1 truncate">{e.name}</h2>
            <button
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
              onClick={() => { setRenameValue(e.name); setRenaming(true); }}
              title="Rename"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <button className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100" onClick={() => select(null)} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 space-y-1">
        <div><span className="text-zinc-600 dark:text-zinc-400">Kind</span> · {e.kind}</div>
        <div><span className="text-zinc-600 dark:text-zinc-400">Id</span> · <span className="font-mono">{e.id}</span></div>
        {Object.entries(e.attributes).map(([k, v]) =>
          v !== null && v !== undefined ? (
            <div key={k}><span className="text-zinc-600 dark:text-zinc-400">{k}</span> · <span className="font-mono">{v}</span></div>
          ) : null
        )}
      </div>
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 mt-auto">
        <button
          onClick={handleRemove}
          className="w-full text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove element
        </button>
      </div>
    </aside>
  );
}
