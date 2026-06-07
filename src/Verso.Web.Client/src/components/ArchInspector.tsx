import { useState, useEffect, useRef } from 'react';
import { X, Edit3, Trash2, Activity, Workflow, ChevronDown, ChevronRight, Plus, Maximize2, Info, FileText, Clock, Users, Palette, Tags, MessageSquare, Spline, ArrowLeftRight } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { InspectorActions, SECTIONS_EVENT } from './InspectorActions';
import { MarkerSelect } from './MarkerSelect';
import { applyOperation } from '@/lib/signalr';
import { friendlyOpError } from '@/lib/opError';
import { DEFAULT_EDGE_STYLE, type EdgeLineStyle, type EdgeStyle, type EdgeAnimSpeed } from '@/lib/edgeStyles';
import { DEFAULT_NODE_STYLE, DEFAULT_VISIBLE_FIELDS, type NodeBorderStyle, type NodeStyle, type NodeFillStyle, type NodeShadow, type NodeAccentSide, type NodeTextSize, type NodeTextAlign, type NodeAnimation, type NodeAnimSpeed } from '@/lib/nodeStyles';
import { RESERVED_KEYS, type CustomProps } from '@/lib/customProps';
import { CommentsPanel } from './CommentsPanel';
import { ALL_FIELD_KEYS, fieldLabel } from './nodes/ArchNodeView';

// Stable singleton — see customPropsSlot below for why this matters.
const EMPTY_CUSTOM_PROPS: CustomProps = Object.freeze({}) as CustomProps;
import { confirmAction } from './ConfirmDialog';
import { ResizableAside } from './ResizableAside';
import { RichTextEditor } from './RichTextEditor';
import { NotesModal } from './NotesModal';
import { loadNote, saveNote } from '@/lib/elementNotes';
import { hashtagProps } from '@/lib/hashtags';

