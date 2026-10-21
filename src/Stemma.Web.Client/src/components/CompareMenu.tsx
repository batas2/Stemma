import { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitBranch, GitCommitHorizontal, GitCompareArrows, Loader2, Tag, X } from 'lucide-react';
import clsx from 'clsx';
import { fetchHistory, type GitHistoryInfo } from '@/lib/api';
import { startCompare, stopCompare, useUncommittedDiff } from '@/lib/compare';
import { describeCounts } from '@/lib/modelDiff';
import { useApp } from '@/lib/store';

/** "just now", "5 minutes ago", "3 days ago", or the date for anything older than a month. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const units: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day']];
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i];
    if (s >= size) {
      const n = Math.floor(s / size);
      if (name === 'day' && n > 30) break;
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return new Date(t).toLocaleDateString();
}

/**
 * Compare the canvas with another version of the model (F-017 AC1): the last commit, where this
 * branch started, a tag, or a recent commit — read from Git (ADR-0024). Greyed, with the reason,
 * when there is no Git to read.
 */
export function CompareMenu() {
  const ws = useApp((s) => s.workspace);
  const compare = useApp((s) => s.compare);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<GitHistoryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const uncommitted = useUncommittedDiff();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Read once per workspace, so the control can say up front whether there is anything to compare with.
  useEffect(() => {
    if (!ws) return;
    let live = true;
    setHistory(null);
    fetchHistory().then((h) => { if (live) setHistory(h); }).catch(() => { if (live) setHistory(null); });
    return () => { live = false; };
  }, [ws?.rootPath]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    // Read again on opening: a commit made in a terminal since should be in the list.
    setLoading(true);
    fetchHistory().then(setHistory).catch(() => {}).finally(() => setLoading(false));
    function onAway(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onEsc, true);
    return () => { document.removeEventListener('mousedown', onAway); document.removeEventListener('keydown', onEsc, true); };
  }, [open]);

  if (!ws) return null;
  const unavailable = history && !history.repository ? history.reason : null;

  async function choose(rev: string, label: string) {
    setBusy(rev);
    const ok = await startCompare(rev, label);
    setBusy(null);
    if (ok) setOpen(false);
  }

  const row = 'w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 focus:bg-zinc-100 dark:focus:bg-zinc-800/70 outline-none disabled:opacity-50';
  const heading = 'px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-zinc-500';

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!!unavailable}
        aria-haspopup="menu"
        aria-expanded={open}
        title={unavailable ?? 'Compare the model with another version of it — the last commit, a tag, a branch'}
        className={clsx(
          'btn btn-md btn-ghost border-default disabled:opacity-40 disabled:cursor-not-allowed',
          compare ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/40' : 'bg-zinc-100 dark:bg-zinc-900',
        )}
      >
        <GitCompareArrows className="w-3.5 h-3.5" />
        {compare ? 'Comparing' : 'Compare'} <ChevronDown className="w-3 h-3" />
      </button>
      {open && !history && (
        <div role="menu" aria-label="Compare with" className="absolute right-0 top-full mt-1 w-[22rem] rounded surface-overlay z-popover px-3 py-3 text-xs text-muted flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Reading the history…
        </div>
      )}
      {open && history && (
        <div role="menu" aria-label="Compare with" className="absolute right-0 top-full mt-1 w-[22rem] max-h-[70vh] overflow-y-auto rounded surface-overlay z-popover py-1">
          <div className={heading}>Compare the model with</div>
          <button role="menuitem" className={row} disabled={busy !== null} onClick={() => choose('HEAD', 'the last commit')}>
            <GitCommitHorizontal className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">The last commit</span>
              <span className="block text-[11px] text-muted">
                {uncommitted ? (uncommitted.counts.total === 0 ? 'Nothing has changed since' : `What you have changed since: ${describeCounts(uncommitted.counts)}`) : 'What you have changed since'}
              </span>
            </span>
            {busy === 'HEAD' && <Loader2 className="w-3.5 h-3.5 animate-spin text-faint" aria-label="Reading" />}
          </button>
          {history.mergeBase && history.branch && history.defaultBranch && (
            <button role="menuitem" className={row} disabled={busy !== null} onClick={() => choose(history.mergeBase!, `where ${history.branch} started`)}>
              <GitBranch className="w-4 h-4 mt-0.5 text-violet-500 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">Where this branch started</span>
                <span className="block text-[11px] text-muted truncate">Everything {history.branch} changes, compared with {history.defaultBranch}</span>
              </span>
              {busy === history.mergeBase && <Loader2 className="w-3.5 h-3.5 animate-spin text-faint" aria-label="Reading" />}
            </button>
          )}

          {history.tags.length > 0 && (
            <>
              <div className={clsx(heading, 'border-t border-subtle mt-1')}>Tags</div>
              {history.tags.map((t) => (
                <button key={t.name} role="menuitem" className={row} disabled={busy !== null} onClick={() => choose(t.sha, t.name)}>
                  <Tag className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" aria-hidden />
                  <span className="text-sm flex-1 truncate">{t.name}</span>
                  {busy === t.sha && <Loader2 className="w-3.5 h-3.5 animate-spin text-faint" aria-label="Reading" />}
                </button>
              ))}
            </>
          )}

          <div className={clsx(heading, 'border-t border-subtle mt-1 flex items-center gap-2')}>
            Recent commits {loading && <Loader2 className="w-3 h-3 animate-spin" aria-label="Reading the history" />}
          </div>
          {history.commits.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">{history.reason ?? 'No commit touches this model yet.'}</p>
          )}
          {history.commits.map((c) => (
            <button key={c.sha} role="menuitem" className={row} disabled={busy !== null} onClick={() => choose(c.sha, `“${c.subject}”`)}>
              <GitCommitHorizontal className="w-4 h-4 mt-0.5 text-faint shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate">{c.subject}</span>
                <span className="block text-[11px] text-muted truncate">
                  <span className="font-mono">{c.shortSha}</span> · {c.author} · {relativeTime(c.when)}
                </span>
              </span>
              {busy === c.sha && <Loader2 className="w-3.5 h-3.5 animate-spin text-faint" aria-label="Reading" />}
            </button>
          ))}

          {compare && (
            <button role="menuitem" className={clsx(row, 'border-t border-subtle mt-1 text-sm')} onClick={() => { stopCompare(); setOpen(false); }}>
              <X className="w-4 h-4 mt-0.5 text-faint shrink-0" aria-hidden /> Stop comparing
            </button>
          )}
        </div>
      )}
    </div>
  );
}
