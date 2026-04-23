import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output"
DATA_DIR = ROOT / "data"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ratings = pd.read_csv(DATA_DIR / "ratings.csv")
movies = pd.read_csv(DATA_DIR / "movies.csv")

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

result[['movieId', 'title', 'genres', 'score', 'popularity_score', 'popularity_percentile', 'popularity_tier']].head(100).to_json(OUTPUT_DIR / "baseline_top100.json", orient='records')

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
).to_json(OUTPUT_DIR / "popularity.json", orient='records')

def normalize_title(title):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9\s]', ' ', re.sub(r'\(\d{4}\)', '', str(title).lower()))).strip()

title_index = movies.copy()
title_index['normalized_title'] = title_index['title'].apply(normalize_title)
title_index['year'] = title_index['title'].str.extract(r'\((\d{4})\)', expand=False)
title_index[['movieId', 'title', 'normalized_title', 'year', 'genres']].to_json(
    OUTPUT_DIR / "title_index.json",
    orient='records'
)

print(
    "Done! Check output/baseline_top100.json, output/popularity.json, and output/title_index.json "
    f"(under {OUTPUT_DIR})"
)