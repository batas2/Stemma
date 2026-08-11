#!/usr/bin/env bash
# Stemma — local run script
# Usage: ./run.sh [--dev | --prod] [--window] [--workspace <path>]
#   --dev        Run backend (port 5050) + Vite dev (port 5173) with HMR. Default.
#   --prod       Build frontend bundle into Stemma.Web/wwwroot, then run backend only.
#                The port is chosen by the OS, so a second run never collides.
#   --window     Open Stemma in the desktop shell — its own window, its own backend (F-002).
#                With --dev this falls back to the browser's app-mode, because HMR needs the
#                Vite origin and the shell serves the built bundle.
#   --workspace  Optional absolute or relative path to a workspace to auto-open.
#   --log-level  trace | debug | information | warning | error | critical | none  (default: information)
#   --log-format simple | json   (default: simple on a terminal, json when stdout is a pipe)
#
# Logs are written to ~/.stemma/logs/ as JSON lines and are capped without you doing anything.
# Nothing is sent anywhere: a Stemma record carries your architecture (ADR-0020).

set -euo pipefail

cd "$(dirname "$0")"

MODE="dev"
MODE_SET=0
WINDOW=0
WORKSPACE=""
LOG_LEVEL=""
LOG_FORMAT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE="dev"; MODE_SET=1; shift ;;
    --prod) MODE="prod"; MODE_SET=1; shift ;;
    --window) WINDOW=1; shift ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --log-level) LOG_LEVEL="$2"; shift 2 ;;
    --log-format) LOG_FORMAT="$2"; shift 2 ;;
    -h|--help) sed -n '1,16p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# --- Diagnostics -----------------------------------------------------------
# Passed as environment rather than as arguments so both launch paths below get them without each
# having to thread flags through `dotnet run --`.
[[ -n "$LOG_LEVEL" ]] && export STEMMA_LOG_LEVEL="$LOG_LEVEL"
[[ -n "$LOG_FORMAT" ]] && export STEMMA_LOG_FORMAT="$LOG_FORMAT"

# --window means the real shell, unless --dev was asked for explicitly: the shell serves the built
# bundle, and asking for dev is asking for HMR.
SHELL_MODE=0
if [ "$WINDOW" = "1" ] && { [ "$MODE_SET" = "0" ] || [ "$MODE" = "prod" ]; }; then
  SHELL_MODE=1
fi

# --- Windowed mode -----------------------------------------------------------
# The real shell (ADR-0017) is `stemma-desktop`: one process holding both Kestrel and a native
# window, on a port the OS picks. Kept here as the fallback for --dev, where the app has to be
# served from Vite's origin for HMR to work — a browser's app-mode gives a chrome-less window with
# its own icon for no packaging work.
open_window() {
  local url="$1"
  local browser
  for browser in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
    if command -v "$browser" >/dev/null 2>&1; then
      echo "==> Opening Stemma window ($browser --app)"
      "$browser" --app="$url" --new-window >/dev/null 2>&1 &
      return 0
    fi
  done
  echo "==> --window needs a Chromium-based browser on PATH; falling back to a normal tab." >&2
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 &
}

# --- Stale-process cleanup -------------------------------------------------
# Only dev needs this now. Dev pins 5050 because the Vite proxy has to name a target, and a previous
# run that exited via Ctrl-C without reaping its grandchild leaves that port held. Everything else
# binds :0 and reads the assignment back, so there is nothing to reclaim.
cleanup_stale() {
  local pids
  pids="$(pgrep -f 'Stemma\.Web($|/| )' 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "==> Cleaning up stale Stemma.Web processes: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 5050/tcp 2>/dev/null || true
    # An orphaned Vite squatting 5173 makes the next dev server drift to 5174 while the browser
    # keeps hitting the dead-backed 5173 (endless proxy ECONNREFUSED) — reclaim it too.
    fuser -k 5173/tcp 2>/dev/null || true
  fi
}
[ "$MODE" = "dev" ] && [ "$SHELL_MODE" = "0" ] && cleanup_stale

[ "$SHELL_MODE" = "1" ] && MODE="shell"
echo "==> Stemma starting (mode=$MODE)"

# --- Claude transport advisory --------------------------------------------
# The default in appsettings.json is `cli` (Claude Code subprocess; uses your
# `claude login` session). Override at runtime with `STEMMA_AI_TRANSPORT=http`
# plus an Anthropic API key.
ACTIVE_TRANSPORT="${STEMMA_AI_TRANSPORT:-cli}"
if [ "$ACTIVE_TRANSPORT" = "cli" ]; then
  if command -v claude >/dev/null 2>&1; then
    echo "==> Claude transport: cli (claude $(claude --version 2>/dev/null | head -n1 | awk '{print $1}'))"
  else
    echo "==> Claude transport: cli — but \`claude\` is NOT on PATH."
    echo "    Install:  npm i -g @anthropic-ai/claude-code  &&  claude login"
    echo "    Or pin HTTP:  STEMMA_AI_TRANSPORT=http ANTHROPIC_API_KEY=sk-ant-... ./run.sh"
  fi
