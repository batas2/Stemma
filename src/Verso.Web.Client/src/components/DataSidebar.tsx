import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Database, Layers, Hexagon, ShieldCheck, Search, X, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useApp } from '@/lib/store';
import type { YamlConcept } from '@/lib/types';

/**
 * Epic 08 C7 — Sidebar surface for the Data Model + Resource Tree views.
 *
 * Lists yaml-sourced concepts grouped by kind so architects can scan the
 * data model the way they scan the arch model. Selecting a row drives the
 * canvas + inspector through `selectYamlConcept`.
 */
const KIND_ICON: Record<string, typeof Database> = {
  AggregateRoot: Database,
  DomainEntity: Layers,
  ValueObject: Hexagon,
  Resource: ShieldCheck,
};

const DATA_KINDS = ['AggregateRoot', 'DomainEntity', 'ValueObject'] as const;
const RESOURCE_KINDS = ['Resource'] as const;

const KIND_LABEL: Record<string, string> = {
  AggregateRoot: 'Aggregates',
  DomainEntity: 'Entities',
  ValueObject: 'Value Objects',
  Resource: 'Resources',
};

export function DataSidebar() {
  const open = useApp((s) => s.sidebarOpen);
  const setOpen = useApp((s) => s.setSidebarOpen);
  const view = useApp((s) => s.view);
  const concepts = useApp((s) => s.yamlConcepts);
  const selectedId = useApp((s) => s.selectedYamlConceptId);
  const selectYaml = useApp((s) => s.selectYamlConcept);

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const visibleKinds = view === 'resourceTree' ? RESOURCE_KINDS : DATA_KINDS;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: YamlConcept) =>
      !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    const m = new Map<string, YamlConcept[]>();
    for (const kind of visibleKinds) {
      const items = concepts
        .filter((c) => c.kind === kind && matches(c))
        .sort((a, b) => a.name.localeCompare(b.name));
      m.set(kind, items);
    }
    return m;
  }, [concepts, query, visibleKinds]);

  const total = useMemo(() => {
    let n = 0;
    for (const items of groups.values()) n += items.length;
    return n;
  }, [groups]);

  function toggle(kind: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
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
        <Database className="w-4 h-4 text-zinc-400" />
      </aside>
    );
  }

  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        <div className="text-xs font-medium text-muted flex items-center gap-1.5">
          <Database className="w-3 h-3" /> Data
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          title="Collapse"
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 pt-2 pb-2 border-b border-subtle">
        <div className="flex items-center gap-2 px-2 py-1 rounded border border-default bg-white dark:bg-zinc-900/50 focus-within:border-indigo-400 dark:focus-within:border-indigo-500">
          <Search className="w-3 h-3 text-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search concepts…"
            aria-label="Search concepts"
            className="flex-1 bg-transparent outline-none text-xs placeholder:text-zinc-400 dark:placeholder:text-zinc-600 min-w-0"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="text-faint hover:text-body">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {query && (
          <div className="text-[10px] text-muted mt-1.5 px-1">{total} result{total === 1 ? '' : 's'}</div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {total === 0 && (
          <div className="px-3 py-4 text-xs text-faint text-center">
            {concepts.length === 0
              ? <>No concepts loaded. Add <code className="font-mono text-[11px]">Concepts/*.verso.yaml</code> to the workspace.</>
              : 'No matches.'}
          </div>
        )}
        {[...groups.entries()].map(([kind, items]) => {
          if (items.length === 0) return null;
          const Icon = KIND_ICON[kind] ?? Layers;
          const isCollapsed = collapsed.has(kind);
          return (
            <div key={kind} className="border-b border-subtle last:border-b-0">
              <button
                onClick={() => toggle(kind)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wide text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900/40"
              >
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <Icon className="w-3 h-3" />
                {KIND_LABEL[kind] ?? kind}
                <span className="ml-auto text-[10px] text-faint">{items.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="pb-1">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => selectYaml(c.id)}
                        className={clsx(
                          'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2',
                          c.id === selectedId
                            ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200'
                            : 'text-body hover:bg-zinc-100 dark:hover:bg-zinc-900/40',
                        )}
                      >
                        <span className="truncate">{c.name}</span>
                        <code className="ml-auto text-[10px] text-faint font-mono truncate">{c.id}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
