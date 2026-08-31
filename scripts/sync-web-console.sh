#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 https://github.com/charan-rathore/intellirag-web.git "$tmp"
mkdir -p "$root/web"
# Keep this repo's wrapper README if present, replace the rest.
keep_readme=
[ -f "$root/web/README.md" ] && keep_readme="$(cat "$root/web/README.md")"
find "$root/web" -mindepth 1 -maxdepth 1 ! -name README.md -exec rm -rf {} +
# copy tree minus git and grok install chrome
cd "$tmp"
find . -type f ! -path './.git/*' ! -path './public/__grok/*' -exec bash -c '
  dest="$1/web/${2#./}"
  mkdir -p "$(dirname "$dest")"
  cp "$2" "$dest"
' _ "$root" {} \;
if [ -n "$keep_readme" ]; then
  printf '%s\n' "$keep_readme" > "$root/web/README.md"
fi
echo "Synced web/ from charan-rathore/intellirag-web"
