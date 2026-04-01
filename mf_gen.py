import pandas as pd
import numpy as np
from sklearn.decomposition import TruncatedSVD
from scipy.sparse import csr_matrix
import os

os.makedirs('output', exist_ok=True)

ratings = pd.read_csv('data/ratings.csv').sample(2000000, random_state=42)
movies = pd.read_csv('data/movies.csv')

ratings['user_idx'] = ratings['userId'].astype('category').cat.codes
ratings['movie_idx'] = ratings['movieId'].astype('category').cat.codes

# 3. Create the Sparse Matrix (Users x Movies)
user_item_matrix = csr_matrix((ratings['rating'], (ratings['user_idx'], ratings['movie_idx'])))

# 4. Matrix Factorization (SVD)
svd = TruncatedSVD(n_components=20, random_state=42)
user_factors = svd.fit_transform(user_item_matrix)
item_factors = svd.components_.T 

# 5. Export Item Embeddings for the 2D Map
movie_indices = ratings[['movieId', 'movie_idx']].drop_duplicates().sort_values('movie_idx')
embeddings_df = pd.DataFrame(item_factors)
embeddings_df['movieId'] = movie_indices['movieId'].values
embeddings_df.to_json('output/embeddings.json', orient='records')

# 6. Export Sample Recommendations for User 1
user_pred = np.dot(user_factors[0], item_factors.T)
top_indices = np.argsort(user_pred)[-10:][::-1]
# Map back to real movie IDs
id_map = dict(enumerate(ratings['movieId'].astype('category').cat.categories))
top_movie_ids = [id_map[i] for i in top_indices]

top_10 = pd.DataFrame({'movieId': top_movie_ids, 'pred_score': user_pred[top_indices]})
top_10.merge(movies, on='movieId').to_json('output/mf_sample.json', orient='records')

print("Success! Created embeddings for the 2D map and MF recommendations.")