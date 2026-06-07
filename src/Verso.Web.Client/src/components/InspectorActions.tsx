import { useState } from 'react';
import { ChevronsRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useApp } from '@/lib/store';

/** Event every inspector Section listens for to fold/unfold in unison. */
export const SECTIONS_EVENT = 'verso:inspector-sections';

/** The collapse-all-sections + hide-panel buttons shared by every inspector header.
 *  `showCollapseAll` is off for inspectors with no foldable sections (shapes, empty state). */
export function InspectorActions({ showCollapseAll = true }: { showCollapseAll?: boolean }) {
  const setInspectorOpen = useApp((s) => s.setInspectorOpen);
  const [allOpen, setAllOpen] = useState(true);

  function toggleAll() {
    const next = !allOpen;
    setAllOpen(next);
    window.dispatchEvent(new CustomEvent(SECTIONS_EVENT, { detail: { open: next } }));
  }

  const btn = 'p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100';
  return (
    <>
      {showCollapseAll && (
        <button onClick={toggleAll} className={btn} title={allOpen ? 'Collapse all sections' : 'Expand all sections'}>
          {allOpen ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
        </button>
      )}
      <button onClick={() => setInspectorOpen(false)} className={btn} title="Hide inspector panel">
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>
    </>
  );
}
