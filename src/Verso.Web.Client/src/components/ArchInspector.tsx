import { useState, useEffect } from 'react';
import { X, Edit3, Trash2, Activity, Workflow } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { DEFAULT_EDGE_STYLE, type EdgeLineStyle, type EdgeStyle } from '@/lib/edgeStyles';

export function ArchInspector() {
  const arch = useApp((s) => s.arch);
  const elementId = useApp((s) => s.selectedElementId);
  const linkId = useApp((s) => s.selectedLinkId);

  if (!arch || (!elementId && !linkId)) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-6 hidden lg:flex flex-col items-center justify-center text-center">
        <Activity className="w-6 h-6 text-zinc-300 dark:text-zinc-700 mb-2" />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">Select an element or relationship<br />to inspect and edit.</p>
      </aside>
    );
  }

  if (linkId) return <LinkInspectorBody linkId={linkId} />;
  if (elementId) return <ElementInspectorBody elementId={elementId} />;
  return null;
}

function ElementInspectorBody({ elementId }: { elementId: string }) {
  const arch = useApp((s) => s.arch)!;
  const select = useApp((s) => s.selectElement);
  const setToast = useApp((s) => s.setToast);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const e = arch.elements.find((x) => x.id === elementId);
  if (!e) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">No longer in model.</p>
      </aside>
    );
  }

  async function handleRename() {
    if (!e || !renameValue.trim() || renameValue === e.name) { setRenaming(false); return; }
    const r = await applyOperation({
      kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: e.id, newName: renameValue.trim(),
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Renamed' });
    setRenaming(false);
  }

  async function handleRemove() {
    if (!e) return;
    if (!confirm(`Remove ${e.name}?`)) return;
    const r = await applyOperation({ kind: 'RemoveElement', opId: `op_${Date.now()}`, elementId: e.id });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Removed' }); select(null); }
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(ev) => setRenameValue(ev.target.value)}
            onBlur={handleRename}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') handleRename();
              if (ev.key === 'Escape') setRenaming(false);
            }}
            className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-sm flex-1 outline-none focus:border-indigo-500"
          />
        ) : (
          <>
            <h2 className="text-sm font-semibold flex-1 truncate">{e.name}</h2>
            <button
              className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              onClick={() => { setRenameValue(e.name); setRenaming(true); }}
              title="Rename"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => select(null)} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
        <Field label="Kind" value={e.kind} />
        <Field label="Id" value={e.id} mono />
        {Object.entries(e.attributes).map(([k, v]) =>
          v ? <Field key={k} label={k} value={v} mono /> : null
        )}
      </div>
      <div className="p-3 mt-auto border-t border-zinc-200 dark:border-zinc-800">
        <button
          onClick={handleRemove}
          className="w-full text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/40 dark:border-rose-500/30 rounded px-2 py-1.5 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove element
        </button>
      </div>
    </aside>
  );
}

