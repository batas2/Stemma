#!/usr/bin/env bash
# Verso — local run script
# Usage: ./run.sh [--dev | --prod] [--workspace <path>]
#   --dev        Run backend (port 5050) + Vite dev (port 5173) with HMR. Default.
#   --prod       Build frontend bundle into Verso.Web/wwwroot, then run backend only.
#   --workspace  Optional absolute or relative path to a workspace to auto-open.

set -euo pipefail

cd "$(dirname "$0")"

MODE="dev"
WORKSPACE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE="dev"; shift ;;
    --prod) MODE="prod"; shift ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    -h|--help) sed -n '1,10p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# --- Stale-process cleanup -------------------------------------------------
# Kill any leftover Verso.Web binary or dotnet host bound to our backend port.
# Without this, a previous run that exited via Ctrl-C without reaping its
# grandchild leaves the port held and the new backend fails to bind.
cleanup_stale() {
  local pids
  pids="$(pgrep -f 'Verso\.Web($|/| )' 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "==> Cleaning up stale Verso.Web processes: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 5050/tcp 2>/dev/null || true
  fi
}
cleanup_stale

echo "==> Verso starting (mode=$MODE)"

if [ ! -d src/Verso.Web.Client/node_modules ]; then
  echo "==> Installing frontend deps"
  (cd src/Verso.Web.Client && npm install --no-fund --no-audit --progress=false)
fi

echo "==> Restoring .NET deps"
dotnet restore Verso.slnx > /dev/null

if [ "$MODE" = "prod" ]; then
  echo "==> Building frontend (production)"
  (cd src/Verso.Web.Client && npm run build)
  echo "==> Running backend on http://localhost:5050"
  ASPNETCORE_URLS="http://localhost:5050" exec dotnet run --project src/Verso.Web -c Release
fi

# Dev mode: track children explicitly and reap descendants on exit.
BACK_PID=""
FRONT_PID=""

shutdown() {
  echo "==> Shutting down"
  # Kill direct children, then any descendant Verso.Web that dotnet spawned.
  for pid in "$BACK_PID" "$FRONT_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  pkill -P $$ 2>/dev/null || true
  pkill -f 'Verso\.Web($|/| )' 2>/dev/null || true
  pkill -f 'vite.*--port 5173' 2>/dev/null || true
  exit 0
}
trap shutdown EXIT INT TERM

echo "==> Backend on http://localhost:5050"
ASPNETCORE_URLS="http://localhost:5050" dotnet run --project src/Verso.Web --no-launch-profile &
BACK_PID=$!

# Wait for the backend port to actually accept connections before opening Vite,
# otherwise the auto-open curl below races and the Vite proxy errors-spam.
echo "==> Waiting for backend to be ready"
for i in {1..40}; do
  if curl -sS -o /dev/null --max-time 1 http://localhost:5050/api/workspace/snapshot 2>/dev/null; then
    break
  fi
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    echo "==> Backend died before becoming ready. See output above."
    exit 1
  fi
  sleep 0.5
done

echo "==> Frontend (Vite) on http://localhost:5173"
(cd src/Verso.Web.Client && npm run dev) &
FRONT_PID=$!

if [ -n "$WORKSPACE" ]; then
  if [ ! -d "$WORKSPACE" ]; then
    echo "==> ERROR: workspace path does not exist: $WORKSPACE" >&2
    echo "==> (resolved from script cwd: $(pwd))" >&2
  else
    ABS_WORKSPACE="$(cd "$WORKSPACE" && pwd)"
    echo "==> Auto-opening workspace: $ABS_WORKSPACE"
    curl -sS -X POST http://localhost:5050/api/workspace/open \
      -H 'content-type: application/json' \
      -d "{\"rootPath\":\"$ABS_WORKSPACE\"}" -w "\nHTTP %{http_code}\n" | head -c 400 || true
    echo
  fi
fi

echo "==> Open http://localhost:5173 in your browser"
echo "==> Press Ctrl-C to stop"
wait "$BACK_PID" "$FRONT_PID"
