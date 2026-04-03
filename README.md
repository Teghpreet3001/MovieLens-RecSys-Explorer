# MovieLens-RecSys-Explorer

<img width="990" height="740" alt="image" src="https://github.com/user-attachments/assets/997736ed-2cfd-49a3-bae2-3d5257b2d6e2" />

<img width="886" height="736" alt="image" src="https://github.com/user-attachments/assets/a82a84db-8928-42af-8e87-1f31353f6770" />

Interactive recommender-system explorer built on MovieLens data. The project precomputes recommendation artifacts offline and serves a static frontend that lets users:

- enter 5 anchor movies
- compare item-item CF and matrix-factorization recommendations
- steer popularity vs niche preference with a slider
- inspect recommendation bias via a genre-decade heatmap
- view recommendation overlap in a user-centered graph

## Project structure

- `data/`: raw MovieLens CSV files
- `output/`: generated JSON artifacts consumed by the UI
- `baseline_gen.py`: popularity artifacts + title index
- `mf_gen.py`: matrix factorization embeddings + MF neighbor graph
- `cf_gen.py`: item-item collaborative filtering neighbor graph
- `map_gen.py`: 2D visualization map generation
- `build_all.py`: one-command artifact build
- `validate_outputs.py`: output artifact validation
- `index.html`, `ui_logic.js`: static frontend
- `cf_mf_umap/`: notebook-based experimentation and evaluation

## Required input data

Place the following files in `data/`:

- `ratings.csv`
- `movies.csv`

The current app directly uses `ratings.csv` and `movies.csv`.

## Install

Using `pip`:

```bash
python -m pip install -r requirements.txt
```

If you are using the notebook environment instead, make sure the environment also includes:

- `pandas`
- `numpy`
- `scipy`
- `scikit-learn`

## Build all artifacts

Run:

```bash
python build_all.py
```

This generates:

- `output/baseline_top100.json`
- `output/popularity.json`
- `output/title_index.json`
- `output/embeddings.json`
- `output/mf_neighbors_topk.json`
- `output/cf_neighbors_topk.json`
- `output/movie_map.json`

## Validate outputs

Run:

```bash
python validate_outputs.py
```

This checks:

- expected files exist
- required fields exist
- catalog outputs do not contain duplicate `movieId`s
- title index and popularity artifacts are aligned

## Run the UI

Serve the repo root with a static file server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Frontend behavior

The app loads precomputed artifacts from `output/`:

- `title_index.json` for anchor resolution
- `cf_neighbors_topk.json` for CF recommendations
- `mf_neighbors_topk.json` for MF recommendations
- `movie_map.json` for visualization coordinates
- `popularity.json` and `baseline_top100.json` for popularity metadata

The 2D map is for visualization only. Recommendation ranking is computed from CF and MF neighbor aggregation in the frontend, then reranked with the niche/popularity slider.

<img width="1732" height="1540" alt="image" src="https://github.com/user-attachments/assets/910f8cf9-4867-4585-8c2c-38cf23cd66b7" />

## Notes

- The current build is designed for a class-project demo and prioritizes reproducible artifact generation over live training.
- The notebook in `cf_mf_umap/` contains a richer experimental pipeline for evaluation and UMAP-based analysis.
