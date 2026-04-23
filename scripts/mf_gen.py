import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import TruncatedSVD
from sklearn.neighbors import NearestNeighbors
from scipy.sparse import csr_matrix


ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output"
DATA_DIR = ROOT / "data"
RATINGS_SAMPLE_SIZE = 2_000_000
N_FACTORS = 20
TOP_K_NEIGHBORS = 50


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ratings = pd.read_csv(DATA_DIR / "ratings.csv", usecols=["userId", "movieId", "rating"])
movies = pd.read_csv(DATA_DIR / "movies.csv", usecols=["movieId", "title", "genres"])

sample_size = min(RATINGS_SAMPLE_SIZE, len(ratings))
ratings = ratings.sample(sample_size, random_state=42)

ratings["user_idx"] = ratings["userId"].astype("category").cat.codes
ratings["movie_idx"] = ratings["movieId"].astype("category").cat.codes

user_item_matrix = csr_matrix(
    (ratings["rating"].astype(np.float32), (ratings["user_idx"], ratings["movie_idx"]))
)

svd = TruncatedSVD(n_components=N_FACTORS, random_state=42)
user_factors = svd.fit_transform(user_item_matrix)
item_factors = svd.components_.T.astype(np.float32)

movie_indices = ratings[["movieId", "movie_idx"]].drop_duplicates().sort_values("movie_idx")
movie_meta = movie_indices.merge(movies, on="movieId", how="left")

embeddings_df = pd.DataFrame(item_factors)
embeddings_df["movieId"] = movie_meta["movieId"].values
embeddings_df.to_json(OUTPUT_DIR / "embeddings.json", orient="records")

nn = NearestNeighbors(metric="cosine", algorithm="brute", n_neighbors=TOP_K_NEIGHBORS + 1)
nn.fit(item_factors)
distances, indices = nn.kneighbors(item_factors)

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

with open(OUTPUT_DIR / "mf_neighbors_topk.json", "w") as f:
    json.dump(neighbors_output, f)

print(
    "Success! Created output/embeddings.json and output/mf_neighbors_topk.json "
    f"from {sample_size} sampled ratings."
)
