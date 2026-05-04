import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

let pendingResolve: ((ok: boolean) => void) | null = null;
let pendingRequest: ConfirmRequest | null = null;
const listeners = new Set<(req: ConfirmRequest | null) => void>();

export function confirmAction(req: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    pendingRequest = req;
    for (const l of listeners) l(req);
  });
}

function settle(ok: boolean) {
  const r = pendingResolve;
  pendingResolve = null;
  pendingRequest = null;
  for (const l of listeners) l(null);
  r?.(ok);
}

export function ConfirmDialog() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function l(r: ConfirmRequest | null) { setReq(r); }
    listeners.add(l);
    if (pendingRequest) setReq(pendingRequest);
    return () => { listeners.delete(l); };
  }, []);

  const cancel = useCallback(() => settle(false), []);
  const ok = useCallback(() => settle(true), []);

  useEffect(() => {
    if (!req) return;
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [req, cancel, ok]);

  if (!req) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={cancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-overlay rounded-lg p-5 w-[440px] max-w-[90vw]"
      >
        <div className="flex items-start gap-3 mb-3">
          {req.destructive && <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />}
          <div className="flex-1">
            <h2 id="confirm-title" className="text-sm font-semibold text-body">{req.title}</h2>
            {req.body && <p className="text-xs text-muted mt-1.5 leading-relaxed">{req.body}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={cancel} className="btn btn-md btn-ghost">
            {req.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={ok}
            className={clsx('btn btn-md', req.destructive ? 'btn-destructive' : 'btn-primary')}
          >
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
