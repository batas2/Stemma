import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';
import { useApp } from '@/lib/store';
import { addShape, newImage, saveShapes, type Shape } from '@/lib/shapes';
import { STENCILS, STENCIL_CATEGORIES } from '@/lib/stencils';

interface Props {
  viewKey: string;
  workspaceRoot: string;
  onClose: () => void;
}

/**
 * Floating right-rail drawer that lists curated stencils, grouped by category.
 * Clicking a stencil drops it on the canvas at the centre of the current viewport.
 * Drag-and-drop is also wired so users can place precisely.
 */
export function StencilDrawer({ viewKey, workspaceRoot, onClose }: Props) {
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const setShapesFor = useApp((s) => s.setShapesFor);
  const setToast = useApp((s) => s.setToast);
  const selectShape = useApp((s) => s.selectShape);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STENCILS.filter((s) => !q || s.label.toLowerCase().includes(q));
  }, [query]);

  function place(stencilId: string, screenX?: number, screenY?: number) {
    const stencil = STENCILS.find((s) => s.id === stencilId);
    if (!stencil) return;
    const flow = (screenX !== undefined && screenY !== undefined)
      ? screenToFlowPosition({ x: screenX, y: screenY })
      : viewportCenterFlow(getViewport());
    const shape = newImage(flow.x - 32, flow.y - 32, stencil.src, 64, 64);
    shape.label = stencil.label;
    try {
      const next = addShape(useApp.getState().shapes[viewKey] ?? [], shape);
      setShapesFor(viewKey, next);
      saveShapes(workspaceRoot, viewKey, next);
      selectShape(shape.id);
    } catch (err) {
      setToast({ kind: 'error', text: (err as Error).message });
    }
  }

  return (
    <div
      className="absolute right-3 top-12 bottom-3 w-72 z-popover surface-overlay rounded-md border border-default flex flex-col"
      role="dialog"
      aria-label="Stencil library"
    >
      <div className="flex items-center px-3 py-2 border-b border-default">
        <span className="text-xs font-semibold text-body">Stencils</span>
        <span className="ml-2 text-[10px] text-faint">{STENCILS.length} icons</span>
        <button
          onClick={onClose}
          aria-label="Close stencil drawer"
          className="ml-auto p-1 rounded text-faint hover:text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 py-2 border-b border-default">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter stencils"
          className="input-base w-full text-xs"
        />
      </div>
      <div className="flex-1 overflow-auto px-1 py-2 space-y-2">
        {STENCIL_CATEGORIES.map((cat) => {
          const items = filtered.filter((s) => s.category === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id}>
              <div className="text-[10px] uppercase tracking-wider text-faint px-2 mt-2">{cat.label}</div>
              <div className="grid grid-cols-3 gap-1 px-1 mt-1">
                {items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => place(s.id)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/verso-stencil', s.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title={s.label}
                    aria-label={`Add ${s.label} stencil`}
                    className="aspect-square flex flex-col items-center justify-center gap-0.5 p-1 rounded border border-subtle hover:border-default surface text-muted hover:text-body cursor-grab"
                  >
                    <img src={s.src} alt="" className="w-7 h-7" />
                    <span className="text-[9px] truncate w-full text-center">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-xs text-faint text-center">No stencils match.</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-default text-[10px] text-faint">
        Click to drop at viewport centre. Drag to place precisely.
      </div>
    </div>
  );
}

function viewportCenterFlow(vp: { x: number; y: number; zoom: number }): { x: number; y: number } {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;
  // Inverse of the React Flow transform: pane → flow.
  return { x: (w / 2 - vp.x) / vp.zoom, y: (h / 2 - vp.y) / vp.zoom };
}

export const __test__ = { viewportCenterFlow };
export type { Shape };
