import pandas as pd
import os
import numpy as np

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

# Blend rating volume + weighted quality into one popularity continuum.
count_signal = np.log1p(stats['count'])
count_norm = (count_signal - count_signal.min()) / (count_signal.max() - count_signal.min())
score_norm = (stats['score'] - stats['score'].min()) / (stats['score'].max() - stats['score'].min())
stats['popularity_score'] = 0.75 * count_norm + 0.25 * score_norm
stats['niche_score'] = 1.0 - stats['popularity_score']
stats['popularity_percentile'] = stats['popularity_score'].rank(pct=True)

def popularity_tier(percentile):
    if percentile >= 0.95:
        return 'Blockbuster'
    if percentile >= 0.80:
        return 'Popular'
    if percentile >= 0.50:
        return 'Recognized'
    if percentile >= 0.20:
        return 'Niche'
    return 'Deep Niche'

stats['popularity_tier'] = stats['popularity_percentile'].apply(popularity_tier)

baseline_top_n = stats.sort_values('popularity_score', ascending=False)
result = baseline_top_n.merge(movies, on='movieId')

result[['movieId', 'title', 'genres', 'score', 'popularity_score', 'popularity_percentile', 'popularity_tier']].head(100).to_json('output/baseline.json', orient='records')

result[
    [
        'movieId',
        'title',
        'genres',
        'count',
        'mean',
        'score',
        'popularity_score',
        'niche_score',
        'popularity_percentile',
        'popularity_tier'
    ]
].rename(
    columns={
        'count': 'rating_count',
        'mean': 'avg_rating',
        'score': 'weighted_rating'
    }
).to_json('output/popularity.json', orient='records')

print("Done! Check output/baseline.json and output/popularity.json")