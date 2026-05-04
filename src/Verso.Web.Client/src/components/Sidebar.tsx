import { useMemo, useState } from 'react';
import {
  Box, Boxes, Cuboid, Layers, Package, User, Server, Target, BookOpen,
  Search, Plus, Trash2, Eye, Edit3, Pencil, ChevronsLeft, ChevronsRight, Wand2, X,
  ChevronDown, ChevronRight, Workflow,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { newCustomView } from '@/lib/views';
import { confirmAction } from './ConfirmDialog';
import { promptText } from './PromptDialog';
import { suggestViewName } from '@/lib/naming';
import type { ArchElement, ArchElementKind } from '@/lib/types';

type Tab = 'elements' | 'views';

const palette: { kind: ArchElementKind; label: string; icon: typeof Box; accent: string }[] = [
  { kind: 'module', label: 'Module', icon: Package, accent: 'text-indigo-500' },
  { kind: 'boundedContext', label: 'Bounded Context', icon: Layers, accent: 'text-violet-500' },
  { kind: 'softwareSystem', label: 'Software System', icon: Server, accent: 'text-emerald-500' },
  { kind: 'container', label: 'Container', icon: Cuboid, accent: 'text-emerald-400' },
  { kind: 'person', label: 'Person', icon: User, accent: 'text-amber-500' },
  { kind: 'useCase', label: 'Use Case', icon: Target, accent: 'text-rose-500' },
  { kind: 'capability', label: 'Capability', icon: BookOpen, accent: 'text-sky-500' },
];

const elementIcon: Record<ArchElementKind, typeof Box> = {
  module: Package,
  boundedContext: Layers,
  softwareSystem: Server,
  container: Cuboid,
  person: User,
  useCase: Target,
  capability: BookOpen,
};

const elementLabel: Record<ArchElementKind, string> = {
  module: 'Modules',
  boundedContext: 'Bounded Contexts',
  softwareSystem: 'Software Systems',
  container: 'Containers',
  person: 'People',
  useCase: 'Use Cases',
  capability: 'Capabilities',
};

const CATEGORY_ORDER: ArchElementKind[] = [
  'boundedContext', 'module', 'softwareSystem', 'container', 'person', 'useCase', 'capability',
];

export function Sidebar() {
  const open = useApp((s) => s.sidebarOpen);
  const setOpen = useApp((s) => s.setSidebarOpen);
  const arch = useApp((s) => s.arch);
  const mode = useApp((s) => s.mode);
  const toggleMode = useApp((s) => s.toggleMode);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const setActive = useApp((s) => s.setActiveCustomView);
  const upsert = useApp((s) => s.upsertCustomView);
  const remove = useApp((s) => s.removeCustomView);
  const removeElementFromActiveView = useApp((s) => s.removeElementFromActiveView);
  const setToast = useApp((s) => s.setToast);

  const [tab, setTab] = useState<Tab>('elements');
  const [query, setQuery] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<ArchElementKind>>(new Set());

  const activeView = customViews.find((v) => v.id === activeId);

  const groups = useMemo(() => {
    const m = new Map<ArchElementKind, ArchElement[]>();
    if (!arch) return m;
    const q = query.trim().toLowerCase();
    const filtered = arch.elements.filter((e) =>
      !q || e.name.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q)
    );
    for (const kind of CATEGORY_ORDER) {
      const items = filtered
        .filter((e) => e.kind === kind)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      if (items.length > 0) m.set(kind, items);
    }
    return m;
  }, [arch, query]);

  const totalCount = useMemo(() => {
    let n = 0;
    for (const items of groups.values()) n += items.length;
    return n;
  }, [groups]);

  function toggleCategory(kind: ArchElementKind) {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }

  function makeDragChip(label: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = label;
    el.style.cssText = [
      'position:absolute', 'top:-1000px', 'left:-1000px',
      'padding:4px 10px', 'border-radius:6px',
      'background:rgba(99,102,241,0.95)', 'color:white',
      'font:500 12px ui-sans-serif,system-ui,sans-serif',
      'box-shadow:0 4px 12px rgba(0,0,0,0.25)', 'pointer-events:none',
      'border:1px solid rgba(255,255,255,0.25)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 0);
    return el;
  }

  function onPaletteDragStart(e: React.DragEvent, kind: ArchElementKind, label: string) {
    e.dataTransfer.setData('application/verso-palette', kind);
    e.dataTransfer.effectAllowed = 'copy';
    const chip = makeDragChip(`+ ${label}`);
    e.dataTransfer.setDragImage(chip, 16, 16);
  }

  function onElementDragStart(e: React.DragEvent, elementId: string, name: string) {
    e.dataTransfer.setData('application/verso-element', elementId);
    e.dataTransfer.effectAllowed = 'copyMove';
    const chip = makeDragChip(name);
    e.dataTransfer.setDragImage(chip, 16, 16);
  }

  async function handleNewView() {
    const suggestion = suggestViewName(customViews);
    const name = await promptText({
      title: 'New view',
      body: 'Group elements into a custom view. You can drag elements onto the canvas afterwards to add them.',
      initialValue: suggestion,
      confirmLabel: 'Create',
    });
    if (!name) return;
    const v = newCustomView(name, 'all');
    upsert(v);
    setActive(v.id);
    setTab('views');
    setToast({ kind: 'success', text: `Created view "${name}"` });
  }

  async function handleRenameView(id: string, currentName: string) {
    const next = await promptText({
      title: `Rename "${currentName}"`,
      initialValue: currentName,
      confirmLabel: 'Rename',
    });
    if (!next || next === currentName) return;
    const v = customViews.find((x) => x.id === id);
    if (v) upsert({ ...v, name: next });
  }

  async function handleRemoveView(id: string, name: string) {
    const ok = await confirmAction({
      title: `Delete view "${name}"?`,
      body: 'The custom view will be removed from the workspace. Elements themselves are not affected.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove(id);
  }

  if (!open) {
    return (
      <aside className="w-12 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex flex-col items-center py-3 gap-2">
        <button
          onClick={() => setOpen(true)}
          title="Expand sidebar"
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setOpen(true); setTab('elements'); }}
          title="Elements"
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
        >
          <Boxes className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setOpen(true); setTab('views'); }}
          title="Views"
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
        >
          <Eye className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        <button
          onClick={toggleMode}
          title={mode === 'edit' ? 'Switch to Read-only mode' : 'Switch to Edit mode'}
          aria-label={mode === 'edit' ? 'Switch to Read-only mode' : 'Switch to Edit mode'}
          className={clsx(
            'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
            mode === 'edit'
              ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-700 dark:text-indigo-300'
              : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          )}
        >
          {mode === 'edit' ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {mode === 'edit' ? 'Edit' : 'Read-only'}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          title="Collapse"
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 pt-2 flex gap-1 text-xs">
        <button
          onClick={() => setTab('elements')}
          className={clsx(
            'flex-1 py-1.5 rounded transition-colors',
            tab === 'elements'
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
          )}
        >
          Elements
        </button>
        <button
          onClick={() => setTab('views')}
          className={clsx(
            'flex-1 py-1.5 rounded transition-colors',
            tab === 'views'
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
          )}
        >
          Views
          {customViews.length > 0 && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
              {customViews.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'elements' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 pt-2 pb-2 sticky top-0 z-chrome bg-zinc-50/90 dark:bg-zinc-950/80 backdrop-blur border-b border-subtle">
            <div className="flex items-center gap-2 px-2 py-1 rounded border border-default bg-white dark:bg-zinc-900/50 focus-within:border-indigo-400 dark:focus-within:border-indigo-500">
              <Search className="w-3 h-3 text-faint shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search elements…"
                aria-label="Search elements"
                className="flex-1 bg-transparent outline-none text-xs placeholder:text-zinc-400 dark:placeholder:text-zinc-600 min-w-0"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="text-faint hover:text-body">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {query && (
              <div className="text-[10px] text-muted mt-1.5 px-1">
                {totalCount} result{totalCount === 1 ? '' : 's'}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto scrollbar-thin">
          <section className="px-3 pt-3">
            <div className="text-[10px] uppercase tracking-wider text-faint mb-2 flex items-center gap-1">
              <Wand2 className="w-3 h-3" /> Add new
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {palette.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.kind}
                    draggable
                    onDragStart={(e) => onPaletteDragStart(e, p.kind, p.label)}
                    title={`Drag to canvas to add a ${p.label}`}
                    aria-label={`Drag to canvas to add a ${p.label}`}
                    className="group flex items-center gap-1.5 px-2 py-1.5 rounded border border-default bg-white dark:bg-zinc-900/50 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 cursor-grab active:cursor-grabbing text-xs transition-colors"
                  >
                    <Icon className={clsx('w-3.5 h-3.5 shrink-0', p.accent)} />
                    <span className="truncate">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="px-3 pt-4">
            <div className="text-[10px] uppercase tracking-wider text-faint mb-2 flex items-center gap-1">
              <Workflow className="w-3 h-3" /> Templates
            </div>
            <ul className="space-y-1">
              <li>
                <button
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/verso-template', 'bcWithModules'); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setDragImage(makeDragChip('Template: BC + 2 modules'), 16, 16); }}
                  title="Drag to canvas — Bounded Context with two modules"
                  className="w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded border border-default bg-white dark:bg-zinc-900/50 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 cursor-grab active:cursor-grabbing text-xs transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <span className="flex-1 truncate">BC + 2 modules</span>
                </button>
              </li>
              <li>
                <button
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/verso-template', 'systemWithContainer'); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setDragImage(makeDragChip('Template: System + Container'), 16, 16); }}
                  title="Drag to canvas — System with one container"
                  className="w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded border border-default bg-white dark:bg-zinc-900/50 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 cursor-grab active:cursor-grabbing text-xs transition-colors"
                >
                  <Server className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="flex-1 truncate">System + Container</span>
                </button>
              </li>
            </ul>
          </section>

          <section className="px-3 pt-4 pb-3">
            <div className="text-[10px] uppercase tracking-wider text-faint mb-2">
              Existing ({totalCount})
            </div>
            {totalCount === 0 && (
              <p className="text-xs text-zinc-500 px-1">{arch ? 'No elements yet.' : 'Open a workspace.'}</p>
            )}
            <div className="space-y-2">
              {Array.from(groups.entries()).map(([kind, items]) => {
                const Icon = elementIcon[kind];
                const collapsed = collapsedCats.has(kind);
                return (
                  <div key={kind}>
                    <button
                      onClick={() => toggleCategory(kind)}
                      className="w-full flex items-center gap-1 px-1 py-0.5 rounded text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/40 dark:hover:bg-zinc-800/40"
                    >
                      {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      <Icon className="w-3 h-3 ml-0.5 text-zinc-500" />
                      <span className="font-medium ml-0.5">{elementLabel[kind]}</span>
                      <span className="ml-auto text-[10px] text-zinc-500">{items.length}</span>
                    </button>
                    {!collapsed && (
                      <ul className="mt-0.5 ml-4 space-y-0.5">
                        {items.map((e) => {
                          const ElIcon = elementIcon[e.kind] ?? Box;
                          const inActiveView = activeView ? activeView.elementIds.includes(e.id) : false;
                          return (
                            <li
                              key={e.id}
                              draggable
                              onDragStart={(ev) => onElementDragStart(ev, e.id, e.name)}
                              title={`Drag to canvas${activeView ? ` to add to "${activeView.name}"` : ''}`}
                              className={clsx(
                                'group flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-grab active:cursor-grabbing transition-colors',
                                inActiveView
                                  ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
                                  : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                              )}
                            >
                              <ElIcon className="w-3 h-3 shrink-0 text-zinc-500" />
                              <span className="flex-1 truncate">{e.name}</span>
                              {inActiveView && (
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); removeElementFromActiveView(e.id); }}
                                  title="Remove from view"
                                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-500"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          </div>
        </div>
      )}

      {tab === 'views' && (
        <div className="flex-1 overflow-auto scrollbar-thin">
          <section className="px-3 pt-3">
            <button
              onClick={handleNewView}
              className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300"
            >
              <Plus className="w-3 h-3" /> New View
            </button>
          </section>
          <section className="px-3 pt-3 pb-3">
            <div className="text-[10px] uppercase tracking-wider text-faint mb-2">Custom views</div>
            <p className="text-[10px] text-faint mb-2 leading-snug">
              Built-in views (Context, Module Map, Dependencies, Decisions) live in the topbar. Custom views below filter the model down to a curated subset.
            </p>
            {customViews.length === 0 && (
              <p className="text-xs text-zinc-500 px-1">No custom views yet. Click "New View" above.</p>
            )}
            <ul className="space-y-0.5">
              {customViews.map((v) => {
                const active = v.id === activeId;
                return (
                  <li
                    key={v.id}
                    className={clsx(
                      'group flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
                      active
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200'
                        : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 text-zinc-700 dark:text-zinc-300'
                    )}
                  >
                    <button onClick={() => setActive(v.id)} className="flex-1 text-left truncate">
                      {v.name}
                    </button>
                    <span className="text-[9px] text-zinc-500">{v.elementIds.length}</span>
                    <button
                      onClick={() => handleRenameView(v.id, v.name)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      title="Rename"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleRemoveView(v.id, v.name)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-500"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {activeView && (
              <div className="mt-3 px-2 py-2 rounded bg-indigo-500/5 border border-indigo-500/20 text-[11px] text-zinc-600 dark:text-zinc-400">
                <div className="font-medium text-zinc-800 dark:text-zinc-200 mb-1">"{activeView.name}" active</div>
                Drag elements onto the canvas to include them in this view.
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
