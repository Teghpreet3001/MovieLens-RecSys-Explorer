In order to run the notebook, first create a conda environment with the yml file provided. Run the following lines in the terminal (assuming you have conda set up):

conda env create -f environment.yml
python -m ipykernel install --user --name movie --display-name "MovieLens Recsys"

The UMAP with MF and user-user CF w/ cosine similarity search is shown on cell 14B. Everything after this cell is for eval stuff we can use for final but irrelevant for the midterm

To make it compatible with the D3 visualization/user inputs, we can also highlight the user's selected movies in the UMAP visualization, in addition to the user's embedding and top 5 recommendations from both MF and CF.

-------------------------------------

Below are some conceptual notes on what algos are being used

Core idea for user-user collaborative filtering
For a target user u:
1. Compute similarity to all other users
2. Select top-K similar users (neighbors)
3. Look at movies those neighbors liked
4. Aggregate their ratings → predict scores

Core idea for Matrix Factorization
- break user-item interaction matrix into latent user-item variables and compare them 
    - User-item interaction matrix
    - User and item matrix
    - Scores = user_vector @ item_vector.T -> dot product
        - Dot product = how aligned two vectors are
        - We return the most “aligned” movies back to a user


UMAP for latent space
- Feed in combined user + item factors (make sure we still have access to this)
- Pass it through UMAP w parameters (dim =2, neighborhood size, etc)
- It will then spit out coordinates for each item and user in the 2-d map 
