import pandas as pd
from sklearn.manifold import TSNE
import json

with open('output/embeddings.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)
matrix = df.drop('movieId', axis=1).values

# 2. Squash 20 dimensions into 2 (X, Y)
tsne = TSNE(n_components=2, random_state=42, perplexity=30)
vis_dims = tsne.fit_transform(matrix)

df['x'] = vis_dims[:, 0]
df['y'] = vis_dims[:, 1]

movies = pd.read_csv('data/movies.csv')
final_map = df[['movieId', 'x', 'y']].merge(movies, on='movieId')
final_map.to_json('output/movie_map.json', orient='records')

print("Final Movie Map Created!.")