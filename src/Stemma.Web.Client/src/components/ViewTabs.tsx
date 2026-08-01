import { Boxes, GitBranch, ClipboardList, Plus, X, Shapes } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { ViewKind } from '@/lib/types';
import { newCustomView } from '@/lib/views';
import { suggestViewName } from '@/lib/naming';
import { promptText } from './PromptDialog';

const BUILTINS: { id: ViewKind; label: string; icon: typeof Boxes }[] = [
  { id: 'moduleMap', label: 'Module Map', icon: Boxes },
  { id: 'dependencyGraph', label: 'Dependencies', icon: GitBranch },
  { id: 'concerns', label: 'Concerns', icon: ClipboardList },
];

/** draw.io-style bottom tab bar: the built-in views (not renameable / deletable) plus the
 *  saved/custom views (create, rename, delete). The active tab follows the store. */
export function ViewTabs() {
  const ws = useApp((s) => s.workspace);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const setActive = useApp((s) => s.setActiveCustomView);
  const upsert = useApp((s) => s.upsertCustomView);
  const closeView = useApp((s) => s.closeCustomView);
  const openViewIds = useApp((s) => s.openViewIds);
  const setToast = useApp((s) => s.setToast);

  if (!ws) return null;

  // Only the views the user has opened show as tabs; deleting lives in the Sidebar.
  const openViews = customViews.filter((v) => openViewIds.includes(v.id));

  async function newView() {
    const name = await promptText({ title: 'New view', initialValue: suggestViewName(customViews), confirmLabel: 'Create' });
    if (!name) return;
    const v = newCustomView(name, 'all');
    upsert(v);
    setActive(v.id);
    setToast({ kind: 'success', text: `Created view "${name}"` });
  }
  async function rename(id: string, current: string) {
    const next = await promptText({ title: `Rename "${current}"`, initialValue: current, confirmLabel: 'Rename' });
    if (!next || next === current) return;
    const v = customViews.find((x) => x.id === id);
    if (v) upsert({ ...v, name: next });
  }

  return (
    <div role="tablist" aria-label="Views" className="h-9 shrink-0 border-t border-default bg-zinc-100/80 dark:bg-zinc-900/70 flex items-stretch gap-0.5 px-2 overflow-x-auto scrollbar-thin">
      {BUILTINS.map((b) => {
        const Icon = b.icon;
        const active = view === b.id && !activeId;
        return (
          <button
            key={b.id}
            role="tab"
            aria-selected={active}
            onClick={() => setView(b.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 text-xs border-b-2 -mb-px whitespace-nowrap transition-colors',
              active
                ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-white/70 dark:bg-zinc-950/40'
                : 'border-transparent text-muted hover:text-body hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40',
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" /> {b.label}
          </button>
        );
      })}

      {openViews.length > 0 && <span className="w-px my-2 bg-zinc-300 dark:bg-zinc-700 shrink-0" />}

      {openViews.map((v) => {
        const active = activeId === v.id;
        return (
          <div
            key={v.id}
            role="tab"
            aria-selected={active}
            onClick={() => setActive(v.id)}
            onDoubleClick={() => rename(v.id, v.name)}
            title="Click to open · double-click to rename"
            className={clsx(
              'group flex items-center gap-1.5 pl-3 pr-1.5 text-xs border-b-2 -mb-px whitespace-nowrap cursor-pointer transition-colors',
              active
                ? 'border-violet-500 text-violet-700 dark:text-violet-300 bg-white/70 dark:bg-zinc-950/40'
                : 'border-transparent text-muted hover:text-body hover:bg-zinc-200/50 dark:hover:bg-zinc-800/40',
            )}
          >
            <Shapes className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[140px]">{v.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeView(v.id); }}
              title="Close tab — the view stays in the sidebar"
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-faint hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      <button onClick={newView} title="New view" aria-label="New view" className="flex items-center px-2 text-muted hover:text-body shrink-0">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
