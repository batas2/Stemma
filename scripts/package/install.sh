#!/usr/bin/env bash
# Put this copy of Stemma on the menu and on PATH. No root, nothing outside your home folder.
#
#   ./install.sh            install from wherever this folder is
#   ./install.sh --uninstall

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/scalable/apps"
ENTRY="$APPS/stemma.desktop"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN/stemma" "$BIN/stemma-desktop" "$ENTRY" "$ICONS/stemma.svg"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" 2>/dev/null || true
  echo "==> Removed. The folder itself is still here: $HERE"
  exit 0
fi

mkdir -p "$BIN" "$APPS" "$ICONS"

# Symlinked rather than copied, so the two binaries keep finding wwwroot and each other beside them.
ln -sf "$HERE/stemma-desktop" "$BIN/stemma-desktop"
ln -sf "$HERE/stemma" "$BIN/stemma"

cp "$HERE/stemma.svg" "$ICONS/stemma.svg"
sed "s|^Exec=stemma-desktop|Exec=$HERE/stemma-desktop|" "$HERE/stemma.desktop" > "$ENTRY"
chmod +x "$ENTRY"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "==> Stemma is on the menu, and \`stemma\` and \`stemma-desktop\` are on PATH."
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "==> Note: $BIN is not on your PATH. Add it to use \`stemma\` from a terminal." ;;
esac
