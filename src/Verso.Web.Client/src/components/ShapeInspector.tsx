import { Trash2, Wand2, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import {
  type Shape, type ShapeArrow, type ShapeEllipse, type ShapeImage, type ShapeLabel, type ShapeLinkKind, type ShapeRect, type ShapeTriangle,
  removeShape, saveShapes, styleForLinkKind, updateShape,
} from '@/lib/shapes';
import { CommentsPanel } from './CommentsPanel';
import { applyOperation } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { loadLayout, saveLayout } from '@/lib/layout';
import type { ArchElementKind, ViewKind } from '@/lib/types';
import { useState } from 'react';

interface Props { viewKey: string; workspaceRoot: string; }

/** Inspector panel that mirrors the architectural Element inspector — for free-form shapes.
 *  Accessed when `selectedShapeId` is non-null on a custom view. */
export function ShapeInspector({ viewKey, workspaceRoot }: Props) {
  const shapes = useApp((s) => s.shapes[viewKey]) ?? [];
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const setShapesFor = useApp((s) => s.setShapesFor);
  const selectShape = useApp((s) => s.selectShape);
  const setToast = useApp((s) => s.setToast);
  const customPropsAll = useApp((s) => s.customProps);
  const setCustomProp = useApp((s) => s.setCustomProp);
  const removeCustomProp = useApp((s) => s.removeCustomProp);

  const shape = shapes.find((s) => s.id === selectedShapeId);
  if (!shape) return null;
  const shapeProps = customPropsAll[shape.id] ?? {};

  function patch(values: Partial<Shape>) {
    const cur = useApp.getState().shapes[viewKey] ?? [];
    const next = updateShape(cur, shape!.id, values as Partial<Shape>);
    setShapesFor(viewKey, next);
    saveShapes(workspaceRoot, viewKey, next);
  }

  function onRemove() {
    const cur = useApp.getState().shapes[viewKey] ?? [];
    const next = removeShape(cur, shape!.id);
    setShapesFor(viewKey, next);
    saveShapes(workspaceRoot, viewKey, next);
    selectShape(null);
    setToast({ kind: 'info', text: 'Shape removed' });
  }

  return (
    <aside className="w-80 shrink-0 border-l border-default surface flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-default flex items-center gap-2">
        <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 font-semibold">
          {shape.kind}
        </span>
        <span className="text-xs text-faint truncate font-mono">{shape.id}</span>
        <span className="ml-auto flex items-center">
          <button
            onClick={() => selectShape(null)}
            title="Close"
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3 text-xs">
        {/* Convert to model element — only meaningful for box-like shapes (rect / ellipse / image).
            Arrow → link conversion is queued for a later epic; label is too sparse to promote. */}
        {(shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'image') && (
          <ConvertToElementBlock shape={shape} viewKey={viewKey} workspaceRoot={workspaceRoot} />
        )}

        {/* Common: label / text */}
        {shape.kind !== 'arrow' && (
          <Field label="Label">
            <input
              className="input-base w-full"
              value={(shape as ShapeRect | ShapeEllipse | ShapeImage | ShapeLabel).kind === 'label'
                ? (shape as ShapeLabel).text
                : ((shape as ShapeRect | ShapeEllipse | ShapeImage).label ?? '')}
              placeholder="(no label)"
              onChange={(e) => {
                if (shape.kind === 'label') patch({ text: e.target.value } as Partial<ShapeLabel>);
                else patch({ label: e.target.value } as Partial<ShapeRect>);
              }}
            />
          </Field>
        )}
        {shape.kind === 'arrow' && (
          <Field label="Label">
            <input
              className="input-base w-full"
              value={(shape as ShapeArrow).label ?? ''}
              placeholder="(no label)"
              onChange={(e) => patch({ label: e.target.value } as Partial<ShapeArrow>)}
            />
          </Field>
        )}

        {/* Multi-line text body for box-like shapes — the draw.io "Option A / Variants" boxes. */}
        {(shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'triangle') && (
          <>
            <Field label="Text">
              <textarea
                className="input-base w-full resize-y leading-relaxed"
                rows={4}
                value={(shape as ShapeRect).text ?? ''}
                placeholder="Body text — wraps inside the shape…"
                onChange={(e) => patch({ text: e.target.value } as Partial<ShapeRect>)}
              />
            </Field>
            <Field label="Text size">
              <input
                type="number" min={8} max={48}
                className="input-base w-full"
                value={(shape as ShapeRect).fontSize ?? 12}
                onChange={(e) => patch({ fontSize: Number(e.target.value) || 12 } as Partial<ShapeRect>)}
              />
            </Field>
            <Field label="Text colour">
              <ColourSwatches
                value={(shape as ShapeRect).textColor ?? 'rgb(39,39,42)'}
                presets={['rgb(39,39,42)', '#ffffff', 'rgb(99, 102, 241)', 'rgb(16, 185, 129)', 'rgb(244, 63, 94)', 'rgb(245, 158, 11)']}
                onChange={(c) => patch({ textColor: c } as Partial<ShapeRect>)}
              />
            </Field>
            {shape.kind === 'rect' && (
              <Field label="Corner radius">
                <input
                  type="number" min={0} max={40}
                  className="input-base w-full"
                  value={(shape as ShapeRect).radius ?? 0}
                  onChange={(e) => patch({ radius: Number(e.target.value) || 0 } as Partial<ShapeRect>)}
                />
              </Field>
            )}
          </>
        )}

        {/* Position + size for box-like kinds */}
        {(shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'triangle' || shape.kind === 'image') && (
          <BoxGeometry shape={shape} onPatch={(v) => patch(v)} />
        )}

        {/* Stroke */}
        {(shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'triangle' || shape.kind === 'arrow') && (
          <StrokeBlock shape={shape} onPatch={(v) => patch(v)} />
        )}

        {/* Fill */}
        {(shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'triangle') && (
          <Field label="Fill">
            <ColourSwatches
              value={(shape as ShapeRect).fill}
              presets={[
                'transparent', 'rgba(99, 102, 241, 0.06)', 'rgba(244, 114, 182, 0.06)',
                'rgba(16, 185, 129, 0.08)', 'rgba(245, 158, 11, 0.08)', 'rgba(244, 63, 94, 0.08)',
                'rgb(99, 102, 241)', 'rgb(244, 114, 182)', 'rgb(16, 185, 129)',
              ]}
              onChange={(fill) => patch({ fill } as Partial<ShapeRect>)}
            />
          </Field>
        )}

        {/* Appearance parity with element nodes — fill style / shadow / motion. */}
        {(shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'triangle') && (
          <>
            <Field label="Fill style">
              <SegRow
                value={(shape as ShapeRect).fillStyle ?? 'solid'}
                options={[{ v: 'solid', l: 'Solid' }, { v: 'gradient', l: 'Gradient' }]}
                onChange={(v) => patch({ fillStyle: v } as Partial<ShapeRect>)}
              />
            </Field>
            <Field label="Shadow">
              <SegRow
                value={(shape as ShapeRect).shadow ?? 'none'}
                options={[{ v: 'none', l: 'Flat' }, { v: 'soft', l: 'Soft' }, { v: 'raised', l: 'Raised' }, { v: 'glow', l: 'Glow' }]}
                onChange={(v) => patch({ shadow: v } as Partial<ShapeRect>)}
              />
            </Field>
            <Field label="Animation">
              <SegRow
                value={(shape as ShapeRect).animation ?? 'none'}
                options={[{ v: 'none', l: 'None' }, { v: 'marching', l: 'March' }, { v: 'pulse', l: 'Pulse' }, { v: 'breathe', l: 'Breathe' }]}
                onChange={(v) => patch({ animation: v } as Partial<ShapeRect>)}
              />
            </Field>
            <Field label="Custom properties">
              <ShapePropsEditor
                props={shapeProps}
                onSet={(k, v) => setCustomProp(shape.id, k, v)}
                onRemove={(k) => removeCustomProp(shape.id, k)}
              />
            </Field>
          </>
        )}

        {/* Label-specific font size + colour */}
        {shape.kind === 'label' && (
          <>
            <Field label="Font size">
              <input
                type="number" min={8} max={64}
                className="input-base w-full"
                value={(shape as ShapeLabel).fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) || 14 } as Partial<ShapeLabel>)}
              />
            </Field>
            <Field label="Colour">
              <ColourSwatches
                value={(shape as ShapeLabel).color}
                presets={['rgb(63, 63, 70)', 'rgb(99, 102, 241)', 'rgb(16, 185, 129)', 'rgb(245, 158, 11)', 'rgb(244, 63, 94)']}
                onChange={(color) => patch({ color } as Partial<ShapeLabel>)}
              />
            </Field>
          </>
        )}

        {/* Z-order */}
        <Field label="Layer">
          <div className="flex gap-1">
            <button onClick={() => patch({ z: -1 } as Partial<Shape>)} className="btn btn-sm btn-ghost flex-1">Back</button>
            <button onClick={() => patch({ z: 0 } as Partial<Shape>)} className="btn btn-sm btn-ghost flex-1">Mid</button>
            <button onClick={() => patch({ z: 1 } as Partial<Shape>)} className="btn btn-sm btn-ghost flex-1">Front</button>
          </div>
        </Field>

        {/* Relationship kind for arrows — same vocabulary as model links so an architect
            sees one mental model across model edges and free-form arrows. */}
        {shape.kind === 'arrow' && (
          <RelationshipKindPicker arrow={shape as ShapeArrow} onPatch={(v) => patch(v)} />
        )}

        {/* Endpoint info for arrows */}
        {shape.kind === 'arrow' && <ArrowEndpointInfo arrow={shape as ShapeArrow} />}

        {/* Comments — same substrate the model elements use, targeting the shape id. */}
        <CommentsPanel targetKind="shape" targetId={shape.id} title={(shape as ShapeRect).label ?? shape.kind} />
      </div>

      <div className="p-3 border-t border-default">
        <button onClick={onRemove} className="btn btn-md btn-destructive w-full">
          <Trash2 className="w-3.5 h-3.5" /> Remove shape
        </button>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-faint mb-1">{label}</div>
      {children}
    </label>
  );
}

