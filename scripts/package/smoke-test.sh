#!/usr/bin/env bash
# Try a built tarball the way the person who downloads it will: unpacked somewhere new, on a machine
# with no .NET.
#
# Usage: scripts/package/smoke-test.sh <stemma-linux-x64.tar.gz> [--version <x.y.z>]
#
# Every check runs with `dotnet` hidden from PATH. The tarball is self-contained so that nothing
# needs one, and the first time that was tested, `stemma render` did (B-016). `render` uses the
# system Google Chrome, so this needs Chrome; the shell needs a display, so it is only asked which
# version it is. Exits non-zero on the first thing that does not work.

set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

TARBALL=""
VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) TARBALL="$1"; shift ;;
  esac
done
[[ -f "$TARBALL" ]] || { echo "smoke-test: no tarball at '$TARBALL'" >&2; exit 2; }
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Unpacking into $WORK"
tar -xzf "$TARBALL" -C "$WORK"
STEMMA="$WORK/stemma"

# A PATH with everything on it except dotnet. Linking each executable rather than dropping a
# directory, because dotnet usually shares /usr/bin with everything else.
SHIMS="$WORK/path"
mkdir -p "$SHIMS"
IFS=: read -ra DIRS <<< "$PATH"
for dir in "${DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  for exe in "$dir"/*; do
    name="$(basename "$exe")"
    [[ "$name" == dotnet || -e "$SHIMS/$name" || ! -x "$exe" ]] && continue
    ln -s "$exe" "$SHIMS/$name"
  done
done
bare() { env -u DOTNET_ROOT PATH="$SHIMS" "$@"; }

if bare sh -c 'command -v dotnet' >/dev/null; then
  echo "smoke-test: could not hide dotnet" >&2; exit 1
fi

cp -r "$REPO/samples/StemmaArchitecture" "$WORK/workspace"

echo "==> stemma --version"
OUT="$(bare "$STEMMA/stemma" --version)"
echo "    $OUT"
if [[ -n "$VERSION" && "$OUT" != "stemma $VERSION" ]]; then
  echo "smoke-test: expected 'stemma $VERSION'" >&2; exit 1
fi

echo "==> stemma-desktop --version"
bare "$STEMMA/stemma-desktop" --version

echo "==> stemma validate"
bare "$STEMMA/stemma" validate --workspace "$WORK/workspace" | tail -1

echo "==> stemma render"
bare "$STEMMA/stemma" render --workspace "$WORK/workspace" --view view_write --out "$WORK/out.png"
if [[ "$(head -c 8 "$WORK/out.png" | od -An -tx1 | tr -d ' \n')" != "89504e470d0a1a0a" ]]; then
  echo "smoke-test: render did not write a PNG" >&2; exit 1
fi

echo "==> The tarball works without .NET"
