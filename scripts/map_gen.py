import json
from pathlib import Path

import pandas as pd
from sklearn.manifold import TSNE

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output"
DATA_DIR = ROOT / "data"

with open(OUTPUT_DIR / "embeddings.json", "r") as f:
    data = json.load(f)

df = pd.DataFrame(data)
matrix = df.drop('movieId', axis=1).values

# 2. Squash 20 dimensions into 2 (X, Y)
tsne = TSNE(n_components=2, random_state=42, perplexity=30)
vis_dims = tsne.fit_transform(matrix)

df['x'] = vis_dims[:, 0]
df['y'] = vis_dims[:, 1]

movies = pd.read_csv(DATA_DIR / "movies.csv")
popularity = pd.read_json(OUTPUT_DIR / "popularity.json")
final_map = df[['movieId', 'x', 'y']].merge(movies, on='movieId').merge(
    popularity[['movieId', 'popularity_score', 'niche_score', 'popularity_tier']],
    on='movieId',
    how='left'
)
final_map.to_json(OUTPUT_DIR / "movie_map.json", orient='records')

print("Final Movie Map Created!.")