function BoxGeometry({ shape, onPatch }: { shape: ShapeRect | ShapeEllipse | ShapeTriangle | ShapeImage; onPatch: (v: Partial<Shape>) => void }) {
  return (
    <Field label="Geometry">
      <div className="grid grid-cols-2 gap-1">
        <NumInput label="x" value={shape.x} onChange={(v) => onPatch({ x: v } as Partial<Shape>)} />
        <NumInput label="y" value={shape.y} onChange={(v) => onPatch({ y: v } as Partial<Shape>)} />
        <NumInput label="w" value={shape.w} onChange={(v) => onPatch({ w: Math.max(20, v) } as Partial<Shape>)} />
        <NumInput label="h" value={shape.h} onChange={(v) => onPatch({ h: Math.max(20, v) } as Partial<Shape>)} />
      </div>
    </Field>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-faint text-[10px] w-3">{label}</span>
      <input
        type="number"
        className="input-base w-full text-xs"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  );
}

function StrokeBlock({ shape, onPatch }: { shape: ShapeRect | ShapeEllipse | ShapeTriangle | ShapeArrow; onPatch: (v: Partial<Shape>) => void }) {
  return (
    <>
      <Field label="Stroke colour">
        <ColourSwatches
          value={shape.stroke}
          presets={['rgb(99, 102, 241)', 'rgb(244, 114, 182)', 'rgb(16, 185, 129)', 'rgb(245, 158, 11)', 'rgb(244, 63, 94)', 'rgb(63, 63, 70)']}
          onChange={(stroke) => onPatch({ stroke } as Partial<Shape>)}
        />
      </Field>
      <Field label="Stroke width">
        <input type="range" min={1} max={6} value={shape.strokeWidth}
          onChange={(e) => onPatch({ strokeWidth: Number(e.target.value) } as Partial<Shape>)}
          className="w-full" />
      </Field>
      <Field label="Stroke style">
        <div className="flex gap-1">
          {(['solid', 'dashed', 'dotted'] as const).map((style) => (
            <button
              key={style}
              onClick={() => onPatch({ strokeStyle: style } as Partial<Shape>)}
              className={`btn btn-sm flex-1 ${shape.strokeStyle === style ? 'btn-primary' : 'btn-ghost'}`}
            >
              {style}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function ColourSwatches({ value, presets, onChange }: { value: string; presets: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {presets.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          aria-label={`Use colour ${p}`}
          title={p}
          className={`w-5 h-5 rounded border ${value === p ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-default'}`}
          style={{ background: p === 'transparent' ? 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.1) 4px 8px)' : p }}
        />
      ))}
    </div>
  );
}

const CONVERT_TARGETS: Array<{ kind: ArchElementKind; label: string }> = [
  { kind: 'module', label: 'Module' },
  { kind: 'boundedContext', label: 'Bounded Context' },
  { kind: 'softwareSystem', label: 'Software System' },
  { kind: 'container', label: 'Container' },
  { kind: 'capability', label: 'Capability' },
  { kind: 'useCase', label: 'Use Case' },
  { kind: 'person', label: 'Person' },
];

function ConvertToElementBlock({ shape, viewKey, workspaceRoot }: {
  shape: ShapeRect | ShapeEllipse | ShapeImage;
  viewKey: string;
  workspaceRoot: string;
}) {
  const setShapesFor = useApp((s) => s.setShapesFor);
  const setToast = useApp((s) => s.setToast);
  const selectShape = useApp((s) => s.selectShape);
  const selectElement = useApp((s) => s.selectElement);
  const arch = useApp((s) => s.arch);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function convert(kind: ArchElementKind) {
    setBusy(true);
    setOpen(false);
    try {
      const name = (shape.label && shape.label.trim()) || `New ${kind}`;
      const r = await applyOperation({
        kind: 'AddElement', opId: `op_${Date.now()}`,
        elementKind: kind, name,
      });
      if ('reason' in r) {
        setToast({ kind: 'error', text: friendlyOpError(r) });
        return;
      }
      // Find the freshly created element by (kind + name) — same heuristic the canvas drop uses.
      // Wait for the SignalR refresh to land the new element in the arch model before reading.
      await new Promise((res) => setTimeout(res, 150));
      const refreshed = useApp.getState().arch ?? arch;
      const last = refreshed?.elements && [...refreshed.elements].reverse()
        .find((el) => el.kind === kind && el.name === name);
      if (last) {
        // Position the new element where the shape was so the architect doesn't lose visual context.
        const positions = loadLayout(workspaceRoot, viewKey as ViewKind);
        positions[last.id] = { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
        saveLayout(workspaceRoot, viewKey as ViewKind, positions);
        selectElement(last.id);
      }
      // Remove the shape so we don't have a duplicate visual.
      const cur = useApp.getState().shapes[viewKey] ?? [];
      const next = removeShape(cur, shape.id);
      setShapesFor(viewKey, next);
      saveShapes(workspaceRoot, viewKey, next);
      selectShape(null);
      setToast({ kind: 'success', text: `Promoted shape to ${kind} "${name}".` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label="Convert to">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={open}
          className="btn btn-md btn-secondary w-full"
        >
          <Wand2 className="w-3 h-3" />
          {busy ? 'Converting…' : 'Convert this shape into…'}
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 surface-overlay rounded border border-default z-popover overflow-hidden">
            {CONVERT_TARGETS.map((t) => (
              <button
                key={t.kind}
                onClick={() => convert(t.kind)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] text-faint mt-1 leading-snug">
        Promotes this shape into a real model element written into <code>Architecture.cs</code>.
        The shape is removed; relationships drawn to it become free-coord arrows until you re-anchor them.
      </p>
    </Field>
  );
}

const DEPENDENCY_VERBS = [
  'uses', 'calls', 'consumes', 'publishes', 'reads', 'subscribes',
  'invokes', 'composes', 'inherits', 'implements', 'governs', 'triggers',
];

function RelationshipKindPicker({ arrow, onPatch }: { arrow: ShapeArrow; onPatch: (v: Partial<Shape>) => void }) {
  const linkKind: ShapeLinkKind = arrow.linkKind ?? 'dataFlow';
  return (
    <>
      <Field label="Relationship">
        <div className="flex gap-1">
          {(['dataFlow', 'dependency'] as const).map((k) => (
            <button
              key={k}
              onClick={() => onPatch({
                linkKind: k,
                strokeStyle: styleForLinkKind(k).strokeStyle,
              } as Partial<ShapeArrow>)}
              className={`btn btn-sm flex-1 ${linkKind === k ? 'btn-primary' : 'btn-ghost'}`}
            >
              {k === 'dataFlow' ? 'Data flow' : 'Dependency'}
            </button>
          ))}
        </div>
      </Field>
      {linkKind === 'dataFlow' && (
        <Field label="Payload">
          <input
            className="input-base w-full"
            value={arrow.payload ?? ''}
            placeholder="e.g. InvoiceCreated"
            onChange={(e) => onPatch({ payload: e.target.value } as Partial<ShapeArrow>)}
          />
        </Field>
      )}
      {linkKind === 'dependency' && (
        <Field label="Verb">
          <input
            list="verso-dep-verbs"
            className="input-base w-full"
            value={arrow.linkSubKind ?? ''}
            placeholder="uses"
            onChange={(e) => onPatch({ linkSubKind: e.target.value } as Partial<ShapeArrow>)}
          />
          <datalist id="verso-dep-verbs">
            {DEPENDENCY_VERBS.map((v) => <option key={v} value={v} />)}
          </datalist>
        </Field>
      )}
    </>
  );
}

function ArrowEndpointInfo({ arrow }: { arrow: ShapeArrow }) {
  const desc = (a: typeof arrow.fromAnchor): string => {
    if (!a) return 'free coordinate';
    if (a.kind === 'free') return 'free coordinate';
    if (a.kind === 'element') return `→ element ${a.id}`;
    return `→ shape ${a.id}`;
  };
  return (
    <Field label="Endpoints">
      <div className="text-[11px] text-muted leading-relaxed">
        From: <span className="font-mono">{desc(arrow.fromAnchor)}</span><br />
        To: <span className="font-mono">{desc(arrow.toAnchor)}</span>
      </div>
      <p className="text-[10px] text-faint mt-1">
        Drag a docking dot to re-anchor. Anchored endpoints follow their target.
      </p>
    </Field>
  );
}

function SegRow<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={clsx(
            'flex-1 px-1.5 py-1 text-[11px] rounded border transition-colors',
            value === o.v
              ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
              : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700',
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function ShapePropsEditor({ props, onSet, onRemove }: { props: Record<string, string>; onSet: (k: string, v: string) => void; onRemove: (k: string) => void }) {
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const entries = Object.entries(props);
  return (
    <div className="space-y-1">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-1">
          <span className="font-mono text-[11px] text-zinc-500 w-16 truncate" title={key}>{key}</span>
          <input className="input-base flex-1 min-w-0 text-xs" value={val} onChange={(e) => onSet(key, e.target.value)} />
          <button onClick={() => onRemove(key)} aria-label={`Remove ${key}`} className="p-1 rounded text-faint hover:text-rose-500"><Trash2 className="w-3 h-3" /></button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input className="input-base w-16 min-w-0 font-mono text-[11px]" placeholder="key" value={k} onChange={(e) => setK(e.target.value)} />
        <input className="input-base flex-1 min-w-0 text-xs" placeholder="value" value={v} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && k.trim()) { onSet(k.trim(), v); setK(''); setV(''); } }} />
        <button onClick={() => { if (k.trim()) { onSet(k.trim(), v); setK(''); setV(''); } }} aria-label="Add property" className="btn btn-sm btn-secondary px-2"><Plus className="w-3 h-3" /></button>
      </div>
    </div>
  );
}
