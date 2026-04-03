import json
import os

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.neighbors import NearestNeighbors


OUTPUT_DIR = "output"
MIN_MOVIE_INTERACTIONS = 100
TOP_K_NEIGHBORS = 50


os.makedirs(OUTPUT_DIR, exist_ok=True)

ratings = pd.read_csv("data/ratings.csv", usecols=["userId", "movieId", "rating"])
movies = pd.read_csv("data/movies.csv", usecols=["movieId", "title", "genres"])

movie_counts = ratings.groupby("movieId").size()
eligible_movie_ids = movie_counts[movie_counts >= MIN_MOVIE_INTERACTIONS].index
filtered = ratings[ratings["movieId"].isin(eligible_movie_ids)].copy()

filtered["user_idx"] = filtered["userId"].astype("category").cat.codes
filtered["movie_idx"] = filtered["movieId"].astype("category").cat.codes

# Item-item CF uses item-user interaction vectors.
item_user_matrix = csr_matrix(
    (
        filtered["rating"].astype(np.float32),
        (filtered["movie_idx"], filtered["user_idx"])
    )
)

movie_indices = filtered[["movieId", "movie_idx"]].drop_duplicates().sort_values("movie_idx")
movie_meta = movie_indices.merge(movies, on="movieId", how="left")

nn = NearestNeighbors(metric="cosine", algorithm="brute", n_neighbors=TOP_K_NEIGHBORS + 1)
nn.fit(item_user_matrix)
distances, indices = nn.kneighbors(item_user_matrix)

neighbors_output = []
for row_idx, neighbor_rows in enumerate(indices):
    movie_id = int(movie_meta.iloc[row_idx]["movieId"])
    row_neighbors = []
    for n_idx, dist in zip(neighbor_rows[1:], distances[row_idx][1:]):
        row_neighbors.append(
            {
                "movieId": int(movie_meta.iloc[n_idx]["movieId"]),
                "score": float(1.0 - dist)
            }
        )
    neighbors_output.append(
        {
            "movieId": movie_id,
            "neighbors": row_neighbors
        }
    )

with open(os.path.join(OUTPUT_DIR, "cf_neighbors_topk.json"), "w") as f:
    json.dump(neighbors_output, f)

print(
    "Success! Created output/cf_neighbors_topk.json "
    f"for {len(movie_meta)} movies with >= {MIN_MOVIE_INTERACTIONS} ratings."
)
