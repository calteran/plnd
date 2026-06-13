#!/usr/bin/env bash
#
# Derive a SMALL test-only subset of the vendored USDA canonical corpus.
#
# Why: the full corpus (~8k rows) is bulk-inserted by the background seed at API
# startup. Under the e2e harness (fullyParallel, real backend) that startup burst
# competes with the auth handshakes of every test file at once. e2e does not need
# the full namespace — only a handful of canonical foods (e.g. "Oats, …" for the
# catalog path-1 local-hit test). `scripts/verify.sh` points the e2e API at this
# subset via APP_USDA_CORPUS_PATH so seeding stays cheap and deterministic.
#
# Regenerate after `just refresh-usda-corpus` changes the full corpus:
#   just refresh-usda-test-corpus
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FULL="${ROOT}/plnd_data/corpus/usda_canonical.jsonl.gz"
OUT="${ROOT}/plnd_data/corpus/usda_canonical.test.jsonl.gz"

if [[ ! -f "${FULL}" ]]; then
    echo "ERROR: full corpus not found at ${FULL}. Run 'just refresh-usda-corpus' first." >&2
    exit 1
fi

python3 - "${FULL}" "${OUT}" <<'PY'
import sys, gzip, json

full_path, out_path = sys.argv[1], sys.argv[2]

# Common canonical foods e2e (and a developer eyeballing the catalog) expect to
# find. "oats" backs the catalog path-1 local-hit test; the rest give a realistic
# small catalog. Up to PER_TERM rows per term keeps the subset tiny (~dozens).
TERMS = [
    "oats", "milk", "apple", "banana", "egg", "chicken", "rice", "broccoli",
    "cheese", "beef", "carrot", "potato", "bread", "butter", "yogurt", "spinach",
    "tomato", "onion", "salmon", "rice",
]
PER_TERM = 4

counts = {t: 0 for t in TERMS}
kept = []
with gzip.open(full_path, "rt") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        name = json.loads(line)["name"].lower()
        for t in TERMS:
            if t in name and counts[t] < PER_TERM:
                counts[t] += 1
                kept.append(line)
                break

missing = [t for t, c in counts.items() if c == 0]
if "oats" in missing:
    print("ERROR: no 'oats' row found — catalog path-1 e2e test would break.", file=sys.stderr)
    sys.exit(1)

with gzip.open(out_path, "wt") as f:
    for line in kept:
        f.write(line + "\n")

print(f"wrote {len(kept)} rows to {out_path}", file=sys.stderr)
if missing:
    print(f"note: no rows matched: {', '.join(missing)}", file=sys.stderr)
PY

echo "✅ Wrote test corpus subset. Review: git diff --stat plnd_data/corpus/"
