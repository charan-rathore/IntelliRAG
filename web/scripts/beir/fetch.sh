#!/usr/bin/env bash
# Download BEIR test collections (corpus, questions and relevance judgements
# written by their original authors) into $1. Prints each archive's SHA-256
# so a run records exactly which data it measured.
set -euo pipefail
dest="${1:-.cache/beir}"
shift || true
mkdir -p "$dest"
for name in "${@:-scifact nfcorpus fiqa}"; do
  for n in $name; do
    if [ -f "$dest/$n/corpus.jsonl" ]; then echo "$n: cached"; continue; fi
    curl -fsSL --retry 3 -o "$dest/$n.zip" "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/$n.zip"
    echo "$n: sha256 $(sha256sum "$dest/$n.zip" | cut -d' ' -f1)"
    unzip -q -o "$dest/$n.zip" -d "$dest"
    rm "$dest/$n.zip"
  done
done
