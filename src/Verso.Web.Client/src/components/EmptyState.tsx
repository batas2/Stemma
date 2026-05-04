import { Box, ArrowUp } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
          <Box className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
        </div>
        <h1 className="text-xl font-semibold mb-2">Open a workspace</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Point Verso at a folder containing a <code className="font-mono text-zinc-800 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 px-1 rounded">.sln</code> or
          one or more <code className="font-mono text-zinc-800 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 px-1 rounded">.csproj</code> files.
          Verso will model the structure live and persist every change to the source files themselves —
          no database.
        </p>
        <div className="text-xs text-zinc-500 flex items-center justify-center gap-1.5">
          <ArrowUp className="w-3.5 h-3.5" />
          Enter a path in the bar above
        </div>
      </div>
    </div>
  );
}
