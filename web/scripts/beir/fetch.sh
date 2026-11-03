#!/usr/bin/env bash
# Download BEIR test collections (corpus, questions and relevance judgements
# written by their original authors) into $1/<name>/{corpus.jsonl,
# queries.jsonl,qrels/test.tsv}. Sources, in order: the BeIR mirrors on
# Hugging Face (BeIR/<name> + BeIR/<name>-qrels), the MTEB mirrors
# (mteb/<name>), the original UKP archive. Prints each file's SHA-256 so a
# run records exactly which data it measured.
set -euo pipefail
dest="${1:-.cache/beir}"
shift || true
names="${*:-scifact nfcorpus fiqa}"
hf="https://huggingface.co/datasets"
get() { curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1"; }
unpack() { # url target: download, gunzip when the source is gzipped
  if [[ "$1" == *.gz ]]; then get "$1" "$2.gz" && gunzip -f "$2.gz"; else get "$1" "$2"; fi
}
list() {
  curl -fsSL "https://huggingface.co/api/datasets/$1" |
    python3 -c 'import json,sys;print("\n".join(s["rfilename"] for s in json.load(sys.stdin).get("siblings",[])))'
}
for n in $names; do
  d="$dest/$n"
  if [ -s "$d/corpus.jsonl" ] && [ -s "$d/queries.jsonl" ] && [ -s "$d/qrels/test.tsv" ]; then
    echo "$n: cached"
    continue
  fi
  rm -rf "$d"
  mkdir -p "$d/qrels"
  ok=""
  if files=$(list "BeIR/$n" 2>/dev/null) && qfiles=$(list "BeIR/$n-qrels" 2>/dev/null); then
    c=$(grep -m1 -E '^corpus\.jsonl(\.gz)?$' <<<"$files" || true)
    q=$(grep -m1 -E '^queries\.jsonl(\.gz)?$' <<<"$files" || true)
    t=$(grep -m1 -E '(^|/)test\.tsv$' <<<"$qfiles" || true)
    if [ -n "$c" ] && [ -n "$q" ] && [ -n "$t" ]; then
      unpack "$hf/BeIR/$n/resolve/main/$c" "$d/corpus.jsonl" &&
        unpack "$hf/BeIR/$n/resolve/main/$q" "$d/queries.jsonl" &&
        get "$hf/BeIR/$n-qrels/resolve/main/$t" "$d/qrels/test.tsv" && ok="BeIR/$n"
    fi
  fi
  if [ -z "$ok" ] && files=$(list "mteb/$n" 2>/dev/null); then
    c=$(grep -m1 -E '^corpus\.jsonl(\.gz)?$' <<<"$files" || true)
    q=$(grep -m1 -E '^queries\.jsonl(\.gz)?$' <<<"$files" || true)
    t=$(grep -m1 -E '^qrels/test\.tsv$' <<<"$files" || true)
    if [ -n "$c" ] && [ -n "$q" ] && [ -n "$t" ]; then
      unpack "$hf/mteb/$n/resolve/main/$c" "$d/corpus.jsonl" &&
        unpack "$hf/mteb/$n/resolve/main/$q" "$d/queries.jsonl" &&
        get "$hf/mteb/$n/resolve/main/$t" "$d/qrels/test.tsv" && ok="mteb/$n"
    fi
  fi
  if [ -z "$ok" ] && get "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/$n.zip" "$dest/$n.zip" 2>/dev/null; then
    unzip -q -o "$dest/$n.zip" -d "$dest" && rm "$dest/$n.zip" && ok="ukp"
  fi
  if [ -z "$ok" ]; then
    echo "$n: no source reachable"
    rm -rf "$d"
    continue
  fi
  echo "$n: from $ok"
  (cd "$d" && sha256sum corpus.jsonl queries.jsonl qrels/test.tsv)
done
