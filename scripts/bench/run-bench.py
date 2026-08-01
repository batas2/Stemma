#!/usr/bin/env python3
"""Run the canvas benchmark in a given browser engine and print the result.

The point of this harness is to compare rendering engines before committing to a desktop
shell (see .doc/features/F-002-desktop-shell.md). It serves canvas-bench.html, launches the
browser at it, waits for the page to POST its frame-time percentiles back, and prints them.

  ./run-bench.py --engine chromium
  ./run-bench.py --engine webkit          # needs Epiphany (WebKitGTK)
  ./run-bench.py --cmd 'my-shell {url}'   # anything that opens a URL, e.g. a Photino test host

Profiles: --profile realistic (60 nodes / 70 edges, the largest real sample)
          --profile stress    (250 nodes / 400 edges, headroom check)
"""
import argparse
import http.server
import json
import shutil
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES = {"realistic": (60, 70), "stress": (250, 400)}
ENGINES = {
    # --app gives a chrome-less window; the benchmark measures compositing, so run it headed
    "chromium": ["google-chrome", "--app={url}", "--new-window"],
    "webkit": ["epiphany", "{url}"],
}

result_holder: dict = {}
done = threading.Event()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            result_holder.update(json.loads(body))
        except json.JSONDecodeError:
            pass
        self.send_response(204)
        self.end_headers()
        done.set()

    def log_message(self, *a):
        pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=sorted(ENGINES))
    ap.add_argument("--cmd", help="custom launch command containing {url}")
    ap.add_argument("--profile", choices=sorted(PROFILES), default="realistic")
    ap.add_argument("--timeout", type=int, default=120)
    args = ap.parse_args()

    if not args.engine and not args.cmd:
        ap.error("pass --engine or --cmd")

    launch = args.cmd.split() if args.cmd else list(ENGINES[args.engine])
    exe = launch[0]
    if shutil.which(exe) is None:
        print(f"error: '{exe}' is not installed.", file=sys.stderr)
        if args.engine == "webkit":
            print("       WebKitGTK is what Photino renders with on Linux. Install a host for it:\n"
                  "         sudo apt install epiphany-browser        # or\n"
                  "         sudo apt install libwebkit2gtk-4.1-0", file=sys.stderr)
        return 2

    nodes, edges = PROFILES[args.profile]
    with socketserver.TCPServer(("127.0.0.1", 0), Handler) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = (f"http://127.0.0.1:{port}/canvas-bench.html"
               f"?nodes={nodes}&edges={edges}&label={args.profile}"
               f"&post=http://127.0.0.1:{port}/result")
        proc = subprocess.Popen([a.format(url=url) for a in launch],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            if not done.wait(args.timeout):
                print("error: timed out waiting for the benchmark to report", file=sys.stderr)
                return 1
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    r = result_holder
    print(f"\n  engine    {r.get('engine')}  ({args.profile}: {r['nodes']} nodes / {r['edges']} edges)")
    print(f"  mean fps  {r['meanFps']}")
    print(f"  frame ms  p50 {r['p50']}   p95 {r['p95']}   p99 {r['p99']}   worst {r['worst']}")
    print(f"  janky     {r['over16']}% over 16.7ms   {r['over33']}% over 33.3ms\n")
    print(json.dumps(r))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