export function ArchInspector() {
  const arch = useApp((s) => s.arch);
  const elementId = useApp((s) => s.selectedElementId);
  const linkId = useApp((s) => s.selectedLinkId);

  if (!arch || (!elementId && !linkId)) {
    return (
      <ResizableAside className="hidden lg:flex">
        <div className="flex justify-end px-2 pt-2">
          <InspectorActions showCollapseAll={false} />
        </div>
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
  const workspace = useApp((s) => s.workspace);
  const [note, setNote] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [appearanceTab, setAppearanceTab] = useState<'presets' | 'style' | 'animation'>('presets');
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Load this element's notes and reflect its #hashtag attributes into custom properties.
  useEffect(() => {
    if (!workspace) { setNote(''); return; }
    const text = loadNote(workspace.rootPath, elementId);
    setNote(text);
    const props = hashtagProps(text);
    const current = useApp.getState().customProps[elementId] ?? {};
    for (const [k, v] of Object.entries(props)) if (current[k] !== v) setCustomProp(elementId, k, v);
  }, [elementId, workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live mirror: reflect the text being typed in the on-canvas editor for this element.
  useEffect(() => {
    function onLive(ev: Event) {
      const d = (ev as CustomEvent).detail as { id: string; text: string };
      if (d.id === elementId) setNote(d.text);
    }
    window.addEventListener('verso:note-live', onLive);
    return () => window.removeEventListener('verso:note-live', onLive);
  }, [elementId]);

  function onNoteChange(next: string) {
    setNote(next);
    if (!workspace) return;
    saveNote(workspace.rootPath, elementId, next); // text persists immediately
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    // Debounce the heavier sync into custom properties (which re-renders the canvas).
    noteSaveTimer.current = setTimeout(() => {
      const props = hashtagProps(next);
      const current = useApp.getState().customProps[elementId] ?? {};
      for (const [k, v] of Object.entries(props)) if (current[k] !== v) setCustomProp(elementId, k, v);
      // Refresh the on-canvas notes preview.
      window.dispatchEvent(new CustomEvent('verso:notes-changed'));
    }, 600);
  }

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
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: 'Lifecycle saved' });
  }

  async function commitOwnership(newSquad: string, newDomain: string) {
    const r = await applyOperation({
      kind: 'SetOwnership', opId: `op_${Date.now()}`,
      targetId: elementId,
      squad: newSquad || null,
      domain: newDomain || null,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: 'Ownership saved' });
  }

  function setStyle(s: Partial<NodeStyle>) {
    setNodeStyleFor(elementId, { ...userNodeStyle, ...s });
  }

  function clearStyle() {
    setNodeStyleFor(elementId, DEFAULT_NODE_STYLE);
  }

  function applyPreset(preset: Partial<NodeStyle>) {
    // A preset is a fresh coherent combo, but keep the user's manual size + visible fields.
    setNodeStyleFor(elementId, { ...DEFAULT_NODE_STYLE, ...preset, width: userNodeStyle.width, height: userNodeStyle.height, visibleFields: userNodeStyle.visibleFields });
  }

  async function handleRename() {
    if (!e || !renameValue.trim() || renameValue === e.name) { setRenaming(false); return; }
    const r = await applyOperation({
      kind: 'RenameElement', opId: `op_${Date.now()}`, elementId: e.id, newName: renameValue.trim(),
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
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
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
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
        <InspectorActions />
        <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => select(null)} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        <Section label="Properties" persistKey="element.properties" defaultOpen icon={<Info className="w-3 h-3" />}>
          <Field label="Kind" value={e.kind} />
          <Field label="Id" value={e.id} mono />
          {Object.entries(e.attributes).filter(([k]) => k !== 'external').map(([k, v]) =>
            v ? <Field key={k} label={k} value={v} mono /> : null
          )}
        </Section>

        <Section label="Appearance" persistKey="element.appearance" defaultOpen icon={<Palette className="w-3 h-3" />}>
          <Tabs tabs={['presets', 'style', 'animation'] as const} active={appearanceTab} onChange={setAppearanceTab} />

          {appearanceTab === 'presets' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => { applyPreset(p.style); }}
                  title={`Apply the ${p.label} style`}
                  style={presetSwatchStyle(p.style)}
                  className="h-11 rounded-lg border border-default flex items-center justify-center text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-transform hover:scale-[1.03]"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {appearanceTab === 'style' && (
            <>
              <GroupLabel>Fill</GroupLabel>
              <Segmented
                label="Fill style"
                value={userNodeStyle.fillStyle ?? 'solid'}
                options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'glass', label: 'Glass' }, { value: 'hatch', label: 'Hatch' }] as { value: NodeFillStyle; label: string }[]}
                onChange={(v) => setStyle({ fillStyle: v })}
              />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Background color</div>
                <ColorSwatches value={userNodeStyle.fillColor} onChange={(c) => setStyle({ fillColor: c })} palette={FILLS} />
              </div>

              <GroupLabel>Border</GroupLabel>
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
              <Row2>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex justify-between">
                    <span>Width</span><span className="font-mono normal-case tracking-normal">{userNodeStyle.borderWidth.toFixed(0)}px</span>
                  </div>
                  <input type="range" min={1} max={5} step={1} value={userNodeStyle.borderWidth} onChange={(ev) => setStyle({ borderWidth: parseInt(ev.target.value, 10) })} className="w-full accent-indigo-500" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex justify-between">
                    <span>Radius</span><span className="font-mono normal-case tracking-normal">{userNodeStyle.radius ?? 8}px</span>
                  </div>
                  <input type="range" min={0} max={28} step={1} value={userNodeStyle.radius ?? 8} onChange={(ev) => setStyle({ radius: parseInt(ev.target.value, 10) })} className="w-full accent-indigo-500" />
                </div>
              </Row2>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Color</div>
                <ColorSwatches value={userNodeStyle.borderColor} onChange={(c) => setStyle({ borderColor: c })} />
              </div>

              <GroupLabel>Effects</GroupLabel>
              <Segmented
                label="Shadow"
                value={userNodeStyle.shadow ?? 'none'}
                options={[{ value: 'none', label: 'Flat' }, { value: 'soft', label: 'Soft' }, { value: 'raised', label: 'Raised' }, { value: 'glow', label: 'Glow' }] as { value: NodeShadow; label: string }[]}
                onChange={(v) => setStyle({ shadow: v })}
              />
              <Row2>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 flex justify-between">
                    <span>Opacity</span><span className="font-mono normal-case tracking-normal">{Math.round((userNodeStyle.opacity ?? 1) * 100)}%</span>
                  </div>
                  <input type="range" min={0.2} max={1} step={0.05} value={userNodeStyle.opacity ?? 1} onChange={(ev) => setStyle({ opacity: parseFloat(ev.target.value) })} className="w-full accent-indigo-500" />
                </div>
                <Segmented
                  label="Accent bar"
                  value={userNodeStyle.accentSide ?? 'none'}
                  options={[{ value: 'none', label: 'None' }, { value: 'left', label: 'Left' }, { value: 'top', label: 'Top' }] as { value: NodeAccentSide; label: string }[]}
                  onChange={(v) => setStyle({ accentSide: v })}
                />
              </Row2>
              {userNodeStyle.accentSide && userNodeStyle.accentSide !== 'none' && (
                <ColorSwatches value={userNodeStyle.accentColor} onChange={(c) => setStyle({ accentColor: c })} />
              )}

              <GroupLabel>Text</GroupLabel>
              <Row2>
                <Segmented
                  label="Title size"
                  value={userNodeStyle.textSize ?? 'base'}
                  options={[{ value: 'sm', label: 'S' }, { value: 'base', label: 'M' }, { value: 'lg', label: 'L' }] as { value: NodeTextSize; label: string }[]}
                  onChange={(v) => setStyle({ textSize: v })}
                />
                <Segmented
                  label="Align"
                  value={userNodeStyle.textAlign ?? 'left'}
                  options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }] as { value: NodeTextAlign; label: string }[]}
                  onChange={(v) => setStyle({ textAlign: v })}
                />
              </Row2>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Title color</div>
                <ColorSwatches value={userNodeStyle.textColor} onChange={(c) => setStyle({ textColor: c })} palette={[undefined, '#18181b', '#3f3f46', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#ffffff']} />
              </div>

              {(userNodeStyle.width || userNodeStyle.height) && (
                <div className="text-[10px] text-faint flex justify-between font-mono pt-1">
                  <span>Size</span>
                  <span>{userNodeStyle.width ?? '—'} × {userNodeStyle.height ?? '—'} px</span>
                </div>
              )}
              <button onClick={clearStyle} className="mt-1 btn btn-md btn-ghost border-default w-full">
                Reset appearance
              </button>
            </>
          )}

          {appearanceTab === 'animation' && (
            <div className="pt-1 space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Effect</div>
                <div className="grid grid-cols-3 gap-1">
                  {NODE_ANIMATIONS.map((a) => {
                    const current = userNodeStyle.animation ?? (userNodeStyle.animated ? 'marching' : 'none');
                    return (
                      <button
                        key={a.value}
                        onClick={() => setStyle({ animation: a.value, animated: undefined })}
                        className={clsx(
                          'px-1 py-1.5 text-[11px] rounded border transition-colors',
                          current === a.value
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700',
                        )}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Segmented
                label="Speed"
                value={userNodeStyle.animationSpeed ?? 'normal'}
                options={[{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }] as { value: NodeAnimSpeed; label: string }[]}
                onChange={(v) => setStyle({ animationSpeed: v })}
              />
              <p className="text-[10px] text-faint leading-snug">
                Motion plays on the canvas — use sparingly to spotlight what needs attention. Honors “reduce motion”.
              </p>
            </div>
          )}
        </Section>

        <Section label="Text & attributes" persistKey="element.notes" defaultOpen icon={<FileText className="w-3 h-3" />}>
          <p className="text-[11px] text-faint mb-2 leading-snug">
            Describe this {e.kind}. Type <code className="font-mono text-indigo-600 dark:text-indigo-400">#owner: ABC</code> to
            set an attribute — press <kbd className="px-1 rounded bg-zinc-200 dark:bg-zinc-800 font-mono text-[10px]">#</kbd> for
            suggestions, or tap a chip below.
          </p>
          <RichTextEditor
            value={note}
            onChange={onNoteChange}
            onCommit={(next) => {
              if (!workspace) return;
              const props = hashtagProps(next);
              const current = useApp.getState().customProps[elementId] ?? {};
              for (const [k, v] of Object.entries(props)) if (current[k] !== v) setCustomProp(elementId, k, v);
              window.dispatchEvent(new CustomEvent('verso:notes-changed'));
            }}
            kind={e.kind}
            existingKeys={Object.keys(customProps)}
            className="min-h-[150px]"
          />
          <button onClick={() => setNotesOpen(true)} className="mt-2 w-full btn btn-md btn-secondary">
            <Maximize2 className="w-3 h-3" /> Open full editor
          </button>
        </Section>

        <Section label="Lifecycle" persistKey="element.lifecycle" icon={<Clock className="w-3 h-3" />}>
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

        <Section label="Ownership" persistKey="element.ownership" defaultOpen={false} icon={<Users className="w-3 h-3" />}>
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

        <Section label="Custom properties" persistKey="element.customProps" defaultOpen={Object.keys(customProps).length > 0} icon={<Tags className="w-3 h-3" />}>
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

        <Section label="Comments" persistKey="element.comments" defaultOpen={false} icon={<MessageSquare className="w-3 h-3" />}>
          <CommentsPanel targetKind="element" targetId={e.id} title={e.name} />
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
        value={note}
        kind={e.kind}
        existingKeys={Object.keys(customProps)}
        onChange={onNoteChange}
        onClose={() => setNotesOpen(false)}
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
  value, onChange, palette = COLORS,
}: { value: string | undefined; onChange: (c: string | undefined) => void; palette?: (string | undefined)[] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {palette.map((c, i) => (
        <button
          key={i}
          onClick={() => onChange(c)}
          title={c ?? 'default'}
          className={clsx(
            'w-5 h-5 rounded-full border-2 transition-all',
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
  const [linkTab, setLinkTab] = useState<'presets' | 'style' | 'animation'>('presets');
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
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: 'Lifecycle saved' });
  }

  async function commitLinkOwnership(squad: string) {
    const r = await applyOperation({
      kind: 'SetOwnership', opId: `op_${Date.now()}`,
      targetId: linkId,
      squad: squad || null,
      domain: null,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
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
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else setToast({ kind: 'success', text: 'Payload updated' });
  }

  async function handleKindSave() {
    if (!link || isDataFlow) return;
    if (kindEdit === (link.attributes.kind ?? '')) return;
    const r = await applyOperation({
      kind: 'SetLinkAttribute', opId: `op_${Date.now()}`,
      linkId: link.id, attributeName: 'kind', value: kindEdit,
    });
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
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
    if ('reason' in r) setToast({ kind: 'error', text: friendlyOpError(r) });
    else { setToast({ kind: 'success', text: 'Removed' }); selectLink(null); }
  }

  function setStyle(s: Partial<EdgeStyle>) {
    setEdgeStyleFor(linkId, { ...userStyle, ...s });
  }

  function applyEdgePreset(preset: Partial<EdgeStyle>) {
    setEdgeStyleFor(linkId, { ...DEFAULT_EDGE_STYLE, ...preset });
  }

  // Reverse the relationship in the model (swap source ↔ target) via remove + re-add.
  async function reverseLink() {
    if (!link) return;
    const kind = link.kind === 'dataFlow' ? 'dataFlow' : 'dependency';
    const r1 = await applyOperation({ kind: 'RemoveLink', opId: `op_${Date.now()}`, linkId: link.id });
    if ('reason' in r1) { setToast({ kind: 'error', text: friendlyOpError(r1) }); return; }
    const r2 = await applyOperation({
      kind: 'AddLink', opId: `op_${Date.now()}_r`,
      linkKind: kind, fromId: link.toId, toId: link.fromId,
      payload: kind === 'dataFlow' ? (link.attributes.payload ?? 'Event') : null,
      dependencyKind: kind === 'dependency' ? (link.attributes.kind ?? 'uses') : null,
    });
    if ('reason' in r2) setToast({ kind: 'error', text: friendlyOpError(r2) });
    else { setToast({ kind: 'success', text: 'Relationship reversed' }); selectLink(null); }
  }

  return (
    <ResizableAside>
      <div className="px-4 py-3 border-b border-default flex items-center gap-2">
        <Workflow className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
        <h2 className="text-sm font-semibold flex-1 truncate">
          {isDataFlow ? 'Data Flow' : 'Dependency'}
        </h2>
        <InspectorActions />
        <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => selectLink(null)} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        <Section label="Endpoints" persistKey="link.endpoints" defaultOpen icon={<Spline className="w-3 h-3" />}>
          <Field label="From" value={from?.name ?? link.fromId} />
          <Field label="To" value={to?.name ?? link.toId} />
          <Field label="Id" value={link.id} mono />
        </Section>

        <Section label="Properties" persistKey="link.properties" defaultOpen icon={<Info className="w-3 h-3" />}>
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

        <Section label="Lifecycle & Owner" persistKey="link.lifecycle" defaultOpen={false} icon={<Clock className="w-3 h-3" />}>
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

        <Section label="Appearance" persistKey="link.appearance" defaultOpen icon={<Palette className="w-3 h-3" />}>
          <Tabs tabs={['presets', 'style', 'animation'] as const} active={linkTab} onChange={setLinkTab} />

          {linkTab === 'presets' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {EDGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyEdgePreset(p.style)}
                  title={`Apply the ${p.label} style`}
                  className="rounded-lg border border-default px-2 py-2 flex flex-col items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:border-indigo-400 hover:scale-[1.03] transition-transform"
                >
                  <span className="block w-full" style={{ borderTop: `${Math.min(p.style.thickness ?? 1.5, 3)}px ${p.style.lineStyle ?? 'solid'} ${p.style.color ?? '#71717a'}` }} />
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {linkTab === 'style' && (
            <>
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
                <input type="range" min={1} max={5} step={0.5} value={userStyle.thickness} onChange={(ev) => setStyle({ thickness: parseFloat(ev.target.value) })} className="w-full accent-indigo-500" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Ends</div>
                <div className="flex items-center gap-1">
                  <MarkerSelect value={userStyle.arrowStart ?? 'none'} side="start" onChange={(v) => setStyle({ arrowStart: v })} />
                  <button onClick={reverseLink} title="Reverse direction (swap start ↔ end)" className="shrink-0 p-1.5 rounded border border-default hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-muted hover:text-body">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </button>
                  <MarkerSelect value={userStyle.arrowEnd ?? userStyle.arrow ?? 'closed'} side="end" onChange={(v) => setStyle({ arrowEnd: v })} />
                </div>
                <div className="flex justify-between text-[9px] text-faint mt-0.5 px-0.5 gap-2">
                  <span className="truncate">{from?.name ?? 'source'}</span><span className="truncate text-right">{to?.name ?? 'target'}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Color</div>
                <ColorSwatches value={userStyle.color} onChange={(c) => setStyle({ color: c })} />
              </div>
            </>
          )}

          {linkTab === 'animation' && (
            <div className="pt-1 space-y-2">
              <Toggle label="Animated flow" hint="Dashes flow along the relationship" checked={!!userStyle.animated} onChange={(v) => setStyle({ animated: v })} />
              <Segmented
                label="Flow speed"
                value={userStyle.animSpeed ?? 'normal'}
                options={[{ value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }] as { value: EdgeAnimSpeed; label: string }[]}
                onChange={(v) => setStyle({ animSpeed: v })}
              />
              <p className="text-[10px] text-faint leading-snug">Flow shows the direction of the dependency / data. Honors “reduce motion”.</p>
            </div>
          )}
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

function Section({ label, children, defaultOpen = true, persistKey, icon }: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  persistKey?: string;
  icon?: React.ReactNode;
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
  // Fold/unfold together when the header's collapse-all button fires.
  useEffect(() => {
    function onAll(ev: Event) {
      const next = (ev as CustomEvent).detail?.open as boolean;
      setOpen(next);
      if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0');
    }
    window.addEventListener(SECTIONS_EVENT, onAll);
    return () => window.removeEventListener(SECTIONS_EVENT, onAll);
  }, [storageKey]);
  return (
    <section className="border-b-2 border-zinc-100 dark:border-zinc-800/80">
      <button
        onClick={toggle}
        className={clsx(
          'w-full px-3 py-2.5 flex items-center gap-2 transition-colors',
          open ? 'bg-zinc-100/70 dark:bg-zinc-800/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40',
        )}
      >
        {icon && (
          <span className="w-5 h-5 rounded-md flex items-center justify-center bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
            {icon}
          </span>
        )}
        <h3 className="flex-1 text-left text-[11px] uppercase tracking-wide text-zinc-700 dark:text-zinc-200 font-semibold">{label}</h3>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>}
    </section>
  );
}

// Rich shared palettes (line/border/text vs soft backgrounds).
const COLORS: (string | undefined)[] = [undefined, '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b', '#18181b'];
const FILLS: (string | undefined)[] = [undefined, '#eef2ff', '#f5f3ff', '#faf5ff', '#fdf2f8', '#fee2e2', '#fff7ed', '#fffbeb', '#fefce8', '#f7fee7', '#ecfdf5', '#f0fdfa', '#ecfeff', '#eff6ff', '#f1f5f9', '#fafafa'];

const NODE_ANIMATIONS: { value: NodeAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'marching', label: 'Marching' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'glow', label: 'Glow' },
  { value: 'breathe', label: 'Breathe' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'shake', label: 'Shake' },
];

/** Relationship presets — coherent line combos shown as little line samples. */
const EDGE_PRESETS: { key: string; label: string; style: Partial<EdgeStyle> }[] = [
  { key: 'default', label: 'Default', style: { ...DEFAULT_EDGE_STYLE, arrow: 'closed' } },
  { key: 'strong', label: 'Strong', style: { thickness: 3, lineStyle: 'solid', color: '#4f46e5', arrow: 'closed' } },
  { key: 'subtle', label: 'Subtle', style: { thickness: 1, lineStyle: 'solid', color: '#94a3b8', arrow: 'open' } },
  { key: 'dependency', label: 'Dependency', style: { thickness: 1.5, lineStyle: 'dashed', color: '#64748b', arrow: 'closed' } },
  { key: 'flow', label: 'Data flow', style: { thickness: 2, lineStyle: 'solid', color: '#06b6d4', animated: true, arrow: 'open' } },
  { key: 'critical', label: 'Critical', style: { thickness: 3, lineStyle: 'solid', color: '#ef4444', animated: true, animSpeed: 'fast', arrow: 'closed' } },
];

/** One-click coherent style combos — the "designer presets" that go beyond manual tweaking. */
const STYLE_PRESETS: { key: string; label: string; style: Partial<NodeStyle> }[] = [
  { key: 'default', label: 'Default', style: { ...DEFAULT_NODE_STYLE } },
  { key: 'highlight', label: 'Highlight', style: { borderColor: '#6366f1', borderWidth: 2, borderStyle: 'solid', fillColor: '#eef2ff', fillStyle: 'solid', shadow: 'glow', radius: 10 } },
  { key: 'critical', label: 'Critical', style: { borderColor: '#ef4444', borderWidth: 2, borderStyle: 'solid', fillColor: '#fee2e2', shadow: 'soft', animation: 'marching', radius: 8 } },
  { key: 'done', label: 'Done', style: { borderColor: '#10b981', borderWidth: 2, borderStyle: 'solid', fillColor: '#ecfdf5', shadow: 'soft', radius: 8 } },
  { key: 'muted', label: 'Muted', style: { opacity: 0.55, fillColor: '#fafafa', shadow: 'none', borderColor: '#d4d4d8' } },
  { key: 'draft', label: 'Draft', style: { borderStyle: 'dashed', fillStyle: 'hatch', fillColor: '#cbd5e1', borderColor: '#94a3b8' } },
  { key: 'glass', label: 'Glass', style: { fillStyle: 'glass', fillColor: '#6366f1', shadow: 'raised', borderColor: '#a5b4fc', radius: 14 } },
  { key: 'spotlight', label: 'Spotlight', style: { fillStyle: 'gradient', fillColor: '#6366f1', textColor: '#ffffff', borderColor: '#4f46e5', shadow: 'glow', radius: 12 } },
];

/** Two compact controls side by side — used to pair conceptually-close properties. */
function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-1 items-start">{children}</div>;
}

function Tabs<T extends string>({ tabs, active, onChange }: { tabs: readonly T[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={clsx(
            'flex-1 px-2 py-1 text-[11px] rounded-md capitalize transition-colors',
            active === t ? 'bg-white dark:bg-zinc-900 shadow-sm text-indigo-600 dark:text-indigo-300 font-medium' : 'text-zinc-500 hover:text-body',
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/** Render a preset pill so it *looks like* the effect it applies (fill / border / shadow / text). */
function presetSwatchStyle(s: Partial<NodeStyle>): React.CSSProperties {
  const css: React.CSSProperties = {};
  const fill = s.fillColor;
  if (s.fillStyle === 'gradient' && fill) css.background = `linear-gradient(160deg, color-mix(in srgb, ${fill}, white 24%), ${fill})`;
  else if (s.fillStyle === 'glass') { css.background = fill ? `color-mix(in srgb, ${fill}, transparent 55%)` : 'rgba(255,255,255,0.4)'; css.backdropFilter = 'blur(4px)'; }
  else if (s.fillStyle === 'hatch') { const c = fill ?? 'rgba(148,163,184,0.5)'; css.backgroundImage = `repeating-linear-gradient(45deg, ${c} 0 4px, transparent 4px 8px)`; }
  else if (fill) css.background = fill;
  if (s.borderColor) css.borderColor = s.borderColor;
  if (s.borderStyle) css.borderStyle = s.borderStyle;
  if (s.borderWidth) css.borderWidth = Math.min(s.borderWidth, 2);
  if (s.opacity !== undefined) css.opacity = s.opacity;
  if (s.shadow === 'glow') css.boxShadow = `0 0 7px ${s.borderColor ?? '#6366f1'}99`;
  else if (s.shadow === 'raised') css.boxShadow = '0 3px 8px rgba(0,0,0,0.22)';
  else if (s.shadow === 'soft') css.boxShadow = '0 1px 2px rgba(0,0,0,0.16)';
  // Keep the label legible on light pastel fills regardless of theme.
  if (s.textColor) css.color = s.textColor;
  else if (fill || s.fillStyle) css.color = '#27272a';
  return css;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pt-2 mt-1 border-t border-zinc-100 dark:border-zinc-800/60">
      {children}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex-1 px-1.5 py-1 text-[11px] rounded border transition-colors',
              value === o.value
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-full flex items-center gap-2 text-left py-0.5">
      <span className={clsx('relative w-9 h-5 rounded-full transition-colors shrink-0', checked ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-700')}>
        <span className={clsx('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-body">{label}</span>
        {hint && <span className="block text-[10px] text-faint leading-snug">{hint}</span>}
      </span>
    </button>
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
