#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <FROM_CASE_FILE> <TO_CASE_FILE>"
  exit 1
fi

FROM="$1"
TO="$2"

if [[ ! -f "$FROM" || ! -f "$TO" ]]; then
  echo "Both case files must exist."
  exit 1
fi

FROM_ID="$(basename "$FROM" .md)"
TO_ID="$(basename "$TO" .md)"

TO_BULLET="- [${TO_ID}](${TO})"
FROM_BULLET="- [${FROM_ID}](${FROM})"

if ! rg -q "10\\.1 Related Cases" "$FROM"; then
  echo "FROM file missing '10.1 Related Cases' section."
  exit 1
fi
if ! rg -q "10\\.2 Referenced By" "$TO"; then
  echo "TO file missing '10.2 Referenced By' section."
  exit 1
fi

if ! rg -qF "$TO_BULLET" "$FROM"; then
  awk -v bullet="$TO_BULLET" '
    { print }
    /^## 10\.1 Related Cases$/ { getline; print; print bullet; next }
  ' "$FROM" > "${FROM}.tmp" && mv "${FROM}.tmp" "$FROM"
fi

if ! rg -qF "$FROM_BULLET" "$TO"; then
  awk -v bullet="$FROM_BULLET" '
    { print }
    /^## 10\.2 Referenced By$/ { getline; print; print bullet; next }
  ' "$TO" > "${TO}.tmp" && mv "${TO}.tmp" "$TO"
fi

echo "Linked:"
echo "  ${FROM_ID} -> ${TO_ID}"
