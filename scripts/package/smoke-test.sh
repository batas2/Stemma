#!/usr/bin/env bash
# Try a built distribution the way the person who downloads it will.
#
# Usage: scripts/package/smoke-test.sh <stemma-linux-x64.tar.gz> [--version <x.y.z>]
#        scripts/package/smoke-test.sh --tool <folder holding the .nupkg files> [--version <x.y.z>]
#
# The tarball is unpacked somewhere new and every check runs with `dotnet` hidden from PATH: it is
# self-contained so that nothing needs one, and the first time that was tested, `stemma render` did
# (B-016). The tool package is installed from that folder alone into a fresh tool path, with a
# NuGet cache of its own, so nothing already on the machine stands in for it. `render` uses the
# system Google Chrome, so this needs Chrome; the window needs a display, so the shell is only
# asked which version it is. Exits non-zero on the first thing that does not work.

set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

TARBALL=""
TOOL=""
VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool) TOOL="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) TARBALL="$1"; shift ;;
  esac
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "$TOOL" ]]; then
  [[ -d "$TOOL" ]] || { echo "smoke-test: no folder at '$TOOL'" >&2; exit 2; }
  TOOL="$(cd "$TOOL" && pwd)"
  echo "==> Installing the tool from $TOOL"
  NUGET_PACKAGES="$WORK/nuget" dotnet tool install Stemma --tool-path "$WORK/tools" \
    --add-source "$TOOL" ${VERSION:+--version "$VERSION"} >/dev/null
  STEMMA="$WORK/tools/stemma"
  SHELL_VERSION=("$STEMMA" open --version)
  run() { "$@"; }
else
  [[ -f "$TARBALL" ]] || { echo "smoke-test: no tarball at '$TARBALL'" >&2; exit 2; }
  echo "==> Unpacking $TARBALL"
  tar -xzf "$TARBALL" -C "$WORK"
  STEMMA="$WORK/stemma/stemma"
  SHELL_VERSION=("$WORK/stemma/stemma-desktop" --version)

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
  run() { env -u DOTNET_ROOT PATH="$SHIMS" "$@"; }

  if run sh -c 'command -v dotnet' >/dev/null; then
    echo "smoke-test: could not hide dotnet" >&2; exit 1
  fi
fi

cp -r "$REPO/samples/StemmaArchitecture" "$WORK/workspace"

echo "==> stemma --version"
OUT="$(run "$STEMMA" --version)"
echo "    $OUT"
if [[ -n "$VERSION" && "$OUT" != "stemma $VERSION" ]]; then
  echo "smoke-test: expected 'stemma $VERSION'" >&2; exit 1
fi

echo "==> the shell's --version"
OUT="$(run "${SHELL_VERSION[@]}")"
echo "    $OUT"
if [[ -n "$VERSION" && "$OUT" != "stemma-desktop $VERSION" ]]; then
  echo "smoke-test: expected 'stemma-desktop $VERSION'" >&2; exit 1
fi

echo "==> stemma validate"
run "$STEMMA" validate --workspace "$WORK/workspace" | tail -1

echo "==> stemma render"
run "$STEMMA" render --workspace "$WORK/workspace" --view view_write --out "$WORK/out.png"
if [[ "$(head -c 8 "$WORK/out.png" | od -An -tx1 | tr -d ' \n')" != "89504e470d0a1a0a" ]]; then
  echo "smoke-test: render did not write a PNG" >&2; exit 1
fi

echo "==> It works as shipped"
