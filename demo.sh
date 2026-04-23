#!/usr/bin/env bash
# One-shot demo: deps -> build -> validate -> (optional) eval plots -> static server.
# Usage: bash demo.sh
#        PORT=8080 bash demo.sh
#        SKIP_EVAL=1 bash demo.sh   # faster; skips matplotlib plots

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PORT="${PORT:-8000}"

echo "==> Checking data/"
if [[ ! -f data/ratings.csv || ! -f data/movies.csv ]]; then
  echo "Add MovieLens files first: data/ratings.csv and data/movies.csv"
  exit 1
fi

echo "==> Python dependencies (pip)"
python -m pip install -q -r requirements.txt

echo "==> Building output/ artifacts"
python scripts/build_all.py

echo "==> Validating output/"
python scripts/validate_outputs.py

if [[ -n "${SKIP_EVAL:-}" ]]; then
  echo "==> Skipping eval plots (SKIP_EVAL is set)"
elif python -c "import matplotlib" 2>/dev/null; then
  echo "==> Generating eval_results/ plots"
  python scripts/generate_eval.py
else
  echo "==> Skipping eval plots (matplotlib not importable; fix env and re-run)"
fi

echo ""
echo "Open: http://localhost:${PORT}"
echo "Stop: Ctrl+C"
echo ""
exec python -m http.server "$PORT"
