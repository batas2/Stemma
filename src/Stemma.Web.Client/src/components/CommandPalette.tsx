import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { pickFromList } from './PromptDialog';
import { suggestElementName } from '@/lib/naming';
import { revealElement, revealNewElement, revealToast } from '@/lib/canvasReveal';
import { BUILTIN_NAMES } from '@/lib/navigation';
import { startCompare, stopCompare } from '@/lib/compare';
import { SHORTCUT_HINTS } from '@/lib/shortcuts';
import { LayoutGrid, Shapes } from 'lucide-react';
import type { ArchElementKind, ViewKind } from '@/lib/types';

const KIND_LABEL: Partial<Record<ArchElementKind, string>> = {
  module: 'Module', boundedContext: 'Bounded Context', softwareSystem: 'Software System', container: 'Container',
  person: 'Person', useCase: 'Use Case', capability: 'Capability', question: 'Question', assumption: 'Assumption',
  risk: 'Risk', concept: 'Concept',
};

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
  const activeCustomViewId = useApp((s) => s.activeCustomViewId);
  const customViews = useApp((s) => s.customViews);
  const trail = useApp((s) => s.trail);
  const goTo = useApp((s) => s.goTo);
  const goBack = useApp((s) => s.goBack);
  const goForward = useApp((s) => s.goForward);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const compare = useApp((s) => s.compare);
  const books = useApp((s) => s.books);
  const activeBookId = useApp((s) => s.activeBookId);
  const openBook = useApp((s) => s.openBook);
  const startPresenting = useApp((s) => s.startPresenting);
  const setToast = useApp((s) => s.setToast);

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

  const close = () => setOpen(false);
  const here = activeCustomViewId ?? view;
  const placeName = (e: { attributes: Record<string, string | null> }) => {
    const parent = e.attributes.contextId ?? e.attributes.systemId;
    return parent ? arch?.elements.find((x) => x.id === parent)?.name ?? null : null;
  };
  const squadOf = (id: string) => arch?.tags.find((t) => t.targetId === id)?.ownership?.squad ?? '';
  const backTo = trail.back[trail.back.length - 1];
  const forwardTo = trail.forward[trail.forward.length - 1];
  const nameOfPlace = (p: { view: ViewKind; customViewId: string | null }) =>
    p.customViewId ? customViews.find((v) => v.id === p.customViewId)?.name ?? 'a view' : BUILTIN_NAMES[p.view];
  const item = 'px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-indigo-500/20 aria-selected:text-indigo-700 dark:aria-selected:text-indigo-200 flex justify-between items-center gap-2';
  // The heading is styled, not the group: classes on the group reach every item in it.
  const group = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-500';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/60 backdrop-blur-sm" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="w-[600px] max-w-[90vw] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <Command shouldFilter label="Go to a view, an element or an action">
          <Command.Input
            autoFocus
            placeholder="Go to a view or an element, or type a command…"
            className="w-full bg-transparent border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500"
          />
          <Command.List className="max-h-[26rem] overflow-auto py-2 scrollbar-thin">
            <Command.Empty className="px-4 py-6 text-center text-xs text-zinc-500">Nothing by that name.</Command.Empty>

            <Command.Group heading="Views" className={group}>
              {(['moduleMap', 'dependencyGraph', 'concerns'] as ViewKind[]).map((v) => (
                <Command.Item key={v} value={`view ${BUILTIN_NAMES[v]}`} onSelect={() => { goTo({ view: v, customViewId: null }); close(); }} className={item}>
                  <span className="flex items-center gap-2 min-w-0"><LayoutGrid className="w-3.5 h-3.5 text-faint shrink-0" aria-hidden /> {BUILTIN_NAMES[v]}</span>
                  {here === v && <span className="text-[10px] font-mono text-zinc-500">current</span>}
                </Command.Item>
              ))}
              {customViews.map((v) => (
                <Command.Item key={v.id} value={`view ${v.name} ${v.id}`} onSelect={() => { goTo({ view: view === 'concerns' ? 'moduleMap' : view, customViewId: v.id }); close(); }} className={item}>
                  <span className="flex items-center gap-2 min-w-0"><Shapes className="w-3.5 h-3.5 text-violet-500 shrink-0" aria-hidden /> <span className="truncate">{v.name}</span></span>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">{here === v.id ? 'current · ' : ''}{v.elementIds.length} element{v.elementIds.length === 1 ? '' : 's'}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {books.length > 0 && (
              <Command.Group heading="Books" className={group}>
                {books.flatMap((b) => [
                  <Command.Item
                    key={`present:${b.id}`}
                    value={`present book ${b.name} ${b.audience ?? ''}`}
                    disabled={b.pages.length === 0}
                    onSelect={() => { close(); startPresenting(b.id); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-amber-500/20 aria-selected:text-amber-700 dark:aria-selected:text-amber-200 data-[disabled=true]:opacity-40 flex justify-between gap-2"
                  >
                    <span>Present: {b.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{b.audience ?? 'general'} · {b.pages.length}p</span>
                  </Command.Item>,
                  <Command.Item
                    key={`open:${b.id}`}
                    value={`open edit book ${b.name}`}
                    onSelect={() => { openBook(b.id); close(); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-amber-500/20 aria-selected:text-amber-700 dark:aria-selected:text-amber-200"
                  >
                    Edit book: {b.name}
                  </Command.Item>,
                ])}
                {activeBookId && (
                  <Command.Item
                    value="close book"
                    onSelect={() => { openBook(null); close(); }}
                    className="px-3 py-2 mx-2 rounded text-sm cursor-pointer aria-selected:bg-amber-500/20 aria-selected:text-amber-700 dark:aria-selected:text-amber-200"
                  >
                    Close book
                  </Command.Item>
                )}
              </Command.Group>
            )}

            {arch && arch.elements.length > 0 && (
              <Command.Group heading="Elements" className={group}>
                {arch.elements.map((e) => {
                  const where = placeName(e);
                  return (
                    <Command.Item
                      key={e.id}
                      value={`${e.name} ${e.id}`}
                      keywords={[KIND_LABEL[e.kind] ?? e.kind, where ?? '', squadOf(e.id)]}
                      onSelect={() => { close(); revealElement(e.id); }}
                      className={item}
                    >
                      <span className="truncate">{e.name}</span>
                      <span className="text-[10px] text-zinc-500 shrink-0 truncate max-w-[50%]">
                        {KIND_LABEL[e.kind] ?? e.kind}{where ? ` · ${where}` : ''}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            <Command.Group heading="Add element" className={group}>
              {ADD_KINDS.map((k) => (
                <Command.Item key={k.kind} value={`add ${k.label}`} onSelect={() => addArchElement(k.kind)} className={item}>
                  + Add {k.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Go" className={group}>
              <Command.Item value="go back" disabled={!backTo} onSelect={() => { close(); goBack(); }} className={`${item} data-[disabled=true]:opacity-40`}>
                <span>{backTo ? `Back to ${nameOfPlace(backTo)}` : 'Back'}</span>
                <span className="text-[10px] font-mono text-zinc-500">{SHORTCUT_HINTS.back}</span>
              </Command.Item>
              <Command.Item value="go forward" disabled={!forwardTo} onSelect={() => { close(); goForward(); }} className={`${item} data-[disabled=true]:opacity-40`}>
                <span>{forwardTo ? `Forward to ${nameOfPlace(forwardTo)}` : 'Forward'}</span>
                <span className="text-[10px] font-mono text-zinc-500">{SHORTCUT_HINTS.forward}</span>
              </Command.Item>
              <Command.Item
                value="find on this view search filter highlight spotlight"
                disabled={view === 'concerns'}
                onSelect={() => { close(); useApp.getState().setFind({ open: true }); window.dispatchEvent(new CustomEvent('stemma:find')); }}
                className={`${item} data-[disabled=true]:opacity-40`}
              >
                <span>Find on this view</span>
                <span className="text-[10px] font-mono text-zinc-500">{SHORTCUT_HINTS.find}</span>
              </Command.Item>
              {compare ? (
                <Command.Item value="stop comparing compare done" onSelect={() => { close(); stopCompare(); }} className={item}>
                  <span>Stop comparing</span>
                  <span className="text-[10px] font-mono text-zinc-500">Esc</span>
                </Command.Item>
              ) : (
                <Command.Item value="compare with the last commit changes diff git" onSelect={() => { close(); void startCompare('HEAD', 'the last commit'); }} className={item}>
                  <span>Compare with last commit</span>
                </Command.Item>
              )}
              <Command.Item value="keyboard shortcuts help" onSelect={() => { close(); window.dispatchEvent(new CustomEvent('stemma:show-shortcuts')); }} className={item}>
                <span>Keyboard shortcuts</span>
                <span className="text-[10px] font-mono text-zinc-500">?</span>
              </Command.Item>
              <Command.Item value="switch theme dark light appearance" onSelect={() => { close(); toggleTheme(); }} className={item}>
                <span>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
