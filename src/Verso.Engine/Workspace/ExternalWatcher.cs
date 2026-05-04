using System.Collections.Concurrent;

namespace Verso.Engine.Workspace;

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
    private readonly object _lock = new();
    private CancellationTokenSource? _debounceCts;

    public event Action<string>? Changed;

    public ExternalWatcher(string rootPath, Func<string, bool>? shouldWatch = null)
    {
        _root = rootPath;
        _shouldWatch = shouldWatch ?? (_ => true);

        _watcher = new FileSystemWatcher(rootPath)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName,
            EnableRaisingEvents = false,
        };
        _watcher.Filters.Add("*.cs");
        _watcher.Changed += OnFsEvent;
        _watcher.Created += OnFsEvent;
        _watcher.Deleted += OnFsEvent;
        _watcher.Renamed += (_, e) => OnFsEvent(_, e);
        _watcher.Error += (_, _) => { /* swallow; poller compensates */ };

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
        }
        catch { /* ignore — the poller will rebuild later */ }
    }

    private IEnumerable<string> EnumerateWatched()
    {
        if (!Directory.Exists(_root)) yield break;
        foreach (var path in Directory.EnumerateFiles(_root, "*.cs", SearchOption.AllDirectories))
        {
            if (path.Contains("/bin/", StringComparison.OrdinalIgnoreCase) || path.Contains("/obj/", StringComparison.OrdinalIgnoreCase) || path.Contains(".g.cs", StringComparison.OrdinalIgnoreCase))
                continue;
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
                    if (prev != default) ScheduleEmit(path);
                }
            }
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
        catch { /* ignore */ }
    }

    private void ScheduleEmit(string path)
    {
        lock (_lock)
        {
            _debounceCts?.Cancel();
            _debounceCts = new CancellationTokenSource();
            var token = _debounceCts.Token;
            _ = Task.Delay(500, token).ContinueWith(t =>
            {
                if (t.IsCanceled) return;
                try { Changed?.Invoke(path); } catch { /* handler errors swallowed */ }
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
