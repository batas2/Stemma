import { useMemo, useState } from 'react';
import {
  Box, Boxes, Cuboid, Layers, Package, User, Server, Target, BookOpen,
  Search, Plus, Trash2, Eye, Edit3, ChevronsLeft, ChevronsRight, Wand2, X,
  ChevronDown, ChevronRight, Shapes, HelpCircle, Lightbulb, AlertTriangle,
} from 'lucide-react';
import { BooksPanel } from './BooksPanel';
import type { ShapeKind } from '@/lib/shapes';
import { Square, Circle, Triangle, ArrowRight, Type, Image as ImageIcon, MousePointer2 } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { newCustomView } from '@/lib/views';
import { applyOperation } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { revealNewElement, revealToast } from '@/lib/canvasReveal';
import { confirmAction } from './ConfirmDialog';
import { promptText } from './PromptDialog';
import { suggestViewName, suggestElementName } from '@/lib/naming';
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
  { kind: 'question', label: 'Question', icon: HelpCircle, accent: 'text-sky-500' },
  { kind: 'assumption', label: 'Assumption', icon: Lightbulb, accent: 'text-amber-500' },
  { kind: 'risk', label: 'Risk', icon: AlertTriangle, accent: 'text-rose-500' },
];

const elementIcon: Record<ArchElementKind, typeof Box> = {
  module: Package,
  boundedContext: Layers,
  softwareSystem: Server,
  container: Cuboid,
  person: User,
  useCase: Target,
  capability: BookOpen,
  question: HelpCircle,
  assumption: Lightbulb,
  risk: AlertTriangle,
};

const elementLabel: Record<ArchElementKind, string> = {
  module: 'Modules',
  boundedContext: 'Bounded Contexts',
  softwareSystem: 'Software Systems',
  container: 'Containers',
  person: 'People',
  useCase: 'Use Cases',
  capability: 'Capabilities',
  question: 'Questions',
  assumption: 'Assumptions',
  risk: 'Risks',
};

const CATEGORY_ORDER: ArchElementKind[] = [
  'boundedContext', 'module', 'softwareSystem', 'container', 'person', 'useCase', 'capability',
  'question', 'assumption', 'risk',
];

// Shape tools live in the Add-new palette so everything you can place on the canvas is in one place.
const SHAPE_TOOLS: { kind: ShapeKind; label: string; icon: typeof Square }[] = [
  { kind: 'rect', label: 'Rectangle', icon: Square },
  { kind: 'ellipse', label: 'Ellipse', icon: Circle },
  { kind: 'triangle', label: 'Triangle', icon: Triangle },
  { kind: 'arrow', label: 'Arrow', icon: ArrowRight },
  { kind: 'label', label: 'Label', icon: Type },
];

