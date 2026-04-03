import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"

STEPS = [
    "baseline_gen.py",
    "mf_gen.py",
    "cf_gen.py",
    "map_gen.py",
]


def run_step(script_name):
    print(f"\n==> Running {script_name}")
    subprocess.run([sys.executable, script_name], cwd=ROOT, check=True)


def main():
    for step in STEPS:
        run_step(step)

    expected = [
        "baseline_top100.json",
        "popularity.json",
        "title_index.json",
        "embeddings.json",
        "mf_neighbors_topk.json",
        "cf_neighbors_topk.json",
        "movie_map.json",
    ]
    print("\nBuild complete. Generated artifacts:")
    for name in expected:
        path = OUTPUT_DIR / name
        status = "OK" if path.exists() else "MISSING"
        print(f"- {name}: {status}")


if __name__ == "__main__":
    main()
