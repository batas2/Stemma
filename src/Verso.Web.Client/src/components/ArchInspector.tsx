import { useState, useEffect } from 'react';
import { X, Edit3, Trash2, Activity, Workflow, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { DEFAULT_EDGE_STYLE, type EdgeLineStyle, type EdgeStyle } from '@/lib/edgeStyles';
import { DEFAULT_NODE_STYLE, DEFAULT_VISIBLE_FIELDS, type NodeBorderStyle, type NodeStyle } from '@/lib/nodeStyles';
import { RESERVED_KEYS, type CustomProps } from '@/lib/customProps';
import { ALL_FIELD_KEYS, fieldLabel } from './nodes/ArchNodeView';

// Stable singleton — see customPropsSlot below for why this matters.
const EMPTY_CUSTOM_PROPS: CustomProps = Object.freeze({}) as CustomProps;
import { fetchElementNarrative } from '@/lib/api';
import { NotesModal } from './NotesModal';
import { confirmAction } from './ConfirmDialog';
import { pickFromList } from './PromptDialog';
import { ResizableAside } from './ResizableAside';

export function ArchInspector() {
  const arch = useApp((s) => s.arch);
  const elementId = useApp((s) => s.selectedElementId);
  const linkId = useApp((s) => s.selectedLinkId);

  if (!arch || (!elementId && !linkId)) {
    return (
      <ResizableAside className="hidden lg:flex">
        <div className="p-6 text-center mt-8">
          <Activity className="w-7 h-7 text-zinc-300 dark:text-zinc-700 mb-3 mx-auto" />
          <p className="text-sm font-medium text-body mb-1">Inspector</p>
          <p className="text-xs text-faint mb-4">Select an element or relationship to inspect and edit.</p>
          <ul className="text-[11px] text-muted space-y-1.5 text-left max-w-[220px] mx-auto">
            <li className="flex gap-2"><span className="text-faint shrink-0">•</span><span>Click a node or edge on the canvas.</span></li>
            <li className="flex gap-2"><span className="text-faint shrink-0">•</span><span>Right-click for quick actions.</span></li>
            <li className="flex gap-2"><span className="text-faint shrink-0">•</span><span>Press <kbd className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 font-mono text-[10px]">Tab</kbd> to cycle elements.</span></li>
            <li className="flex gap-2"><span className="text-faint shrink-0">•</span><span>Drag the left edge to resize this panel.</span></li>
          </ul>
        </div>
      </ResizableAside>
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
  const [narrative, setNarrative] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const nodeStyles = useApp((s) => s.nodeStyles);
  const setNodeStyleFor = useApp((s) => s.setNodeStyleFor);
  const userNodeStyle: NodeStyle = nodeStyles[elementId] ?? DEFAULT_NODE_STYLE;
  // Select the slot directly — reading `s.customProps[id] ?? {}` returns a
  // fresh `{}` every snapshot, which trips useSyncExternalStore's reference
  // check and loops forever ("The result of getSnapshot should be cached").
  const customPropsSlot = useApp((s) => s.customProps[elementId]);
  const customProps = customPropsSlot ?? EMPTY_CUSTOM_PROPS;
  const setCustomProp = useApp((s) => s.setCustomProp);
  const removeCustomProp = useApp((s) => s.removeCustomProp);
  const renameCustomProp = useApp((s) => s.renameCustomProp);

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
      <aside className="w-[320px] shrink-0 border-l border-default bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
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

  // Load narrative whenever the selected element changes — small text fetch, fine to do
  // eagerly so the Notes section is ready when the user expands it.
  useEffect(() => {
    fetchElementNarrative(elementId)
      .then((md) => setNarrative(md))
      .catch(() => setNarrative(''));
  }, [elementId]);

  async function saveNotes(value?: string) {
    const body = value ?? narrative;
    if (value !== undefined) setNarrative(value);
    const r = await applyOperation({
      kind: 'SetCapabilityNarrative', opId: `op_${Date.now()}`,
      elementId, body,
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
    const ok = await confirmAction({
      title: `Remove ${e.name}?`,
      body: 'This element will be removed from the model. Linked relationships and decisions will be detached.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const r = await applyOperation({ kind: 'RemoveElement', opId: `op_${Date.now()}`, elementId: e.id });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Removed' }); select(null); }
  }

  return (
    <ResizableAside>
      <div className="px-4 py-3 border-b border-default flex items-center gap-2">
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
      <div className="flex-1 overflow-auto scrollbar-thin">
        <Section label="Properties" persistKey="element.properties" defaultOpen>
          <Field label="Kind" value={e.kind} />
          <Field label="Id" value={e.id} mono />
          {Object.entries(e.attributes).map(([k, v]) =>
            v ? <Field key={k} label={k} value={v} mono /> : null
          )}
        </Section>

        <Section label="Lifecycle" persistKey="element.lifecycle">
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

        <Section label="Ownership" persistKey="element.ownership" defaultOpen={false}>
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

        <Section label="Appearance" persistKey="element.appearance" defaultOpen={false}>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Border style</div>
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
              <span>Border width</span><span className="font-mono normal-case tracking-normal">{userNodeStyle.borderWidth.toFixed(0)}px</span>
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
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Border color</div>
            <ColorSwatches value={userNodeStyle.borderColor} onChange={(c) => setStyle({ borderColor: c })} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Background</div>
            <ColorSwatches
              value={userNodeStyle.fillColor}
              onChange={(c) => setStyle({ fillColor: c })}
              palette={[undefined, '#eef2ff', '#ecfdf5', '#fef3c7', '#fee2e2', '#ede9fe', '#cffafe', '#fafafa']}
            />
          </div>
          {(userNodeStyle.width || userNodeStyle.height) && (
            <div className="text-[10px] text-faint flex justify-between font-mono">
              <span>Size</span>
              <span>{userNodeStyle.width ?? '—'} × {userNodeStyle.height ?? '—'} px</span>
            </div>
          )}
          <button onClick={clearStyle} className="mt-1 btn btn-md btn-ghost border-default w-full">
            Reset appearance
          </button>
        </Section>

        <Section label="Custom properties" persistKey="element.customProps" defaultOpen={Object.keys(customProps).length > 0}>
          <p className="text-[11px] text-faint mb-2 leading-snug">
            Tick a row to render it inside the box on the canvas. Custom rows take a free-form key + value; built-in fields read from the element itself.
          </p>
          <CustomPropsPanel
            visible={userNodeStyle.visibleFields ?? DEFAULT_VISIBLE_FIELDS}
            onVisibleChange={(next) => setStyle({ visibleFields: next })}
            onResetVisible={() => setStyle({ visibleFields: DEFAULT_VISIBLE_FIELDS })}
            props={customProps}
            onSet={(k, v) => setCustomProp(elementId, k, v)}
            onRemove={(k) => removeCustomProp(elementId, k)}
            onRename={(oldK, newK) => renameCustomProp(elementId, oldK, newK)}
          />
        </Section>

        <Section
          label={`Decisions${concerningDecisions.length > 0 ? ` (${concerningDecisions.length})` : ''}`}
          persistKey="element.decisions"
          defaultOpen={concerningDecisions.length > 0}
        >
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
              const all = arch.decisions ?? [];
              const linked = new Set(concerningDecisions.map((d) => d.id));
              const candidates = all.filter((d) => !linked.has(d.id));
              if (candidates.length === 0) {
                setToast({ kind: 'info', text: all.length === 0 ? 'No decisions in the workspace yet.' : 'All decisions are already linked.' });
                return;
              }
              const decId = await pickFromList<string>({
                title: 'Link a decision',
                body: `Pick a decision to associate with this element.`,
                options: candidates.map((d) => ({ value: d.id, label: d.title, hint: d.id })),
              });
              if (!decId) return;
              const r = await applyOperation({
                kind: 'AddDecisionConcerns', opId: `op_${Date.now()}`,
                decisionId: decId, elementId,
              });
              if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
              else setToast({ kind: 'success', text: 'Linked to decision' });
            }}
            className="mt-2 btn btn-md btn-secondary w-full"
          >
            Link an existing decision
          </button>
        </Section>

        <Section label="Notes" persistKey="element.notes" defaultOpen={false}>
          <p className="text-[11px] text-faint mb-2 leading-snug">
            Capability narrative or design notes — opens in a full editor with Markdown support.
          </p>
          <div style={{ maxHeight: 120 }} className="border border-default rounded overflow-hidden bg-zinc-50 dark:bg-zinc-900/40 p-2 text-[11px] text-muted whitespace-pre-wrap line-clamp-5">
            {narrative.trim() ? narrative.split('\n').slice(0, 5).join('\n') : <span className="italic text-faint">No notes yet.</span>}
          </div>
          <button onClick={() => setNotesOpen(true)} className="mt-2 w-full btn btn-md btn-secondary">
            <Edit3 className="w-3 h-3" /> Open editor
          </button>
        </Section>
      </div>
      <div className="p-3 mt-auto border-t border-default">
        <button onClick={handleRemove} className="btn btn-md btn-destructive w-full">
          <Trash2 className="w-3.5 h-3.5" /> Remove element
        </button>
      </div>
      <NotesModal
        open={notesOpen}
        title={`Notes — ${e.name}`}
        initialValue={narrative}
        onClose={() => setNotesOpen(false)}
        onSave={saveNotes}
      />
    </ResizableAside>
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
      <aside className="w-[320px] shrink-0 border-l border-default bg-white dark:bg-zinc-950/60 p-4 hidden lg:block">
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
    const ok = await confirmAction({
      title: `Remove this ${isDataFlow ? 'data flow' : 'dependency'}?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const r = await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: link.id });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else { setToast({ kind: 'success', text: 'Removed' }); selectLink(null); }
  }

  function setStyle(s: Partial<EdgeStyle>) {
    setEdgeStyleFor(linkId, { ...userStyle, ...s });
  }

  return (
    <ResizableAside>
      <div className="px-4 py-3 border-b border-default flex items-center gap-2">
        <Workflow className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
        <h2 className="text-sm font-semibold flex-1 truncate">
          {isDataFlow ? 'Data Flow' : 'Dependency'}
        </h2>
        <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => selectLink(null)} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        <Section label="Endpoints" persistKey="link.endpoints" defaultOpen>
          <Field label="From" value={from?.name ?? link.fromId} />
          <Field label="To" value={to?.name ?? link.toId} />
          <Field label="Id" value={link.id} mono />
        </Section>

        <Section label="Properties" persistKey="link.properties" defaultOpen>
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

        <Section label="Lifecycle & Owner" persistKey="link.lifecycle" defaultOpen={false}>
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

        <Section label="Appearance" persistKey="link.appearance" defaultOpen={false}>
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

      <div className="p-3 border-t border-default">
        <button onClick={handleRemove} className="btn btn-md btn-destructive w-full">
          <Trash2 className="w-3.5 h-3.5" /> Remove relationship
        </button>
      </div>
    </ResizableAside>
  );
}

function Section({ label, children, defaultOpen = true, persistKey }: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  persistKey?: string;
}) {
  // Per-section open/closed state persisted in localStorage so each user keeps the
  // sections they actually use unfolded on next visit.
  const storageKey = persistKey ? `verso.inspector.section:${persistKey}` : null;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !storageKey) return defaultOpen;
    const v = localStorage.getItem(storageKey);
    return v === null ? defaultOpen : v === '1';
  });
  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0');
      return next;
    });
  }
  return (
    <section className="border-b border-zinc-100 dark:border-zinc-800">
      <button
        onClick={toggle}
        className="w-full px-4 py-2.5 flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />}
        <h3 className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</h3>
      </button>
      {open && <div className="px-4 pb-3 space-y-1.5">{children}</div>}
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

function CustomPropsPanel({
  visible, onVisibleChange, onResetVisible,
  props, onSet, onRemove, onRename,
}: {
  visible: string[];
  onVisibleChange: (next: string[]) => void;
  onResetVisible: () => void;
  props: CustomProps;
  onSet: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
}) {
  const customKeys = Object.keys(props);
  const set = new Set(visible);

  function toggle(k: string) {
    const next = new Set(set);
    if (next.has(k)) next.delete(k); else next.add(k);
    // Preserve canonical order: built-ins first, then custom keys in their
    // original add order.
    const ordered = [
      ...ALL_FIELD_KEYS.filter((x) => next.has(x)),
      ...customKeys.filter((x) => next.has(x)),
    ];
    onVisibleChange(ordered);
  }

  // Add row state lives at the bottom of the panel.
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function tryAdd() {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) { setError('Key is required'); return; }
    if (RESERVED_KEYS.has(k)) { setError(`"${k}" is a built-in field — pick another key`); return; }
    if (k in props) { setError(`"${k}" already exists`); return; }
    onSet(k, v);
    setNewKey('');
    setNewValue('');
    setError(null);
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-faint mb-1.5">Built-in fields</div>
        <ul className="space-y-1">
          {ALL_FIELD_KEYS.map((k) => (
            <li key={k}>
              <label className="flex items-center gap-2 text-xs cursor-pointer text-body">
                <input
                  type="checkbox"
                  checked={set.has(k)}
                  onChange={() => toggle(k)}
                  className="accent-indigo-500"
                />
                <span>{fieldLabel(k)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {customKeys.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-faint mb-1.5">Custom</div>
          <ul className="space-y-1">
            {customKeys.map((k) => (
              <PropRow
                key={k}
                propKey={k}
                propValue={props[k]}
                checked={set.has(k)}
                onToggle={() => toggle(k)}
                onSetValue={(next) => onSet(k, next)}
                onRename={(next) => onRename(k, next)}
                onRemove={() => onRemove(k)}
                forbid={(candidate) => RESERVED_KEYS.has(candidate) || (candidate !== k && candidate in props)}
              />
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-faint mb-1.5">Add custom property</div>
        <div className="flex gap-1.5">
          <input
            value={newKey}
            placeholder="key (e.g. Owner)"
            onChange={(e) => { setNewKey(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } }}
            className="input-base flex-1 min-w-0 font-mono text-[11px]"
          />
          <input
            value={newValue}
            placeholder="value"
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } }}
            className="input-base flex-[1.2] min-w-0"
          />
          <button onClick={tryAdd} aria-label="Add property" className="btn btn-md btn-secondary px-2">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{error}</p>}
      </div>

      <button onClick={onResetVisible} className="btn btn-md btn-ghost border-default w-full">
        Reset visible fields to default
      </button>
    </div>
  );
}

function PropRow({
  propKey, propValue, checked, onToggle, onSetValue, onRename, onRemove, forbid,
}: {
  propKey: string;
  propValue: string;
  checked: boolean;
  onToggle: () => void;
  onSetValue: (v: string) => void;
  onRename: (k: string) => void;
  onRemove: () => void;
  forbid: (candidate: string) => boolean;
}) {
  const [k, setK] = useState(propKey);
  const [v, setV] = useState(propValue);
  useEffect(() => { setK(propKey); }, [propKey]);
  useEffect(() => { setV(propValue); }, [propValue]);

  function commitKey() {
    const next = k.trim();
    if (!next || next === propKey) { setK(propKey); return; }
    if (forbid(next)) { setK(propKey); return; }
    onRename(next);
  }
  function commitValue() {
    if (v === propValue) return;
    onSetValue(v);
  }

  return (
    <li className="flex items-center gap-1 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Show ${propKey} on canvas`}
        className="accent-indigo-500 shrink-0"
      />
      <input
        value={k}
        onChange={(e) => setK(e.target.value)}
        onBlur={commitKey}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setK(propKey); (e.target as HTMLInputElement).blur(); } }}
        className="input-base flex-1 min-w-0 font-mono text-[11px]"
      />
      <span className="text-faint shrink-0">:</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commitValue}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(propValue); (e.target as HTMLInputElement).blur(); } }}
        className="input-base flex-[1.2] min-w-0"
      />
      <button onClick={onRemove} aria-label={`Remove ${propKey}`} className="p-1 rounded text-faint hover:text-rose-500 hover:bg-rose-500/10">
        <Trash2 className="w-3 h-3" />
      </button>
    </li>
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
