using System.Collections.Concurrent;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Stemma.Engine.Diagnostics;

namespace Stemma.Engine.Workspace;

/// <summary>
/// Watches a workspace's file tree for external edits. Combines a native
/// <see cref="FileSystemWatcher"/> (fast, low-overhead) with a 1 s polling
/// fallback over file mtimes (covers macOS rename quirks, network shares,
/// and platforms where the native watcher misses events).
///
/// Emits debounced events on `Changed` for changes the engine should reload.
/// </summary>
public sealed class ExternalWatcher : IAsyncDisposable
{
    private readonly string _root;
    private readonly FileSystemWatcher _watcher;
    private readonly Timer _poller;
    private readonly ConcurrentDictionary<string, DateTime> _mtimes = new(StringComparer.OrdinalIgnoreCase);
    private readonly Func<string, bool> _shouldWatch;
    /// <summary>Diagnostics only; absent by default (ADR-0020).</summary>
    private readonly ILogger _log;
    private readonly object _lock = new();
    private CancellationTokenSource? _debounceCts;
    // Every path a burst touched. A pull writes several files inside one debounce, and keeping only
    // the last of them left the others unread until something else happened to change them.
    private readonly HashSet<string> _pending = new(StringComparer.OrdinalIgnoreCase);
    // Whether the mtimes have been seen once. After that, a path the poller has not seen before is a
    // file that was added, and is reported like any other change.
    private bool _seeded;
    private int _polling;

    public event Action<string>? Changed;

    public ExternalWatcher(string rootPath, Func<string, bool>? shouldWatch = null, ILogger? log = null)
    {
        _root = rootPath;
        _shouldWatch = shouldWatch ?? (_ => true);
        _log = log ?? NullLogger.Instance;

        _watcher = new FileSystemWatcher(rootPath)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName,
            EnableRaisingEvents = false,
        };
        _watcher.Filters.Add("*.cs");
        _watcher.Filters.Add(Path.GetFileName(LayoutSidecar.PathFor(rootPath)));
        _watcher.Filters.Add(CommentsSidecar.FileName);
        _watcher.Changed += OnFsEvent;
        _watcher.Created += OnFsEvent;
        _watcher.Deleted += OnFsEvent;
        // A rename is the old path going and the new one arriving; both are changes.
        _watcher.Renamed += (_, e) =>
        {
            if (_shouldWatch(e.OldFullPath)) ScheduleEmit(e.OldFullPath);
            OnFsEvent(_, e);
        };
        // The OS handle can be exhausted or the directory removed, at which point the watcher stops
        // and external edits quietly stop appearing. The poller compensates, but the degradation is
        // real and was previously invisible.
        _watcher.Error += (_, e) => EngineLog.WatcherStopped(_log,
            "the file system watcher reported an error; the poller is compensating", e.GetException());

        SeedMtimes();
        _watcher.EnableRaisingEvents = true;

        _poller = new Timer(_ => PollOnce(), state: null, dueTime: TimeSpan.FromSeconds(1), period: TimeSpan.FromSeconds(1));
    }

    private void SeedMtimes()
    {
        try
        {
            foreach (var path in EnumerateWatched())
            {
                _mtimes[path] = File.GetLastWriteTimeUtc(path);
            }
            _seeded = true;
        }
        catch (Exception e)
        {
            // The poller rebuilds the snapshot on its next tick, so the user recovers; but "my
            // colleague's edit didn't show up" was unanswerable while this was silent.
            EngineLog.ExternalChangeFailed(_log, e);
        }
    }

    private IEnumerable<string> EnumerateWatched()
    {
        if (!Directory.Exists(_root)) yield break;
        foreach (var sidecar in new[] { LayoutSidecar.PathFor(_root), CommentsSidecar.PathFor(_root) })
            if (File.Exists(sidecar) && _shouldWatch(sidecar)) yield return sidecar;
        // Never into bin, obj, node_modules, .git or another dot-folder: walked and filtered afterwards,
        // they were most of what every poll did.
        foreach (var path in ModelWorkspaceLoader.EnumerateFiles(_root, "*.cs"))
        {
            if (path.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase)) continue;
            if (!_shouldWatch(path)) continue;
            yield return path;
        }
    }

    private void OnFsEvent(object? sender, FileSystemEventArgs e)
    {
        if (string.IsNullOrEmpty(e.FullPath)) return;
        if (!_shouldWatch(e.FullPath)) return;
        ScheduleEmit(e.FullPath);
    }

    private void PollOnce()
    {
        // One poll at a time. The timer does not wait for a callback to finish, so a poll that took
        // longer than its second had the next one start beside it, and on a large tree they piled up.
        if (Interlocked.CompareExchange(ref _polling, 1, 0) != 0) return;
        try
        {
            var current = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in EnumerateWatched())
            {
                current.Add(path);
                var mt = File.GetLastWriteTimeUtc(path);
                if (!_mtimes.TryGetValue(path, out var prev) || prev != mt)
                {
                    _mtimes[path] = mt;
                    if (prev != default || _seeded) ScheduleEmit(path);
                }
            }
            _seeded = true;
            // Detect deletions.
            foreach (var known in _mtimes.Keys.ToArray())
            {
                if (!current.Contains(known))
                {
                    _mtimes.TryRemove(known, out _);
                    ScheduleEmit(known);
                }
            }
        }
        catch (Exception e)
        {
            EngineLog.ExternalChangeFailed(_log, e);
        }
        finally { Volatile.Write(ref _polling, 0); }
    }

    private void ScheduleEmit(string path)
    {
        lock (_lock)
        {
            _pending.Add(path);
            _debounceCts?.Cancel();
            _debounceCts = new CancellationTokenSource();
            var token = _debounceCts.Token;
            _ = Task.Delay(500, token).ContinueWith(t =>
            {
                if (t.IsCanceled) return;
                string[] paths;
                lock (_lock)
                {
                    paths = [.. _pending];
                    _pending.Clear();
                }
                foreach (var changed in paths)
                {
                    // A subscriber throwing must not take the watcher down with it — the next
                    // external edit still has to be noticed — but the failure is the user's stale
                    // canvas, so it is a warning rather than nothing.
                    EngineLog.ExternalChangeDetected(_log, changed);
                    try { Changed?.Invoke(changed); }
                    catch (Exception e) { EngineLog.ExternalChangeFailed(_log, e); }
                }
            }, TaskScheduler.Default);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _watcher.EnableRaisingEvents = false;
        _watcher.Dispose();
        await _poller.DisposeAsync();
    }
}
