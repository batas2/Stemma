import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const ws = useApp((s) => s.workspace);
  const setToast = useApp((s) => s.setToast);
  const select = useApp((s) => s.selectType);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const allTypes = ws?.projects.flatMap((p) => p.types) ?? [];

  async function addNewType(kind: 'class' | 'interface' | 'record') {
    if (!ws) return;
    const name = prompt(`New ${kind} name`)?.trim();
    if (!name) return;
    const ns = prompt('Namespace', allTypes[0]?.namespace ?? 'Demo')?.trim() ?? '';
    const project = ws.projects[0];
    if (!project) return;
    const projectDir = project.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const filePath = `${projectDir}/${name}.cs`;
    const r = await applyOperation({
      kind: 'AddType', opId: `op_${Date.now()}`,
      filePath, namespace: ns, name, typeKind: kind,
      visibility: 'public',
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: `Added ${name}` }); setOpen(false); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-[560px] max-w-[90vw] rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
        <Command shouldFilter>
          <Command.Input
            autoFocus
            placeholder="Search types or run a command…"
            className="w-full bg-transparent border-b border-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500"
          />
          <Command.List className="max-h-80 overflow-auto py-2 scrollbar-thin">
            <Command.Empty className="px-4 py-6 text-center text-xs text-zinc-500">
              No matches.
            </Command.Empty>
            <Command.Group heading="Create" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-2 pb-1">
              <Command.Item onSelect={() => addNewType('class')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                + Add Class
              </Command.Item>
              <Command.Item onSelect={() => addNewType('interface')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                + Add Interface
              </Command.Item>
              <Command.Item onSelect={() => addNewType('record')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                + Add Record
              </Command.Item>
            </Command.Group>
            {allTypes.length > 0 && (
              <Command.Group heading="Types" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-3 pb-1">
                {allTypes.map((t) => (
                  <Command.Item
                    key={t.id}
                    onSelect={() => { select(t.id); setOpen(false); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200 flex justify-between gap-2"
                  >
                    <span>{t.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500 truncate">{t.namespace}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
