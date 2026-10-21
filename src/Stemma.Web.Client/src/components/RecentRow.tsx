import { X } from 'lucide-react';
import clsx from 'clsx';
import type { RecentEntry } from '@/lib/types';

/**
 * One recent workspace: opened by a click, taken off the list by its ×. A folder that is not there
 * now (a drive unplugged, a folder moved) stays on the list, says so, and cannot be opened — it used
 * to vanish from the list for good the moment it was missing, or fail with "Directory not found".
 */
export function RecentRow({ entry, onOpen, onRemove, className }: {
  entry: RecentEntry;
  onOpen: (rootPath: string) => void;
  onRemove: (rootPath: string) => void;
  className?: string;
}) {
  return (
    <div className={clsx('group flex items-stretch border-b border-zinc-100 dark:border-zinc-800 last:border-b-0', className)}>
      <button
        onClick={() => onOpen(entry.rootPath)}
        disabled={entry.missing}
        title={entry.missing ? 'This folder is not there now. Reconnect the drive or move it back to open it.' : `Open ${entry.rootPath}`}
        className="flex-1 min-w-0 text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60 disabled:hover:bg-transparent disabled:cursor-default"
      >
        <div className={clsx('font-medium truncate', entry.missing && 'text-muted')}>
          {entry.displayName}
          {entry.missing && <span className="ml-1.5 font-normal text-amber-700 dark:text-amber-400">· Not found</span>}
        </div>
        <div className="text-[10px] text-zinc-500 font-mono truncate">{entry.rootPath}</div>
      </button>
      <button
        onClick={() => onRemove(entry.rootPath)}
        aria-label={`Remove ${entry.displayName} from recent workspaces`}
        title="Remove from this list — the folder is not touched"
        className={clsx(
          'shrink-0 px-2 text-faint hover:text-body focus-visible:opacity-100 group-hover:opacity-100',
          entry.missing ? 'opacity-100' : 'opacity-0',
        )}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
