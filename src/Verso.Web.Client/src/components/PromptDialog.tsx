import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export interface PromptRequest {
  kind: 'text';
  title: string;
  body?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
}

export interface PickRequest<T = string> {
  kind: 'pick';
  title: string;
  body?: string;
  options: PickOption<T>[];
  initialValue?: T;
  searchable?: boolean;
  emptyHint?: ReactNode;
}

export interface PickOption<T = string> {
  value: T;
  label: string;
  hint?: string;
}

export type DialogRequest = PromptRequest | PickRequest;

type Resolver = ((v: unknown | null) => void) | null;

let pendingResolve: Resolver = null;
let pendingRequest: DialogRequest | null = null;
const listeners = new Set<(req: DialogRequest | null) => void>();

export function promptText(req: Omit<PromptRequest, 'kind'>): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    pendingResolve = resolve as Resolver;
    pendingRequest = { ...req, kind: 'text' };
    for (const l of listeners) l(pendingRequest);
  });
}

export function pickFromList<T = string>(req: Omit<PickRequest<T>, 'kind'>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    pendingResolve = resolve as Resolver;
    pendingRequest = { ...req, kind: 'pick' } as DialogRequest;
    for (const l of listeners) l(pendingRequest);
  });
}

function settle(value: unknown | null) {
  const r = pendingResolve;
  pendingResolve = null;
  pendingRequest = null;
  for (const l of listeners) l(null);
  r?.(value);
}

export function PromptDialog() {
  const [req, setReq] = useState<DialogRequest | null>(null);

  useEffect(() => {
    function l(r: DialogRequest | null) { setReq(r); }
    listeners.add(l);
    if (pendingRequest) setReq(pendingRequest);
    return () => { listeners.delete(l); };
  }, []);

  if (!req) return null;

  const cancel = () => settle(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={cancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-overlay rounded-lg p-5 w-[480px] max-w-[90vw]"
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1">
            <h2 id="prompt-title" className="text-sm font-semibold text-body">{req.title}</h2>
            {req.body && <p className="text-xs text-muted mt-1.5 leading-relaxed">{req.body}</p>}
          </div>
          <button onClick={cancel} aria-label="Close" className="btn btn-md btn-ghost p-1.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {req.kind === 'text'
          ? <TextBody req={req} onSubmit={(v) => settle(v)} onCancel={cancel} />
          : <PickBody req={req as PickRequest} onPick={(v) => settle(v)} onCancel={cancel} />}
      </div>
    </div>
  );
}

function TextBody({ req, onSubmit, onCancel }: { req: PromptRequest; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(req.initialValue ?? '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function submit() {
    const v = value.trim();
    if (!v) { setError('Required'); return; }
    if (req.validate) {
      const e = req.validate(v);
      if (e) { setError(e); return; }
    }
    onSubmit(v);
  }

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        placeholder={req.placeholder}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        className="input-base"
        aria-invalid={error !== null}
      />
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="btn btn-md btn-ghost">Cancel</button>
        <button onClick={submit} className="btn btn-md btn-primary">{req.confirmLabel ?? 'OK'}</button>
      </div>
    </>
  );
}

function PickBody({ req, onPick, onCancel }: { req: PickRequest; onPick: (v: unknown) => void; onCancel: () => void }) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchable = req.searchable !== false;

  useEffect(() => { if (searchable) inputRef.current?.focus(); }, [searchable]);

  const filtered = req.options.filter((o) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q);
  });

  const move = useCallback((delta: number) => {
    setHighlighted((h) => {
      if (filtered.length === 0) return 0;
      return (h + delta + filtered.length) % filtered.length;
    });
  }, [filtered.length]);

  return (
    <>
      {searchable && (
        <input
          ref={inputRef}
          value={query}
          placeholder="Search…"
          onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) onPick(filtered[highlighted].value); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          className="input-base mb-2"
        />
      )}
      <div ref={listRef} className="max-h-72 overflow-auto scrollbar-thin border border-default rounded">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-faint">{req.emptyHint ?? 'No matches.'}</div>
        ) : (
          filtered.map((o, i) => (
            <button
              key={String(o.value)}
              onClick={() => onPick(o.value)}
              onMouseEnter={() => setHighlighted(i)}
              className={clsx(
                'w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2',
                i === highlighted ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200' : 'text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
              )}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="text-[10px] font-mono text-faint shrink-0">{o.hint}</span>}
            </button>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="btn btn-md btn-ghost">Cancel</button>
      </div>
    </>
  );
}
