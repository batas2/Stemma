import { useState } from 'react';
import { X, Plus, Trash2, Edit3 } from 'lucide-react';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';

export function Inspector() {
  const ws = useApp((s) => s.workspace);
  const id = useApp((s) => s.selectedTypeId);
  const select = useApp((s) => s.selectType);
  const setToast = useApp((s) => s.setToast);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [propName, setPropName] = useState('');
  const [propType, setPropType] = useState('string');

  if (!ws || !id) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-800 bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">Select a type on the canvas to inspect.</p>
      </aside>
    );
  }
  const all = ws.projects.flatMap((p) => p.types);
  const t = all.find((x) => x.id === id);
  if (!t) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-800 bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">Type no longer exists.</p>
      </aside>
    );
  }

  async function handleRename() {
    if (!t || !renameValue.trim() || renameValue === t.name) {
      setRenaming(false);
      return;
    }
    const r = await applyOperation({
      kind: 'RenameType', opId: `op_${Date.now()}`, typeId: t.id, newName: renameValue.trim(),
    });
    if ('reason' in r) {
      setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    } else {
      const newId = t.namespace ? `${t.namespace}.${renameValue.trim()}` : renameValue.trim();
      select(newId);
      setToast({ kind: 'success', text: 'Renamed' });
    }
    setRenaming(false);
  }

  async function handleAddProperty() {
    if (!t || !propName.trim()) return;
    const r = await applyOperation({
      kind: 'AddProperty', opId: `op_${Date.now()}`, typeId: t.id,
      name: propName.trim(), typeName: propType.trim() || 'string',
      visibility: 'public', hasGetter: true, hasSetter: true, hasInit: false,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Property added' }); setPropName(''); }
  }

  async function handleRemoveProperty(propertyName: string) {
    if (!t) return;
    const r = await applyOperation({
      kind: 'RemoveProperty', opId: `op_${Date.now()}`, typeId: t.id, propertyName,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Property removed' });
  }

  async function handleRemoveType() {
    if (!t) return;
    if (!confirm(`Remove ${t.name}?`)) return;
    const r = await applyOperation({
      kind: 'RemoveType', opId: `op_${Date.now()}`, typeId: t.id,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Type removed' }); select(null); }
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-zinc-800 bg-zinc-950/60 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm flex-1 outline-none focus:border-indigo-500"
          />
        ) : (
          <>
            <h2 className="text-sm font-semibold flex-1 truncate">{t.name}</h2>
            <button
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
              onClick={() => { setRenameValue(t.name); setRenaming(true); }}
              title="Rename"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <button
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          onClick={() => select(null)}
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 py-3 border-b border-zinc-800 text-[11px] text-zinc-500 space-y-1">
        <div><span className="text-zinc-400">Kind</span> · {t.kind}</div>
        <div><span className="text-zinc-400">Namespace</span> · <span className="font-mono">{t.namespace || '(global)'}</span></div>
        <div className="truncate" title={t.filePath}>
          <span className="text-zinc-400">File</span> · <span className="font-mono">{t.filePath.split('/').slice(-1)[0]}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        <section className="p-4">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Properties</h3>
          {t.properties.length === 0 && <p className="text-xs text-zinc-600 mb-2">No properties yet.</p>}
          <ul className="space-y-1 mb-3">
            {t.properties.map((p) => (
              <li key={p.name} className="group flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-zinc-900/40 border border-zinc-800">
                <div className="min-w-0">
                  <div className="text-zinc-200 truncate">{p.name}</div>
                  <div className="text-[10px] font-mono text-zinc-500 truncate">{p.type.fullyQualifiedName}</div>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-500 hover:text-rose-400 transition-opacity"
                  onClick={() => handleRemoveProperty(p.name)}
                  title="Remove property"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1">
            <input
              placeholder="name"
              value={propName}
              onChange={(e) => setPropName(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs flex-1 min-w-0 outline-none focus:border-indigo-500"
            />
            <input
              placeholder="type"
              value={propType}
              onChange={(e) => setPropType(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs w-20 outline-none focus:border-indigo-500 font-mono"
            />
            <button
              onClick={handleAddProperty}
              className="px-2 rounded bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 text-xs"
              title="Add property"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {t.baseTypes.length > 0 && (
          <section className="p-4 border-t border-zinc-800">
            <h3 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Inherits / Implements</h3>
            <ul className="space-y-1">
              {t.baseTypes.map((b) => (
                <li key={b.fullyQualifiedName} className="text-xs px-2 py-1 font-mono text-zinc-300 bg-zinc-900/40 rounded border border-zinc-800">
                  {b.fullyQualifiedName}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={handleRemoveType}
          className="w-full text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove type
        </button>
      </div>
    </aside>
  );
}
