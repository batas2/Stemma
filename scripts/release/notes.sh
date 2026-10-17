#!/usr/bin/env bash
# Print the release notes for one version: its section of CHANGELOG.md.
#
# Usage: scripts/release/notes.sh <x.y.z>
#
# The changelog links into the repository with relative paths, which mean nothing on a release
# page. They are made absolute and pinned to the release's tag, so a note still points at what was
# true when it was written. Fails when the changelog has no section for the version: a release
# whose notes would be empty is a release nobody wrote down.

set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="${1:?usage: scripts/release/notes.sh <x.y.z>}"
BLOB="https://github.com/batas2/Stemma/blob/v$VERSION"

SECTION="$(awk -v heading="## $VERSION" '
  /^## / {
    if (found) exit
    if ($0 == heading || index($0, heading " ") == 1) { found = 1; next }
  }
  found { print }
' CHANGELOG.md)"

if [[ -z "${SECTION//[[:space:]]/}" ]]; then
  echo "notes: CHANGELOG.md has no section for $VERSION" >&2
  exit 1
fi

printf '%s\n' "$SECTION" | sed -E "s#\]\(\./#](${BLOB}/#g"