function LinkInspectorBody({ linkId }: { linkId: string }) {
  const arch = useApp((s) => s.arch)!;
  const selectLink = useApp((s) => s.selectLink);
  const setToast = useApp((s) => s.setToast);
  const edgeStyles = useApp((s) => s.edgeStyles);
  const setEdgeStyleFor = useApp((s) => s.setEdgeStyleFor);
  const link = arch.links.find((x) => x.id === linkId);
  const userStyle: EdgeStyle = edgeStyles[linkId] ?? DEFAULT_EDGE_STYLE;

  const [payloadEdit, setPayloadEdit] = useState('');
  const [kindEdit, setKindEdit] = useState('');

  useEffect(() => {
    if (link) {
      setPayloadEdit(link.attributes.payload ?? '');
      setKindEdit(link.attributes.kind ?? 'uses');
    }
  }, [link]);

  if (!link) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">Relationship no longer in model.</p>
      </aside>
    );
  }

  const from = arch.elements.find((x) => x.id === link.fromId);
  const to = arch.elements.find((x) => x.id === link.toId);
  const isDataFlow = link.kind === 'dataFlow';

  async function handlePayloadSave() {
    if (!link || !isDataFlow) return;
    if (payloadEdit === (link.attributes.payload ?? '')) return;
    const r = await applyOperation({
      kind: 'SetLinkAttribute', opId: `op_${Date.now()}`,
      linkId: link.id, attributeName: 'payload', value: payloadEdit,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Payload updated' });
  }

  async function handleKindSave() {
    if (!link || isDataFlow) return;
    if (kindEdit === (link.attributes.kind ?? '')) return;
    const r = await applyOperation({
      kind: 'SetLinkAttribute', opId: `op_${Date.now()}`,
      linkId: link.id, attributeName: 'kind', value: kindEdit,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Kind updated' });
  }

  async function handleRemove() {
    if (!link) return;
    if (!confirm(`Remove this ${isDataFlow ? 'data flow' : 'dependency'}?`)) return;
    const r = await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: link.id });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Removed' }); selectLink(null); }
  }

  function setStyle(s: Partial<EdgeStyle>) {
    setEdgeStyleFor(linkId, { ...userStyle, ...s });
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
        <Workflow className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
        <h2 className="text-sm font-semibold flex-1 truncate">
          {isDataFlow ? 'Data Flow' : 'Dependency'}
        </h2>
        <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => selectLink(null)} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        <Section label="Endpoints">
          <Field label="From" value={from?.name ?? link.fromId} />
          <Field label="To" value={to?.name ?? link.toId} />
          <Field label="Id" value={link.id} mono />
        </Section>

        <Section label="Properties">
          {isDataFlow ? (
            <LabeledInput
              label="Payload"
              value={payloadEdit}
              onChange={setPayloadEdit}
              onCommit={handlePayloadSave}
              placeholder="EventName"
            />
          ) : (
            <LabeledInput
              label="Kind"
              value={kindEdit}
              onChange={setKindEdit}
              onCommit={handleKindSave}
              placeholder="uses, calls, reads…"
            />
          )}
        </Section>

        <Section label="Appearance">
          <div className="space-y-2.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Line style</div>
              <div className="flex gap-1">
                {(['solid', 'dashed', 'dotted'] as EdgeLineStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle({ lineStyle: s })}
                    className={clsx(
                      'flex-1 px-2 py-1.5 text-xs rounded border transition-colors',
                      userStyle.lineStyle === s
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                    )}
                  >
                    <LinePreview style={s} />
                    <span className="block mt-0.5 capitalize">{s}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex justify-between">
                <span>Thickness</span><span className="font-mono normal-case tracking-normal">{userStyle.thickness.toFixed(1)}px</span>
              </div>
              <input
                type="range"
                min={1} max={5} step={0.5}
                value={userStyle.thickness}
                onChange={(ev) => setStyle({ thickness: parseFloat(ev.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Color</div>
              <div className="flex gap-1.5 flex-wrap">
                {[undefined, '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setStyle({ color: c })}
                    title={c ?? 'default'}
                    className={clsx(
                      'w-6 h-6 rounded-full border-2 transition-all',
                      (userStyle.color ?? null) === (c ?? null)
                        ? 'border-zinc-900 dark:border-zinc-100 scale-110'
                        : 'border-zinc-200 dark:border-zinc-800'
                    )}
                    style={{
                      background: c ?? (userStyle.color === undefined
                        ? 'repeating-linear-gradient(45deg, #d4d4d8, #d4d4d8 4px, transparent 4px, transparent 8px)'
                        : '#a1a1aa'),
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>

      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
        <button
          onClick={handleRemove}
          className="w-full text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/40 dark:border-rose-500/30 rounded px-2 py-1.5 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove relationship
        </button>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
      <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">{label}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="text-xs flex justify-between gap-2">
      <span className="text-zinc-500 dark:text-zinc-500 shrink-0">{label}</span>
      <span className={clsx('text-right truncate text-zinc-800 dark:text-zinc-200', mono && 'font-mono text-[11px]')}>{value}</span>
    </div>
  );
}

function LabeledInput({ label, value, onChange, onCommit, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; onCommit: () => void; placeholder?: string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(ev) => onChange(ev.target.value)}
        onBlur={onCommit}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
        className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
      />
    </div>
  );
}

function LinePreview({ style }: { style: EdgeLineStyle }) {
  const dash = style === 'dashed' ? '6 3' : style === 'dotted' ? '1 3' : undefined;
  return (
    <svg width="100%" height="6" viewBox="0 0 60 6" preserveAspectRatio="none">
      <line x1="0" y1="3" x2="60" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash} />
    </svg>
  );
}
