# MovieLens RecSys Explorer

This repository is a small **interactive movie recommender demo** built on the [MovieLens](https://grouplens.org/datasets/movielens/) dataset. Nothing trains in the browser: a Python pipeline reads ratings and movie metadata, writes JSON artifacts to `output/`, and a static page (`index.html` + `ui_logic.js`) loads those files so you can explore recommendations interactively.

You pick five anchor movies, and the UI blends **item–item collaborative filtering** and **matrix factorization (truncated SVD)** neighborhoods, lets you steer **mainstream vs niche** with a slider, and shows side views like a genre–decade heatmap and a simple recommendation graph.

<img width="990" height="740" alt="Movie explorer map view" src="https://github.com/user-attachments/assets/997736ed-2cfd-49a3-bae2-3d5257b2d6e2" />

<img width="886" height="736" alt="Recommendation comparison UI" src="https://github.com/user-attachments/assets/a82a84db-8928-42af-8e87-1f31353f6770" />

**What you can try in the UI**

- Enter five anchor titles (autocomplete comes from a precomputed title index).
- Compare CF vs MF lists, overlap, and a blended view.
- Use the niche slider to rebalance recommendations toward popular or long-tail titles.
- Inspect the 2D map (t-SNE on MF embeddings), heatmap, and graph panels.

---

## What you need

- **Python 3.10+** (3.11 works well) with `pip`.
- **Disk space**: the full **MovieLens 25M** archive is on the order of hundreds of MB compressed and well over 1 GB unpacked; building artifacts needs additional space under `output/`.
- **RAM**: loading `ratings.csv` for the baseline and CF steps is memory-heavy on the full 25M file. If you hit memory limits, use a smaller MovieLens snapshot (for example MovieLens Latest Small) only if you accept that IDs and coverage may differ from a 25M-based demo.

---

## Where to get the data

The pipeline expects two CSV files at fixed paths:

- `data/ratings.csv`
- `data/movies.csv`

**Recommended source: MovieLens 25M** (matches the scale this project was built around).

1. Open the GroupLens MovieLens dataset page:  
   https://grouplens.org/datasets/movielens/
2. Download **MovieLens 25M** (direct link to the zip is typically):  
   https://files.grouplens.org/datasets/movielens/ml-25m.zip  
3. Unzip the archive. You should get a folder such as `ml-25m/` containing `ratings.csv`, `movies.csv`, `links.csv`, etc.
4. Copy (or symlink) the two required files into this repo:

```bash
mkdir -p data
cp /path/to/ml-25m/ratings.csv /path/to/ml-25m/movies.csv data/
```

You do **not** need to commit `data/`; it is listed in `.gitignore` so local CSVs stay private and large files stay out of git.

---

## Quickest way to run everything

From the **repository root** (the directory that contains `index.html` and `demo.sh`):

```bash
bash demo.sh
```

That script installs Python dependencies, rebuilds `output/`, validates JSON, optionally regenerates figures under `eval_results/`, then starts a static server. Open **http://localhost:8000** in a browser.

Useful options:

| Goal | Command |
|------|---------|
| Different port | `PORT=8080 bash demo.sh` |
| Skip matplotlib evaluation plots (faster) | `SKIP_EVAL=1 bash demo.sh` |

Stop the server with **Ctrl+C** in the terminal.

---

## Manual setup (same result as the demo script, step by step)

If you prefer not to use `demo.sh`:

```bash
python -m pip install -r requirements.txt
python scripts/build_all.py
python scripts/validate_outputs.py
python scripts/generate_eval.py    # optional; writes PNGs to eval_results/
python -m http.server 8000         # serve repo root; open http://localhost:8000
```

The HTTP server **must** use the repo root as its working directory so paths like `output/movie_map.json` resolve the same way as in `demo.sh`.

---

## How the build pipeline fits together

`scripts/build_all.py` runs four stages in order:

1. **`baseline_gen.py`** — popularity metrics, weighted ratings, `baseline_top100.json`, `popularity.json`, and `title_index.json` for search.
2. **`mf_gen.py`** — sparse user–item matrix, truncated SVD item factors, `embeddings.json`, and `mf_neighbors_topk.json` (cosine kNN in latent space). It samples up to **2M** ratings for speed while keeping a fixed random seed.
3. **`cf_gen.py`** — item–item CF on users who rated each movie, restricted to movies with enough ratings; writes `cf_neighbors_topk.json`.
4. **`map_gen.py`** — t-SNE 2D coordinates from MF embeddings plus metadata → `movie_map.json`.

After a successful build, `output/` should contain at least:

- `baseline_top100.json`, `popularity.json`, `title_index.json`
- `embeddings.json`, `mf_neighbors_topk.json`, `cf_neighbors_topk.json`
- `movie_map.json`

**`validate_outputs.py`** checks that those files exist, that required fields are present, and that identifiers line up across files.

**`generate_eval.py`** reads the neighbor JSON and `movies.csv`, runs a few simulation-style plots, and saves PNGs under **`eval_results/`** (useful for slides or reports, not required for the web UI).

---

## Repository layout

| Path | Purpose |
|------|--------|
| `data/` | Your `ratings.csv` and `movies.csv` (local only). |
| `output/` | Generated JSON consumed by the frontend (git may or may not track these in your fork). |
| `eval_results/` | Optional plots from `generate_eval.py`. |
| `scripts/` | All Python used for building and validating artifacts. |
| `tests/` | `pytest` checks for schema and basic HTML structure. |
| `experiments/cf_mf_umap/` | Jupyter notebook + conda env for deeper CF/MF/UMAP experiments. |
| `index.html`, `ui_logic.js` | Static app; load in a browser via any static file server. |
| `demo.sh` | One command to install, build, validate, optionally plot, and serve. |

---

## How the frontend uses the artifacts

The D3 app loads JSON from `output/`:

- **`title_index.json`** — resolve typed movie titles to `movieId`s.
- **`cf_neighbors_topk.json` / `mf_neighbors_topk.json`** — neighbor lists and scores for on-the-fly ranking and blending.
- **`movie_map.json`** — scatterplot positions and popularity fields for the map.
- **`popularity.json`** and **`baseline_top100.json`** — niche vs mainstream signals and baselines.

The 2D map is a **visualization** of MF structure (after t-SNE). Final ranked lists combine neighbor scores in JavaScript and apply the niche slider on top of stored popularity features.

<img width="1732" height="1540" alt="Extended analysis panels" src="https://github.com/user-attachments/assets/910f8cf9-4867-4585-8c2c-38cf23cd66b7" />

---

## Tests

With `output/` already built:

```bash
python -m pip install pytest
python -m pytest tests -v
```

Tests assert that expected JSON files exist, are non-empty arrays with the right keys, and that `index.html` still contains key UI hooks.

---

## Notebook experiments

Under **`experiments/cf_mf_umap/`** there is a longer notebook workflow (downloads/unpacks MovieLens inside the notebook flow, trains models, UMAP, etc.). See **`experiments/cf_mf_umap/README.md`** for conda environment setup. That path is separate from the lightweight static app pipeline in `scripts/`.

---

## Troubleshooting

- **`Address already in use`** — Something else is bound to port 8000. Use `PORT=8080 bash demo.sh` or stop the other process.
- **Build is slow or uses a lot of RAM** — Expected on full `ratings.csv`. `SKIP_EVAL=1 bash demo.sh` skips figure generation only; the heavy part is usually MF/CF over large data.
- **Empty map or “Artifact load failure” in the UI** — Re-run `python scripts/build_all.py`, confirm `output/*.json` exist, and ensure the server root is the repo directory (not `scripts/` or `output/`).

---

## Notes

This project is aimed at a **reproducible offline demo** (fixed seeds, precomputed JSON) rather than a production recommender service. For questions about the MovieLens license and attribution, see the dataset page on [GroupLens](https://grouplens.org/datasets/movielens/).
