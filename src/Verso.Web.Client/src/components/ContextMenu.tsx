import { useEffect, useRef } from 'react';
import { Edit3, Trash2, Copy, Tag as TagIcon, Lightbulb, Plus, Workflow } from 'lucide-react';
import clsx from 'clsx';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: typeof Edit3;
  onClick: () => void;
  separator?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface Props {
  state: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ state, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, [state, onClose]);

  if (!state) return null;

  // Clamp position so the menu stays on screen.
  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - state.items.length * 30 - 8;
  const x = Math.min(state.x, maxX);
  const y = Math.min(state.y, maxY);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', left: x, top: y }}
      className="z-menu min-w-[180px] rounded-md surface-overlay py-1 text-xs"
    >
      {state.items.map((item) =>
        item.separator
          ? <div key={item.id} className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          : (
            <button
              key={item.id}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { item.onClick(); onClose(); }}
              className={clsx(
                'w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors',
                item.disabled
                  ? 'text-faint cursor-not-allowed'
                  : item.destructive
                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                    : 'text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
              )}
            >
              {item.icon ? <item.icon className="w-3 h-3 shrink-0" /> : <span className="w-3" />}
              <span>{item.label}</span>
            </button>
          )
      )}
    </div>
  );
}

// Re-export common icons used by callers when constructing items.
export const ContextIcons = { Edit3, Trash2, Copy, TagIcon, Lightbulb, Plus, Workflow };
