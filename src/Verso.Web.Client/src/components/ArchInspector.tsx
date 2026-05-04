import { useState, useEffect } from 'react';
import { X, Edit3, Trash2, Activity, Workflow } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { DEFAULT_EDGE_STYLE, type EdgeLineStyle, type EdgeStyle } from '@/lib/edgeStyles';
import { DEFAULT_NODE_STYLE, type NodeBorderStyle, type NodeStyle } from '@/lib/nodeStyles';
import { fetchElementNarrative } from '@/lib/api';
import { MarkdownEditor } from './MarkdownEditor';

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

const STATUS_OPTIONS = ['', 'current', 'target', 'to-adapt', 'to-be-created', 'deprecated', 'proposed'];

function ElementInspectorBody({ elementId }: { elementId: string }) {
  const arch = useApp((s) => s.arch)!;
  const select = useApp((s) => s.selectElement);
  const setToast = useApp((s) => s.setToast);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [tab, setTab] = useState<'props' | 'lifecycle' | 'appearance' | 'decisions' | 'notes'>('props');
  const [narrative, setNarrative] = useState('');
  const [narrativeLoaded, setNarrativeLoaded] = useState(false);
  const nodeStyles = useApp((s) => s.nodeStyles);
  const setNodeStyleFor = useApp((s) => s.setNodeStyleFor);
  const userNodeStyle: NodeStyle = nodeStyles[elementId] ?? DEFAULT_NODE_STYLE;

  const e = arch.elements.find((x) => x.id === elementId);
  const tag = arch.tags.find((t) => t.targetId === elementId);
  const [status, setStatus] = useState(tag?.lifecycle?.status ?? '');
  const [phase, setPhase] = useState(tag?.lifecycle?.phase ?? '');
  const [squad, setSquad] = useState(tag?.ownership?.squad ?? '');
  const [domain, setDomain] = useState(tag?.ownership?.domain ?? '');
  useEffect(() => {
    setStatus(tag?.lifecycle?.status ?? '');
    setPhase(tag?.lifecycle?.phase ?? '');
    setSquad(tag?.ownership?.squad ?? '');
    setDomain(tag?.ownership?.domain ?? '');
  }, [tag?.targetId, tag?.lifecycle?.status, tag?.lifecycle?.phase, tag?.ownership?.squad, tag?.ownership?.domain]);

  if (!e) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
        <p className="text-xs text-zinc-500">No longer in model.</p>
      </aside>
    );
  }

  async function commitLifecycle(newStatus: string, newPhase: string) {
    const r = await applyOperation({
      kind: 'SetLifecycle', opId: `op_${Date.now()}`,
      targetId: elementId,
      status: newStatus || null,
      phase: newPhase || null,
      validFrom: null,
      validUntil: null,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Lifecycle saved' });
  }

  async function commitOwnership(newSquad: string, newDomain: string) {
    const r = await applyOperation({
      kind: 'SetOwnership', opId: `op_${Date.now()}`,
      targetId: elementId,
      squad: newSquad || null,
      domain: newDomain || null,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Ownership saved' });
  }

  function setStyle(s: Partial<NodeStyle>) {
    setNodeStyleFor(elementId, { ...userNodeStyle, ...s });
  }

  function clearStyle() {
    setNodeStyleFor(elementId, DEFAULT_NODE_STYLE);
  }

  // Lazy-load narrative the first time the Notes tab is opened.
  useEffect(() => {
    if (tab === 'notes' && !narrativeLoaded) {
      fetchElementNarrative(elementId).then((md) => {
        setNarrative(md);
        setNarrativeLoaded(true);
      }).catch(() => setNarrativeLoaded(true));
    }
  }, [tab, elementId, narrativeLoaded]);

  async function saveNotes() {
    const r = await applyOperation({
      kind: 'SetCapabilityNarrative', opId: `op_${Date.now()}`,
      elementId, body: narrative,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Notes saved' });
  }

  const concerningDecisions = (arch.decisions ?? []).filter((d) =>
    (arch.decisionConcerns ?? []).some((c) => c.decisionId === d.id && c.elementId === elementId)
  );

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
      <div className="px-2 pt-2 flex gap-0.5 text-[11px] overflow-x-auto scrollbar-thin">
        {([
          ['props', 'Props'],
          ['lifecycle', 'Lifecycle'],
          ['appearance', 'Appearance'],
          ['decisions', `Decisions${concerningDecisions.length > 0 ? ` (${concerningDecisions.length})` : ''}`],
          ['notes', 'Notes'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx('px-2 py-1 rounded transition-colors whitespace-nowrap',
              tab === key
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/60')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'props' && (
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2 flex-1 overflow-auto">
          <Field label="Kind" value={e.kind} />
          <Field label="Id" value={e.id} mono />
          {Object.entries(e.attributes).map(([k, v]) =>
            v ? <Field key={k} label={k} value={v} mono /> : null
          )}
        </div>
      )}
      {tab === 'lifecycle' && (
        <div className="flex-1 overflow-auto scrollbar-thin">
          <Section label="Lifecycle">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Status</div>
              <select
                value={status}
                onChange={(ev) => { setStatus(ev.target.value); commitLifecycle(ev.target.value, phase); }}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || '(none)'}</option>)}
              </select>
            </div>
            <LabeledInput
              label="Phase"
              value={phase}
              onChange={setPhase}
              onCommit={() => commitLifecycle(status, phase)}
              placeholder="e.g. Q4 2026"
            />
          </Section>
          <Section label="Ownership">
            <LabeledInput
              label="Squad"
              value={squad}
              onChange={setSquad}
              onCommit={() => commitOwnership(squad, domain)}
              placeholder="e.g. Onboarding Squad"
            />
            <LabeledInput
              label="Domain"
              value={domain}
              onChange={setDomain}
              onCommit={() => commitOwnership(squad, domain)}
              placeholder="e.g. Buyer"
            />
          </Section>
        </div>
      )}
      {tab === 'appearance' && (
        <div className="flex-1 overflow-auto scrollbar-thin">
          <Section label="Border">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Style</div>
              <div className="flex gap-1">
                {(['solid', 'dashed', 'dotted'] as NodeBorderStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle({ borderStyle: s })}
                    className={clsx(
                      'flex-1 px-2 py-1.5 text-xs rounded border transition-colors',
                      userNodeStyle.borderStyle === s
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                    )}
                  >
                    <BorderPreview style={s} />
                    <span className="block mt-0.5 capitalize">{s}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex justify-between">
                <span>Width</span><span className="font-mono normal-case tracking-normal">{userNodeStyle.borderWidth.toFixed(0)}px</span>
              </div>
              <input
                type="range"
                min={1} max={5} step={1}
                value={userNodeStyle.borderWidth}
                onChange={(ev) => setStyle({ borderWidth: parseInt(ev.target.value, 10) })}
                className="w-full accent-indigo-500"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Color</div>
              <ColorSwatches value={userNodeStyle.borderColor} onChange={(c) => setStyle({ borderColor: c })} />
            </div>
          </Section>
          <Section label="Fill">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Background</div>
              <ColorSwatches
                value={userNodeStyle.fillColor}
                onChange={(c) => setStyle({ fillColor: c })}
                palette={[undefined, '#eef2ff', '#ecfdf5', '#fef3c7', '#fee2e2', '#ede9fe', '#cffafe', '#fafafa']}
              />
            </div>
          </Section>
          <Section label="">
            <button
              onClick={clearStyle}
              className="w-full text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1.5 transition-colors"
            >
              Reset to default
            </button>
          </Section>
        </div>
      )}
      {tab === 'decisions' && (
        <div className="flex-1 overflow-auto scrollbar-thin">
          <Section label="Concerning this element">
            {concerningDecisions.length === 0 && (
              <p className="text-xs text-zinc-500 italic">No decisions concern this element yet.</p>
            )}
            <ul className="space-y-1.5">
              {concerningDecisions.map((d) => (
                <li
                  key={d.id}
                  className="text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">{d.status}</span>
                    <span className="font-mono text-[10px] text-zinc-500">{d.id}</span>
                  </div>
                  <div className="text-zinc-800 dark:text-zinc-200 mt-1">{d.title}</div>
                </li>
              ))}
            </ul>
            <button
              onClick={async () => {
                const decId = prompt('Decision id to link (e.g. dec_001)')?.trim();
                if (!decId) return;
                const r = await applyOperation({
                  kind: 'AddDecisionConcerns', opId: `op_${Date.now()}`,
                  decisionId: decId, elementId,
                });
                if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
                else setToast({ kind: 'success', text: 'Linked to decision' });
              }}
              className="mt-2 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 border border-indigo-500/30 rounded px-2 py-1 w-full"
            >
              Link an existing decision
            </button>
          </Section>
        </div>
      )}
      {tab === 'notes' && (
        <div className="flex-1 flex flex-col min-h-0">
          <MarkdownEditor value={narrative} onChange={setNarrative} />
          <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={saveNotes}
              className="w-full text-xs px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white"
            >
              Save notes
            </button>
          </div>
        </div>
      )}
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

function BorderPreview({ style }: { style: NodeBorderStyle }) {
  return (
    <div
      className="h-3 rounded border border-current"
      style={{ borderStyle: style, borderWidth: 1.5 }}
    />
  );
}

function ColorSwatches({
  value, onChange, palette = [undefined, '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
}: { value: string | undefined; onChange: (c: string | undefined) => void; palette?: (string | undefined)[] }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {palette.map((c, i) => (
        <button
          key={i}
          onClick={() => onChange(c)}
          title={c ?? 'default'}
          className={clsx(
            'w-6 h-6 rounded-full border-2 transition-all',
            (value ?? null) === (c ?? null)
              ? 'border-zinc-900 dark:border-zinc-100 scale-110'
              : 'border-zinc-200 dark:border-zinc-800'
          )}
          style={{
            background: c ?? (value === undefined
              ? 'repeating-linear-gradient(45deg, #d4d4d8, #d4d4d8 4px, transparent 4px, transparent 8px)'
              : '#a1a1aa'),
          }}
        />
      ))}
    </div>
  );
}

function LinkInspectorBody({ linkId }: { linkId: string }) {
  const arch = useApp((s) => s.arch)!;
  const selectLink = useApp((s) => s.selectLink);
  const setToast = useApp((s) => s.setToast);
  const edgeStyles = useApp((s) => s.edgeStyles);
  const setEdgeStyleFor = useApp((s) => s.setEdgeStyleFor);
  const link = arch.links.find((x) => x.id === linkId);
  const tag = arch.tags.find((t) => t.targetId === linkId);
  const userStyle: EdgeStyle = edgeStyles[linkId] ?? DEFAULT_EDGE_STYLE;

  const [payloadEdit, setPayloadEdit] = useState('');
  const [kindEdit, setKindEdit] = useState('');
  const [linkStatus, setLinkStatus] = useState(tag?.lifecycle?.status ?? '');
  const [linkPhase, setLinkPhase] = useState(tag?.lifecycle?.phase ?? '');
  const [linkSquad, setLinkSquad] = useState(tag?.ownership?.squad ?? '');

  useEffect(() => {
    if (link) {
      setPayloadEdit(link.attributes.payload ?? '');
      setKindEdit(link.attributes.kind ?? 'uses');
    }
    setLinkStatus(tag?.lifecycle?.status ?? '');
    setLinkPhase(tag?.lifecycle?.phase ?? '');
    setLinkSquad(tag?.ownership?.squad ?? '');
  }, [link, tag?.targetId, tag?.lifecycle?.status, tag?.lifecycle?.phase, tag?.ownership?.squad]);

  async function commitLinkLifecycle(status: string, phase: string) {
    const r = await applyOperation({
      kind: 'SetLifecycle', opId: `op_${Date.now()}`,
      targetId: linkId,
      status: status || null,
      phase: phase || null,
      validFrom: null,
      validUntil: null,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Lifecycle saved' });
  }

  async function commitLinkOwnership(squad: string) {
    const r = await applyOperation({
      kind: 'SetOwnership', opId: `op_${Date.now()}`,
      targetId: linkId,
      squad: squad || null,
      domain: null,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Ownership saved' });
  }

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

        <Section label="Lifecycle & Owner">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Status</div>
            <select
              value={linkStatus}
              onChange={(ev) => { setLinkStatus(ev.target.value); commitLinkLifecycle(ev.target.value, linkPhase); }}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || '(none)'}</option>)}
            </select>
          </div>
          <LabeledInput
            label="Phase"
            value={linkPhase}
            onChange={setLinkPhase}
            onCommit={() => commitLinkLifecycle(linkStatus, linkPhase)}
            placeholder="e.g. Q4 2026"
          />
          <LabeledInput
            label="Squad"
            value={linkSquad}
            onChange={setLinkSquad}
            onCommit={() => commitLinkOwnership(linkSquad)}
            placeholder="e.g. Onboarding Squad"
          />
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
