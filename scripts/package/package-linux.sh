#!/usr/bin/env bash
# Build the Linux distribution: a tarball you unpack and run.
#
# Usage: scripts/package/package-linux.sh [--runtime linux-x64] [--out dist]
#
# The first of the three distribution formats F-002 lists (tarball → AppImage → Flatpak). It is
# self-contained: the .NET runtime is inside, so the only thing the machine needs is WebKitGTK 4.1,
# which every current desktop already has. A workspace with no project file opens with no .NET SDK
# at all (ADR-0016); a repository workspace still needs one, because MSBuild is what knows what the
# compilation actually is.

set -euo pipefail
cd "$(dirname "$0")/../.."

RUNTIME="linux-x64"
OUT="dist"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime) RUNTIME="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

STAGE="$OUT/stemma"
rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> Building the front end"
(cd src/Stemma.Web.Client && npm ci --no-fund --no-audit --progress=false >/dev/null 2>&1 || npm install --no-fund --no-audit --progress=false)
(cd src/Stemma.Web.Client && npm run build)

# Both binaries land in one folder on purpose: it is the layout `HostLocation` and the shell's own
# lookup expect, so `stemma render` finds the web host and `stemma open` finds the window.
for project in src/Stemma.Desktop src/Stemma.Cli; do
  echo "==> Publishing $(basename "$project")"
  dotnet publish "$project" -c Release -r "$RUNTIME" --self-contained true \
    -p:DebugType=none -o "$STAGE" --nologo -v q
done

# Vite writes the bundle into the web project, and it is never copied to build output — a host
# without it starts happily, serves the API, and 404s the page.
echo "==> Staging the front end"
rm -rf "$STAGE/wwwroot"
cp -r src/Stemma.Web/wwwroot "$STAGE/wwwroot"
cp src/Stemma.Web.Client/public/favicon.svg "$STAGE/stemma.svg"

cp scripts/package/stemma.desktop "$STAGE/stemma.desktop"
cp scripts/package/install.sh "$STAGE/install.sh"
chmod +x "$STAGE/install.sh" "$STAGE/stemma-desktop" "$STAGE/stemma"

cat > "$STAGE/README.txt" <<'EOF'
Stemma — the living architecture model

  ./stemma-desktop            open the window
  ./stemma-desktop <folder>   open the window on a workspace
  ./stemma validate --help    check a workspace from the command line
  ./stemma render --help      turn a model and a view into an image

  ./install.sh                put Stemma on the menu and on PATH (no root needed)

Requires WebKitGTK 4.1 (libwebkit2gtk-4.1). Everything else is in this folder.
A workspace that is only a model needs nothing more; a workspace that is a repository needs the
.NET SDK, because that is what knows how the code actually compiles.
EOF

TARBALL="$OUT/stemma-$RUNTIME.tar.gz"
echo "==> Writing $TARBALL"
tar -czf "$TARBALL" -C "$OUT" stemma

echo "==> Done: $TARBALL ($(du -h "$TARBALL" | cut -f1))"
