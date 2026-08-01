import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit3, Trash2, Copy, Tag as TagIcon, Lightbulb, Plus, Workflow, Layers, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: typeof Edit3;
  hint?: string;             // optional muted right-aligned hint (shortcut, "…")
  onClick: () => void;
  separator?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  opensDialog?: boolean;     // adds a chevron so users know more UI follows
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

const ITEM_HEIGHT = 28;
const SEP_HEIGHT = 9;
const MIN_WIDTH = 200;

export function ContextMenu({ state, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Reset highlight whenever a fresh menu opens. First non-separator item wins.
  useEffect(() => {
    if (!state) return;
    const firstActive = state.items.findIndex((i) => !i.separator && !i.disabled);
    setHighlighted(firstActive >= 0 ? firstActive : 0);
  }, [state]);

  // Clamp position to viewport using actual rendered size, not estimates.
  useLayoutEffect(() => {
    if (!state || !ref.current) { setPos(null); return; }
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let x = state.x;
    let y = state.y;
    if (x + rect.width + margin > window.innerWidth) x = window.innerWidth - rect.width - margin;
    if (y + rect.height + margin > window.innerHeight) y = window.innerHeight - rect.height - margin;
    if (x < margin) x = margin;
    if (y < margin) y = margin;
    setPos({ x, y });
  }, [state]);

  // Close in the broadest set of "user moved on" scenarios so the menu never
  // outstays its welcome. Capture-phase click-away beats React's onClick so a
  // first click outside dismisses without also activating whatever is below.
  useEffect(() => {
    if (!state) return;
    const items = state.items;

    function dismiss() { onClose(); }

    function onMouseDownAway(e: MouseEvent) {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (!ref.current) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[highlighted];
        if (item && !item.separator && !item.disabled) { item.onClick(); onClose(); }
      } else if (e.key === 'Home') { e.preventDefault(); setHighlighted(firstActive(items)); }
      else if (e.key === 'End') { e.preventDefault(); setHighlighted(lastActive(items)); }
    }
    function moveHighlight(delta: number) {
      setHighlighted((h) => nextActive(items, h, delta));
    }

    // Right-click anywhere outside immediately replaces the menu — listening
    // to contextmenu on document so the *new* contextmenu handler downstream
    // can re-open with fresh items without a stale frame in between.
    function onContextMenuOutside(e: MouseEvent) {
      if (ref.current && ref.current.contains(e.target as Node)) {
        // Eat the contextmenu inside the menu so the OS one doesn't show.
        e.preventDefault();
        return;
      }
      // Don't preventDefault — let the underlying handler decide.
      onClose();
    }

    document.addEventListener('mousedown', onMouseDownAway, true);
    document.addEventListener('contextmenu', onContextMenuOutside, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    // Canvas wheel/pan events fire on the document — close the menu so it
    // doesn't float over a moved canvas pointing at nothing.
    window.addEventListener('wheel', dismiss, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onMouseDownAway, true);
      document.removeEventListener('contextmenu', onContextMenuOutside, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('wheel', dismiss);
    };
  }, [state, highlighted, onClose]);

  if (!state) return null;

  // Compute a sensible default position before the layout effect adjusts it.
  const fallbackX = state.x;
  const fallbackY = state.y;
  const x = pos?.x ?? fallbackX;
  const y = pos?.y ?? fallbackY;

  function activate(item: ContextMenuItem) {
    if (item.disabled || item.separator) return;
    onClose();
    // Run on next tick so React doesn't try to update state on an unmounting
    // tree if the action opens another portal.
    setTimeout(() => item.onClick(), 0);
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        minWidth: MIN_WIDTH,
        // Hide the menu for the initial paint until the layout effect settles
        // its clamped position — prevents a one-frame flash off-screen.
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-menu rounded-md surface-overlay py-1 text-xs animate-[stemma-menu-in_120ms_ease-out]"
    >
      {state.items.map((item, i) => {
        if (item.separator) {
          return <div key={item.id} className="my-1 border-t border-subtle" style={{ height: 1 }} />;
        }
        const Icon = item.icon;
        const isHi = i === highlighted && !item.disabled;
        return (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            tabIndex={-1}
            onMouseEnter={() => !item.disabled && setHighlighted(i)}
            onClick={() => activate(item)}
            style={{ height: ITEM_HEIGHT }}
            className={clsx(
              'w-full text-left px-3 flex items-center gap-2 transition-colors',
              item.disabled && 'text-faint cursor-not-allowed',
              !item.disabled && item.destructive && (isHi
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'text-rose-600 dark:text-rose-400'),
              !item.disabled && !item.destructive && (isHi
                ? 'bg-indigo-500/10 text-zinc-900 dark:text-zinc-100'
                : 'text-body'),
            )}
          >
            {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5" />}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="text-[10px] text-faint font-mono shrink-0">{item.hint}</span>}
            {item.opensDialog && <ChevronRight className="w-3 h-3 text-faint shrink-0" />}
          </button>
        );
      })}
      <style>{`
        @keyframes stemma-menu-in {
          from { opacity: 0; transform: translateY(-2px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>,
    document.body
  );
}

function firstActive(items: ContextMenuItem[]): number {
  const i = items.findIndex((x) => !x.separator && !x.disabled);
  return i >= 0 ? i : 0;
}

function lastActive(items: ContextMenuItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].separator && !items[i].disabled) return i;
  }
  return 0;
}

function nextActive(items: ContextMenuItem[], from: number, delta: number): number {
  if (items.length === 0) return 0;
  let i = from;
  for (let step = 0; step < items.length; step++) {
    i = (i + delta + items.length) % items.length;
    const it = items[i];
    if (!it.separator && !it.disabled) return i;
  }
  return from;
}

// Re-export common icons used by callers when constructing items.
export const ContextIcons = { Edit3, Trash2, Copy, TagIcon, Lightbulb, Plus, Workflow, Layers };

// Approximate menu height — used by callers if they want to pre-clamp.
export function approximateMenuHeight(items: ContextMenuItem[]): number {
  let h = 8; // padding
  for (const i of items) h += i.separator ? SEP_HEIGHT : ITEM_HEIGHT;
  return h;
}

export const _internals = { ITEM_HEIGHT, SEP_HEIGHT };
