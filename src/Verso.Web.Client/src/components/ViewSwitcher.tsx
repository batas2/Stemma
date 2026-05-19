import { Boxes, GitBranch, Network, Lightbulb } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { ViewKind } from '@/lib/types';

const views: { id: ViewKind; label: string; icon: typeof Network }[] = [
  { id: 'c4Context', label: 'C4 Context', icon: Network },
  { id: 'moduleMap', label: 'Module Map', icon: Boxes },
  { id: 'dependencyGraph', label: 'Dependencies', icon: GitBranch },
  { id: 'decisionLog', label: 'Decisions', icon: Lightbulb },
];

export function ViewSwitcher() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const arch = useApp((s) => s.arch);
  const isArchWorkspace = arch !== null;

  return (
    <div className="inline-flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md p-0.5">
      {views.map((v) => {
        const Icon = v.icon;
        const disabled = !isArchWorkspace;
        const active = v.id === view;
        return (
          <button
            key={v.id}
            disabled={disabled}
            onClick={() => setView(v.id)}
            title={disabled ? 'No Architecture/ in this workspace' : v.label}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
              active && 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-200',
              !active && !disabled && 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60',
              disabled && 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
            )}
          >
            <Icon className="w-3 h-3" />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
