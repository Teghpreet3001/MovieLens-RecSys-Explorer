MovieLens RecSys Explorer: User Guide


DESCRIPTION

MovieLens-RecSys-Explorer is a small interactive movie recommender demo built on the 
MovieLens dataset. Nothing trains in the browser: a Python pipeline reads raw 
ratings and movie data, precomputes recommendations using two algorithms, and 
stores them as JSON artifacts.

You pick five anchor movies, and the UI blends item–item collaborative filtering 
and matrix factorization (truncated SVD) neighborhoods, lets you steer mainstream 
vs niche with a slider, and shows you a 2D map of the movie latent space.

What you can try in the UI:
  - Enter five anchor titles (autocomplete comes from a precomputed title index).
  - Compare CF vs MF lists, overlap, and a blended view.
  - Use the niche slider to rebalance recommendations toward popular or long-tail 
    titles.
  - Inspect the 2D map (t-SNE on MF embeddings), heatmap, and graph panels.

This project is aimed at a reproducible offline demo (fixed seeds, precomputed 
JSON) rather than a production recommender service.


INSTALLATION

Requirements:
  - Python 3.10+ (3.11 works well) with pip
  - Disk space: the full MovieLens 25M archive is on the order of hundreds of MB 
    compressed and well over 1 GB unpacked; building artifacts needs additional 
    space under output/
  - RAM: loading ratings.csv for the baseline and CF steps is memory-heavy on the 
    full 25M file. If you hit memory limits, use a smaller MovieLens snapshot 
    (for example MovieLens Latest Small)

Step 1: Clone the repository
  git clone https://github.com/Teghpreet3001/MovieLens-RecSys-Explorer.git
  cd MovieLens-RecSys-Explorer

Step 2: Download MovieLens 25M dataset
  The pipeline expects two CSV files at fixed paths:
    - data/ratings.csv
    - data/movies.csv

  1. Open the GroupLens MovieLens dataset page: https://grouplens.org/datasets/movielens/
  2. Download MovieLens 25M (direct link to the zip is typically):
     https://files.grouplens.org/datasets/movielens/ml-25m.zip
  3. Unzip the archive. You should get a folder such as ml-25m/ containing 
     ratings.csv, movies.csv, links.csv, etc.
  4. Copy (or symlink) the two required files into this repo:

     mkdir -p data
     cp /path/to/ml-25m/ratings.csv /path/to/ml-25m/movies.csv data/

  You do not need to commit data/; it is listed in .gitignore so local CSVs stay 
  private and large files stay out of git.

Step 3: Install dependencies (automatic with demo.sh or you can do manually)
  python -m pip install -r requirements.txt

                       
EXECUTION

Quickest way (all-in-one):
  
  From the repository root (the directory that contains index.html and demo.sh):
  
     bash demo.sh
  
  That script installs Python dependencies, rebuilds output/, validates JSON, 
  optionally regenerates figures under eval_results/, then starts a static server. 
  Open: http://localhost:8000 in a browser.
  
  Useful options:
     Different port:              PORT=8080 bash demo.sh
     Skip matplotlib evaluation   SKIP_EVAL=1 bash demo.sh
     plots (faster): 

  Stop the server with Ctrl+C in the terminal.

Manual setup (step-by-step):
  
  python -m pip install -r requirements.txt
  python scripts/build_all.py
  python scripts/validate_outputs.py
  python scripts/generate_eval.py     # generates PNG plots
  python -m http.server 8000          # starts the server
  
  Open: http://localhost:8000 in a browser.

Options:
  - Use different port: PORT=8080 bash demo.sh
  - Skip plot generation: SKIP_EVAL=1 bash demo.sh
  - Stop server: Press Ctrl+C in terminal

Using the UI:
  1. Enter five movie titles (autocomplete allows to search using precomputed index)
  2. Compare recommendations from CF vs MF algorithms
  3. Use the niche slider to balance popular vs long-tail titles
  4. Explore the 2D map, heatmap, and graph panels
  5. View overlap and blended recommendation lists

With output/ already built:

   python -m pip install pytest
   python -m pytest tests -v

Tests assert that expected JSON files exist, are non-empty arrays with the right 
keys, and that index.html still contains key UI hooks.

Troubleshooting common errors:

  - Address already in use: Something else is bound to port 8000. Use 
    PORT=8080 bash demo.sh or stop the other process.
  - Build is slow or uses a lot of RAM: Expected on full ratings.csv. 
    SKIP_EVAL=1 bash demo.sh skips figure generation only; the heavy part is 
    usually MF/CF over large data.
  - Empty map or "Artifact load failure" in the UI: Re-run 
    python scripts/build_all.py, confirm output/*.json exist, and ensure the 
    server root is the repo directory (not scripts/ or output/).

 
DEMO VIDEO

For a visual walkthrough of installation and execution, we have vcreated 
1-minute video demonstrates the full setup process from command line 
execution through running the system and exploring recommendations:

https://youtu.be/jPVb2hn0gF4 