elif [ "$ACTIVE_TRANSPORT" = "http" ]; then
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "==> Claude transport: http (ANTHROPIC_API_KEY set, ${#ANTHROPIC_API_KEY} chars)"
  elif [ -f "${HOME:-}/.stemma/credentials.json" ]; then
    echo "==> Claude transport: http (~/.stemma/credentials.json found)"
  else
    echo "==> Claude transport: http — no API key found in env or ~/.stemma/credentials.json."
    echo "    Set:  export ANTHROPIC_API_KEY=sk-ant-..."
  fi
fi

if [ ! -d src/Stemma.Web.Client/node_modules ]; then
  echo "==> Installing frontend deps"
  (cd src/Stemma.Web.Client && npm install --no-fund --no-audit --progress=false)
fi

echo "==> Restoring .NET deps"
dotnet restore Stemma.slnx > /dev/null

if [ "$MODE" = "shell" ]; then
  echo "==> Building frontend (production)"
  (cd src/Stemma.Web.Client && npm run build)
  echo "==> Opening the Stemma window"
  # The shell owns its own backend on a port the OS picks, so there is nothing to start here and
  # nothing to reclaim afterwards: closing the window ends the process.
  SHELL_ARGS=()
  [ -n "$WORKSPACE" ] && SHELL_ARGS+=(--workspace "$WORKSPACE")
  exec dotnet run --project src/Stemma.Desktop -c Release --no-launch-profile -- "${SHELL_ARGS[@]}"
fi

if [ "$MODE" = "prod" ]; then
  echo "==> Building frontend (production)"
  (cd src/Stemma.Web.Client && npm run build)

  # Bound to :0 and read back, so a second `--prod` run never collides with the first.
  PORT_FILE="$(mktemp -u -t stemma-port-XXXXXX)"
  export STEMMA_PORT_FILE="$PORT_FILE"
  ASPNETCORE_URLS="http://127.0.0.1:0" dotnet run --project src/Stemma.Web -c Release --no-launch-profile &
  BACK_PID=$!
  # shellcheck disable=SC2064
  trap "kill $BACK_PID 2>/dev/null || true; rm -f '$PORT_FILE'; exit 0" EXIT INT TERM

  echo "==> Waiting for the backend to bind"
  for _ in {1..60}; do
    [ -s "$PORT_FILE" ] && break
    if ! kill -0 "$BACK_PID" 2>/dev/null; then
      echo "==> Backend died before it bound. See output above."
      exit 1
    fi
    sleep 0.5
  done
  URL="$(cat "$PORT_FILE" 2>/dev/null || true)"
  if [ -z "$URL" ]; then
    echo "==> Backend never reported an address."
    exit 1
  fi

  echo "==> Stemma on $URL"
  if [ -n "$WORKSPACE" ] && [ -d "$WORKSPACE" ]; then
    ABS_WORKSPACE="$(cd "$WORKSPACE" && pwd)"
    echo "==> Auto-opening workspace: $ABS_WORKSPACE"
    curl -sS -X POST "$URL/api/workspace/open" -H 'content-type: application/json' \
      -d "{\"rootPath\":\"$ABS_WORKSPACE\"}" -o /dev/null || true
  fi
  [ "$WINDOW" = "1" ] && open_window "$URL"
  wait "$BACK_PID"
  exit 0
fi

# Dev mode: track children explicitly and reap descendants on exit.
BACK_PID=""
FRONT_PID=""

shutdown() {
  echo "==> Shutting down"
  # Kill direct children, then any descendant Stemma.Web that dotnet spawned.
  for pid in "$BACK_PID" "$FRONT_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  pkill -P $$ 2>/dev/null || true
  pkill -f 'Stemma\.Web($|/| )' 2>/dev/null || true
  pkill -f 'vite.*--port 5173' 2>/dev/null || true
  exit 0
}
trap shutdown EXIT INT TERM

echo "==> Backend on http://localhost:5050"
ASPNETCORE_URLS="http://localhost:5050" dotnet run --project src/Stemma.Web --no-launch-profile &
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
(cd src/Stemma.Web.Client && npm run dev) &
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

if [ "$WINDOW" = "1" ]; then
  open_window "http://localhost:5173"
else
  echo "==> Open http://localhost:5173 in your browser"
fi
echo "==> Press Ctrl-C to stop"
wait "$BACK_PID" "$FRONT_PID"
