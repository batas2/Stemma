#!/usr/bin/env bash
# Run all engine tests. Used by CI and locally before committing.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> dotnet test"
dotnet test Stemma.slnx --nologo --logger "console;verbosity=normal"

echo "==> vitest (frontend)"
(cd src/Stemma.Web.Client && npm test)