export function Sidebar() {
  const open = useApp((s) => s.sidebarOpen);
  const setOpen = useApp((s) => s.setSidebarOpen);
  const arch = useApp((s) => s.arch);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const setActive = useApp((s) => s.setActiveCustomView);
  const upsert = useApp((s) => s.upsertCustomView);
  const remove = useApp((s) => s.removeCustomView);
  const removeElementFromActiveView = useApp((s) => s.removeElementFromActiveView);
  const selectElement = useApp((s) => s.selectElement);
  const setToast = useApp((s) => s.setToast);
  const canvasMode = useApp((s) => s.canvasMode);
  const setCanvasMode = useApp((s) => s.setCanvasMode);

  // Shapes are drawn on saved views; arming a tool creates+activates a saved view first if needed.
  function ensureSavedView() {
    if (useApp.getState().activeCustomViewId != null) return false;
    const v = newCustomView('Freeform', 'all');
    upsert(v);
    setActive(v.id);
    return true;
  }
  function armShape(tool: ShapeKind | 'select') {
    if (tool === 'select') { setCanvasMode({ kind: 'select' }); return; }
    if (ensureSavedView()) setToast({ kind: 'info', text: 'Opened a saved view "Freeform" — shapes live on saved views.' });
    setCanvasMode({ kind: 'shape', tool });
  }
  function openStencils() {
    ensureSavedView();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('stemma:open-stencils'));
  }

  // Clicking a palette tile adds the element (drag still works too). Routed through
  // revealNewElement so it switches to a lens that renders the kind, then selects + centers it.
  async function addElement(kind: ArchElementKind) {
    const fresh = useApp.getState().arch;
    const prevIds = new Set((fresh?.elements ?? []).map((e) => e.id));
    const name = suggestElementName(kind, fresh?.elements ?? []);
    const r = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: kind, name });
    if ('reason' in r) { setToast({ kind: 'error', text: friendlyOpError(r) }); return; }
    const revealed = await revealNewElement(prevIds);
    setToast(revealed
      ? { kind: 'success', text: revealToast(revealed) }
      : { kind: 'error', text: `Added ${name}, but it did not appear — try refreshing.` });
  }

  const [tab, setTab] = useState<Tab>('elements');
  const [query, setQuery] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<ArchElementKind>>(new Set());

  // Top-level section collapse state — persisted across reloads.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('stemma.sidebar.collapsedSections');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });
  function toggleSection(id: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('stemma.sidebar.collapsedSections', JSON.stringify([...next])); } catch { /* ignore */ }
      }
      return next;
    });
  }
  const sectionOpen = (id: string) => !collapsedSections.has(id);

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
    e.dataTransfer.setData('application/stemma-palette', kind);
    e.dataTransfer.effectAllowed = 'copy';
    const chip = makeDragChip(`+ ${label}`);
    e.dataTransfer.setDragImage(chip, 16, 16);
  }

  function onElementDragStart(e: React.DragEvent, elementId: string, name: string) {
    e.dataTransfer.setData('application/stemma-element', elementId);
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
          title="Views & Books"
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
        <span className="flex items-center gap-1.5 px-1 text-xs text-muted">
          <Boxes className="w-3.5 h-3.5" /> Workspace
        </span>
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
            <SectionHeader
              icon={<Wand2 className="w-3 h-3" />}
              label="Add new"
              open={sectionOpen('addNew')}
              onToggle={() => toggleSection('addNew')}
            />
            {sectionOpen('addNew') && (
              <>
              <div className="text-[10px] uppercase tracking-wider text-faint mt-2 mb-1 px-0.5">Model elements</div>
              <div className="grid grid-cols-2 gap-1.5">
                {palette.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.kind}
                      draggable
                      onClick={() => addElement(p.kind)}
                      onDragStart={(e) => onPaletteDragStart(e, p.kind, p.label)}
                      title={`Click to add a ${p.label} (or drag it onto the canvas)`}
                      aria-label={`Add a ${p.label}`}
                      className="group flex items-center gap-1.5 px-2 py-1.5 rounded border border-default bg-white dark:bg-zinc-900/50 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 cursor-pointer active:cursor-grabbing text-xs text-left transition-colors"
                    >
                      <Icon className={clsx('w-3.5 h-3.5 shrink-0', p.accent)} />
                      <span className="truncate">{p.label}</span>
                    </button>
                  );
                })}
              </div>
              {/* Shapes — picked here, drawn on the canvas. */}
              <div className="text-[10px] uppercase tracking-wider text-faint mt-3 mb-1 px-0.5">Shapes & stencils</div>
              <div className="grid grid-cols-2 gap-1.5">
                {SHAPE_TOOLS.map((s) => {
                  const Icon = s.icon;
                  const active = canvasMode.kind === 'shape' && canvasMode.tool === s.kind;
                  return (
                    <button
                      key={s.kind}
                      onClick={() => armShape(s.kind)}
                      title={`${s.label} — then drag on the canvas to draw`}
                      className={clsx(
                        'flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs transition-colors',
                        active
                          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
                          : 'border-default bg-white dark:bg-zinc-900/50 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
                <button
                  onClick={openStencils}
                  title="Open the stencil library (cloud, db, queue icons…)"
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-default bg-white dark:bg-zinc-900/50 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-xs"
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">Stencils…</span>
                </button>
                {canvasMode.kind === 'shape' && (
                  <button
                    onClick={() => armShape('select')}
                    className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1 rounded border border-default text-[11px] text-muted hover:text-body"
                  >
                    <MousePointer2 className="w-3 h-3" /> Done drawing
                  </button>
                )}
              </div>
              <p className="text-[10px] text-faint mt-1.5 px-0.5 leading-snug">
                Pick a shape, then drag on the canvas. Shapes live on saved views.
              </p>
              </>
            )}
          </section>

          <section className="px-3 pt-4 pb-3">
            <SectionHeader
              icon={<Boxes className="w-3 h-3" />}
              label={`Existing (${totalCount})`}
              open={sectionOpen('existing')}
              onToggle={() => toggleSection('existing')}
            />
            {sectionOpen('existing') && totalCount === 0 && (
              <p className="text-xs text-zinc-500 px-1 mt-2">{arch ? 'No elements yet.' : 'Open a workspace.'}</p>
            )}
            {sectionOpen('existing') && (
            <div className="space-y-2 mt-2">
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
                              onClick={() => { selectElement(e.id); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('stemma:focus-node', { detail: { nodeId: e.id } })); }}
                              onDragStart={(ev) => onElementDragStart(ev, e.id, e.name)}
                              title={`Click to select & center · drag to canvas${activeView ? ` to add to "${activeView.name}"` : ''}`}
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
            )}
          </section>
          </div>
        </div>
      )}

      {tab === 'views' && (
        <div className="flex-1 overflow-auto scrollbar-thin">
          {/* One home for "view": saved views + books. The built-in lenses live in the topbar switcher. */}
          <section className="px-3 pt-3">
            <SectionHeader
              icon={<Eye className="w-3 h-3" />}
              label="Saved views"
              open={sectionOpen('customViews')}
              onToggle={() => toggleSection('customViews')}
            />
            {sectionOpen('customViews') && (
            <>
            <button
              onClick={handleNewView}
              className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 mt-2"
            >
              <Plus className="w-3 h-3" /> New View
            </button>
            <p className="text-[10px] text-faint mt-2 mb-2 leading-snug">
              Saved views are <span className="font-medium">freeform</span> — a curated subset you can lay out by hand and annotate with shapes.
            </p>
            {customViews.length === 0 && (
              <p className="text-xs text-zinc-500 px-1">No saved views yet. Click "New View" above.</p>
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
                    <span title="Freeform — supports shapes & manual layout" className="text-violet-500/80 shrink-0">
                      <Shapes className="w-3 h-3" />
                    </span>
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
            </>
            )}
          </section>
          <section className="px-3 pt-4 pb-3">
            <SectionHeader
              icon={<BookOpen className="w-3 h-3" />}
              label="Books"
              open={sectionOpen('books')}
              onToggle={() => toggleSection('books')}
            />
            {sectionOpen('books') && (
              <div className="mt-2">
                <BooksPanel />
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}

/** Clickable section header with chevron + persistent collapse. */
function SectionHeader({ label, icon, open, onToggle }: {
  label: string;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="w-full text-[10px] uppercase tracking-wider text-faint flex items-center gap-1 hover:text-body transition-colors"
    >
      {open
        ? <ChevronDown className="w-3 h-3 shrink-0" />
        : <ChevronRight className="w-3 h-3 shrink-0" />}
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}
