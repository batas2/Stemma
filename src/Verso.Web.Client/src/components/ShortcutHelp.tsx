import { X } from 'lucide-react';
import { primaryKeyLabel, shiftKeyLabel } from '@/lib/shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string; description: string; category: string }[] = [
  { category: 'Editing', keys: `${primaryKeyLabel}Z`, description: 'Undo' },
  { category: 'Editing', keys: `${primaryKeyLabel}${shiftKeyLabel}Z`, description: 'Redo' },
  { category: 'Editing', keys: `${primaryKeyLabel}K`, description: 'Command palette' },
  { category: 'Editing', keys: 'Del / ⌫', description: 'Delete selected element / relationship / shape' },
  { category: 'Editing', keys: 'F2', description: 'Rename element · edit relationship type in place' },
  { category: 'Navigation', keys: 'Tab', description: 'Cycle through elements' },
  { category: 'Navigation', keys: `${shiftKeyLabel}Tab`, description: 'Cycle backwards' },
  { category: 'Navigation', keys: 'Enter', description: 'Open inspector for selected' },
  { category: 'Navigation', keys: 'Esc', description: 'Clear selection' },
  { category: 'Navigation', keys: '1 / 2 / 3', description: 'Module Map · Dependencies · Concerns view' },
  { category: 'Navigation', keys: '/', description: 'Focus sidebar search' },
  { category: 'Navigation', keys: '? (Shift+/)', description: 'Toggle this help overlay' },
  { category: 'Layout', keys: '↑ ↓ ← →', description: 'Nudge selected by 10 px' },
  { category: 'Layout', keys: `${shiftKeyLabel}+↑ ↓ ← →`, description: 'Nudge selected by 1 px' },
  { category: 'Layout', keys: `${primaryKeyLabel}A`, description: 'Select all elements' },
  { category: 'Layout', keys: `${primaryKeyLabel}+ / ${primaryKeyLabel}−`, description: 'Zoom in / out' },
  { category: 'Layout', keys: `${primaryKeyLabel}0`, description: 'Fit the whole diagram into view' },
  { category: 'Layout', keys: 'Drag', description: 'Move element' },
  { category: 'Canvas', keys: 'Right-click', description: 'Context menu (node / edge / pane)' },
  { category: 'Canvas', keys: 'Double-click edge', description: 'Edit relationship type / payload in place' },
  { category: 'Canvas', keys: `${shiftKeyLabel}+Double-click edge`, description: 'Add waypoint' },
  { category: 'Canvas', keys: 'Click waypoint dot', description: 'Remove waypoint' },
];

export function ShortcutHelp({ open, onClose }: Props) {
  if (!open) return null;
  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.category)));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[560px] max-w-[90vw] max-h-[80vh] overflow-auto scrollbar-thin rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <h2 className="text-sm font-semibold flex-1">Keyboard shortcuts</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">{g}</h3>
              <ul className="space-y-1">
                {SHORTCUTS.filter((s) => s.category === g).map((s, i) => (
                  <li key={i} className="text-xs flex items-center gap-3">
                    <kbd className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 min-w-[80px] text-center">
                      {s.keys}
                    </kbd>
                    <span className="text-zinc-700 dark:text-zinc-300">{s.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
