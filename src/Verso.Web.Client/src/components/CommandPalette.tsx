import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import type { ArchElementKind } from '@/lib/types';

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const arch = useApp((s) => s.arch);
  const ws = useApp((s) => s.workspace);
  const view = useApp((s) => s.view);
  const setToast = useApp((s) => s.setToast);
  const select = useApp((s) => s.selectElement);
  const selectType = useApp((s) => s.selectType);

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

  async function addArchElement(kind: ArchElementKind, defaults?: { contextId?: string }) {
    const name = prompt(`New ${kind} name`)?.trim();
    if (!name) return;
    let contextId = defaults?.contextId;
    if ((kind === 'module' || kind === 'capability') && !contextId && arch) {
      const contexts = arch.elements.filter((e) => e.kind === 'boundedContext');
      if (contexts.length > 0) {
        const choice = prompt(
          `Context id (existing: ${contexts.map((c) => c.id).join(', ')}; leave empty for none)`,
          contexts[0].id
        )?.trim();
        if (choice) contextId = choice;
      }
    }
    const r = await applyOperation({
      kind: 'AddElement', opId: `op_${Date.now()}`,
      elementKind: kind, name, contextId,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: `Added ${name}` }); setOpen(false); }
  }

  if (!open) return null;

  const inEngineerView = view === 'engineer';
  const codeTypes = inEngineerView && ws ? ws.projects.flatMap((p) => p.types) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-[560px] max-w-[90vw] rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
        <Command shouldFilter>
          <Command.Input
            autoFocus
            placeholder={inEngineerView ? 'Search types or run a command…' : 'Search elements or add new…'}
            className="w-full bg-transparent border-b border-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500"
          />
          <Command.List className="max-h-80 overflow-auto py-2 scrollbar-thin">
            <Command.Empty className="px-4 py-6 text-center text-xs text-zinc-500">No matches.</Command.Empty>

            {!inEngineerView && (
              <Command.Group heading="Add element" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-2 pb-1">
                <Command.Item onSelect={() => addArchElement('module')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Module
                </Command.Item>
                <Command.Item onSelect={() => addArchElement('boundedContext')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Bounded Context
                </Command.Item>
                <Command.Item onSelect={() => addArchElement('softwareSystem')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Software System
                </Command.Item>
                <Command.Item onSelect={() => addArchElement('container')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Container
                </Command.Item>
                <Command.Item onSelect={() => addArchElement('person')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Person
                </Command.Item>
                <Command.Item onSelect={() => addArchElement('useCase')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Use Case
                </Command.Item>
                <Command.Item onSelect={() => addArchElement('capability')} className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200">
                  + Add Capability
                </Command.Item>
              </Command.Group>
            )}

            {!inEngineerView && arch && arch.elements.length > 0 && (
              <Command.Group heading="Elements" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-3 pb-1">
                {arch.elements.map((e) => (
                  <Command.Item
                    key={e.id}
                    onSelect={() => { select(e.id); setOpen(false); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-200 flex justify-between gap-2"
                  >
                    <span>{e.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{e.kind}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {inEngineerView && codeTypes.length > 0 && (
              <Command.Group heading="Types" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-3 pb-1">
                {codeTypes.map((t) => (
                  <Command.Item
                    key={t.id}
                    onSelect={() => { selectType(t.id); setOpen(false); }}
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
