import { X, FileCode } from 'lucide-react';
import type { DeclarationSource } from '@/lib/api';

/**
 * What the first click actually wrote (F-003 AC7).
 *
 * The whole premise of the product is that the box on the canvas *is* the code, and everywhere else
 * that has to be taken on trust — you are told the model is C#, and shown a canvas. This is the one
 * place it can be demonstrated instead, at the exact moment someone has just done the thing.
 *
 * The snippet is read back out of `Architecture.cs` rather than composed from the model. That
 * distinction is the entire point: a rendering would look identical, be right, and still be a claim
 * about the file rather than the file.
 *
 * Shown once per person and dismissible, because its job is to teach one thing and then never be
 * seen again.
 */
export function FirstElementStrip({ source, onDismiss }: { source: DeclarationSource; onDismiss: () => void }) {
  const fileName = source.filePath.split(/[/\\]/).pop() ?? source.filePath;

  return (
    <div
      role="status"
      aria-label="What that added to your source"
      className="absolute left-1/2 -translate-x-1/2 bottom-6 z-20 w-[min(46rem,calc(100%-3rem))]
                 rounded-lg border border-indigo-200 dark:border-indigo-900/70
                 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm shadow-lg px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <FileCode className="w-4 h-4 mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            That box is now a line of C#.
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Added to <span className="font-mono">{fileName}</span>, line {source.line}. It is a normal
            Git diff — read it, review it, or edit it by hand and the canvas follows.
          </p>
          {/* Horizontally scrollable rather than wrapped: a wrapped line of code reads as two
              statements, and the point is that this is exactly one. */}
          <pre className="mt-2 overflow-x-auto scrollbar-thin rounded bg-zinc-50 dark:bg-zinc-800/70
                          border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5">
            <code className="text-[11px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre">
              {source.text}
            </code>
          </pre>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-indigo-500"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
