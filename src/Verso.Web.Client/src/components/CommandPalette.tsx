import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { pickFromList } from './PromptDialog';
import { suggestElementName } from '@/lib/naming';
import { revealNewElement, revealToast } from '@/lib/canvasReveal';
import type { ArchElementKind, ViewKind } from '@/lib/types';

const VIEWS: { id: ViewKind; label: string }[] = [
  { id: 'moduleMap', label: 'Module Map' },
  { id: 'dependencyGraph', label: 'Dependencies' },
];

const ADD_KINDS: { kind: ArchElementKind; label: string }[] = [
  { kind: 'module', label: 'Module' },
  { kind: 'boundedContext', label: 'Bounded Context' },
  { kind: 'softwareSystem', label: 'Software System' },
  { kind: 'container', label: 'Container' },
  { kind: 'person', label: 'Person' },
  { kind: 'useCase', label: 'Use Case' },
  { kind: 'capability', label: 'Capability' },
];

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const books = useApp((s) => s.books);
  const activeBookId = useApp((s) => s.activeBookId);
  const setActiveBook = useApp((s) => s.setActiveBook);
  const setToast = useApp((s) => s.setToast);
  const select = useApp((s) => s.selectElement);

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
    const name = suggestElementName(kind, arch?.elements ?? []);
    let contextId = defaults?.contextId;
    if ((kind === 'module' || kind === 'capability') && !contextId && arch) {
      const contexts = arch.elements.filter((e) => e.kind === 'boundedContext');
      if (contexts.length > 0) {
        // Close the palette first so the picker takes the foreground.
        setOpen(false);
        const choice = await pickFromList<string>({
          title: `Pick a Bounded Context for the new ${kind}`,
          body: 'Or skip to create at the top level.',
          options: [
            { value: '__none__', label: '(no context — top level)' },
            ...contexts.map((c) => ({ value: c.id, label: c.name, hint: c.id })),
          ],
        });
        if (choice === null) return;
        if (choice && choice !== '__none__') contextId = choice;
      }
    }
    const prevIds = new Set((useApp.getState().arch?.elements ?? []).map((e) => e.id));
    const r = await applyOperation({
      kind: 'AddElement', opId: `op_${Date.now()}`,
      elementKind: kind, name, contextId,
    });
    if ('reason' in r) { setToast({ kind: 'error', text: friendlyOpError(r) }); return; }
    setOpen(false);
    // Bulletproof reveal: id-diff select + switch to a lens that renders this kind.
    const revealed = await revealNewElement(prevIds);
    setToast(revealed
      ? { kind: 'success', text: revealToast(revealed) }
      : { kind: 'error', text: `Added ${name}, but it did not appear — try refreshing.` });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-[560px] max-w-[90vw] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <Command shouldFilter>
          <Command.Input
            autoFocus
            placeholder="Search elements or add new…"
            className="w-full bg-transparent border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500"
          />
          <Command.List className="max-h-80 overflow-auto py-2 scrollbar-thin">
            <Command.Empty className="px-4 py-6 text-center text-xs text-zinc-500">No matches.</Command.Empty>

            <Command.Group heading="Go to view" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-2 pb-1">
              {VIEWS.map((v) => (
                <Command.Item
                  key={v.id}
                  value={`go to view ${v.label}`}
                  onSelect={() => { setView(v.id); setOpen(false); }}
                  className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-700 dark:aria-selected:text-indigo-200 flex justify-between gap-2"
                >
                  <span>{v.label}</span>
                  {view === v.id && <span className="text-[10px] font-mono text-zinc-500">current</span>}
                </Command.Item>
              ))}
            </Command.Group>

            {books.length > 0 && (
              <Command.Group heading="Books" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-3 pb-1">
                {books.map((b) => (
                  <Command.Item
                    key={b.id}
                    value={`present book ${b.name} ${b.audience ?? ''}`}
                    onSelect={() => { setActiveBook(b.id); setOpen(false); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-amber-500/20 aria-selected:text-amber-700 dark:aria-selected:text-amber-200 flex justify-between gap-2"
                  >
                    <span>Present: {b.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{b.audience ?? 'general'} · {b.pages.length}p</span>
                  </Command.Item>
                ))}
                {activeBookId && (
                  <Command.Item
                    value="exit book mode present"
                    onSelect={() => { setActiveBook(null); setOpen(false); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-amber-500/20 aria-selected:text-amber-700 dark:aria-selected:text-amber-200"
                  >
                    Exit book mode
                  </Command.Item>
                )}
              </Command.Group>
            )}

            <Command.Group heading="Add element" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-2 pb-1">
              {ADD_KINDS.map((k) => (
                <Command.Item
                  key={k.kind}
                  value={`add ${k.label}`}
                  onSelect={() => addArchElement(k.kind)}
                  className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-700 dark:aria-selected:text-indigo-200"
                >
                  + Add {k.label}
                </Command.Item>
              ))}
            </Command.Group>

            {arch && arch.elements.length > 0 && (
              <Command.Group heading="Elements" className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-3 pb-1">
                {arch.elements.map((e) => (
                  <Command.Item
                    key={e.id}
                    onSelect={() => { select(e.id); setOpen(false); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-700 dark:aria-selected:text-indigo-200 flex justify-between gap-2"
                  >
                    <span>{e.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{e.kind}</span>
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
