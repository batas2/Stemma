import { AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { Severity } from '@/lib/types';

const ICONS: Record<Severity, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<Severity, string> = {
  error: 'text-rose-600 dark:text-rose-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-sky-600 dark:text-sky-400',
};

export function ViolationsPanel() {
  const violations = useApp((s) => s.violations);
  const open = useApp((s) => s.violationsOpen);
  const setOpen = useApp((s) => s.setViolationsOpen);
  const select = useApp((s) => s.selectElement);
  const selectLink = useApp((s) => s.selectLink);

  if (violations.length === 0 && !open) return null;

  const counts = violations.reduce<Record<Severity, number>>(
    (acc, v) => ({ ...acc, [v.severity]: (acc[v.severity] ?? 0) + 1 }),
    { error: 0, warning: 0, info: 0 }
  );

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/80 backdrop-blur">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 flex items-center gap-3 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors"
      >
        <ShieldCheck className={clsx('w-3.5 h-3.5', violations.length === 0 ? 'text-emerald-500' : 'text-zinc-500')} />
        <span className="font-medium">Validation</span>
        {violations.length === 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">All clean</span>
        ) : (
          <div className="flex items-center gap-2">
            {counts.error > 0 && <span className={COLORS.error}>{counts.error} errors</span>}
            {counts.warning > 0 && <span className={COLORS.warning}>{counts.warning} warnings</span>}
            {counts.info > 0 && <span className={COLORS.info}>{counts.info} info</span>}
          </div>
        )}
        <span className="ml-auto text-zinc-500">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </span>
      </button>
      {open && violations.length > 0 && (
        <ul className="max-h-48 overflow-auto scrollbar-thin border-t border-zinc-100 dark:border-zinc-800/60">
          {violations.map((v, i) => {
            const Icon = ICONS[v.severity];
            return (
              <li
                key={`${v.ruleId}-${i}`}
                onClick={() => {
                  if (v.elementIds[0]) select(v.elementIds[0]);
                  else if (v.linkIds[0]) selectLink(v.linkIds[0]);
                }}
                className="px-3 py-2 text-xs flex items-start gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/40 border-b border-zinc-100 dark:border-zinc-800/60 last:border-b-0"
              >
                <Icon className={clsx('w-3.5 h-3.5 mt-0.5 shrink-0', COLORS[v.severity])} />
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-900 dark:text-zinc-100">{v.message}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">{v.ruleId}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
