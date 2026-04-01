import pandas as pd
import os

os.makedirs('output', exist_ok=True)

ratings = pd.read_csv('data/ratings.csv')
movies = pd.read_csv('data/movies.csv')

stats = ratings.groupby('movieId')['rating'].agg(['count', 'mean'])

# C is the mean rating across the whole dataset 
C = stats['mean'].mean()

# m is the minimum votes to be considered 'popular' 
m = stats['count'].quantile(0.9)

# Weighted Rating formula to handle popularity bias]
def weighted_rating(x, m=m, C=C):
    v = x['count']
    R = x['mean']
    return (v/(v+m) * R) + (m/(m+v) * C)

stats['score'] = stats.apply(weighted_rating, axis=1)

baseline_top_n = stats.sort_values('score', ascending=False)
result = baseline_top_n.merge(movies, on='movieId')

result[['movieId', 'title', 'genres', 'score']].head(100).to_json('output/baseline.json', orient='records')

print("Done! Check output/baseline.json")