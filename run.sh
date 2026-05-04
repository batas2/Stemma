#!/usr/bin/env bash
# Verso — local run script
# Usage: ./run.sh [--dev | --prod] [--workspace <path>]
#   --dev        Run backend (port 5050) + Vite dev (port 5173) with HMR. Default.
#   --prod       Build frontend bundle into Verso.Web/wwwroot, then run backend only.
#   --workspace  Optional path to a sample workspace; if set, opens to http://localhost:5050/?workspace=<path>

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
  ASPNETCORE_URLS="http://localhost:5050" dotnet run --project src/Verso.Web -c Release
  exit 0
fi

# Dev mode: run backend + Vite together
trap 'kill 0 2>/dev/null || true' EXIT INT TERM

echo "==> Backend on http://localhost:5050"
ASPNETCORE_URLS="http://localhost:5050" dotnet run --project src/Verso.Web --no-launch-profile &
BACK_PID=$!

sleep 2

echo "==> Frontend (Vite) on http://localhost:5173"
(cd src/Verso.Web.Client && npm run dev) &
FRONT_PID=$!

if [ -n "$WORKSPACE" ]; then
  # Resolve to absolute path; the backend's working directory differs from this script's.
  if [ ! -d "$WORKSPACE" ]; then
    echo "==> ERROR: workspace path does not exist: $WORKSPACE" >&2
    echo "==> (resolved from script cwd: $(pwd))" >&2
  else
    ABS_WORKSPACE="$(cd "$WORKSPACE" && pwd)"
    sleep 3
    echo "==> Auto-opening workspace: $ABS_WORKSPACE"
    curl -sS -X POST http://localhost:5050/api/workspace/open \
      -H 'content-type: application/json' \
      -d "{\"rootPath\":\"$ABS_WORKSPACE\"}" -w "\nHTTP %{http_code}\n" | head -c 400 || true
    echo
  fi
fi

echo "==> Open http://localhost:5173 in your browser"
echo "==> Press Ctrl-C to stop"
wait $BACK_PID $FRONT_PID
