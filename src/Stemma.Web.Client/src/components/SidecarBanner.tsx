import { useEffect, useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { onSidecarProblem, retryLayoutSidecar, sidecarProblem } from '@/lib/layout';
import { reportFailure, ClientEvent } from '@/lib/log';

/**
 * The server's reason, without the words the banner already says: it begins "stemma.layout.json
 * cannot be read" when the file does not parse, which beside the headline read twice.
 */
function reason(message: string): string {
  return message.replace(/^stemma\.layout\.json cannot be read\s*/i, '').replace(/\.\s*$/, '').trim();
}

/**
 * Says, for as long as it lasts, that stemma.layout.json cannot be read — a merge left its markers
 * in, a hand edit is half done — and that layout edits are kept in this window meanwhile. The file
 * used to be refused without a word, and a reload lost every edit of the session. It goes as soon
 * as a read succeeds: the fix arriving from outside, or Try again.
 */
export function SidecarBanner() {
  const [problem, setProblem] = useState(sidecarProblem);
  const [trying, setTrying] = useState(false);
  const messageId = useId();
  useEffect(() => {
    setProblem(sidecarProblem());
    return onSidecarProblem(setProblem);
  }, []);

  async function retry() {
    if (!problem) return;
    setTrying(true);
    try {
      await retryLayoutSidecar(problem.rootPath);
    } catch (error) {
      reportFailure('Sidecar', ClientEvent.RequestFailed, 'Reading the layout sidecar again')(error);
    } finally {
      setTrying(false);
    }
  }

  // The live region is there before anything is said in it, so the first message is announced.
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {problem && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          <p id={messageId} className="flex-1 min-w-0 leading-relaxed">
            <span className="font-medium">stemma.layout.json can't be read</span>
            {reason(problem.message) ? ` — ${reason(problem.message)}.` : '.'}
            {' '}Layout changes are kept in this window until it's fixed.
          </p>
          <button
            type="button"
            onClick={() => { void retry(); }}
            disabled={trying}
            aria-describedby={messageId}
            className="shrink-0 -my-0.5 px-2 py-0.5 rounded border border-amber-600 dark:border-amber-500/70 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-60"
          >
            {trying ? 'Trying…' : 'Try again'}
          </button>
        </div>
      )}
    </div>
  );
}
