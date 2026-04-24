MovieLens RecSys Explorer - User Guide

DESCRIPTION
MovieLens RecSys Explorer is an interactive movie recommender system demo built
on the MovieLens-25M dataset. The system combines item-item collaborative 
filtering (CF) and matrix factorization (MF with truncated SVD) to provide
personalized movie recommendations.

Users select five anchor movies and the UI blends recommendations from both CF
and MF algorithms. A niche slider lets you balance between popular mainstream
titles and long-tail niche movies. The system includes an interactive 2D map
visualization of the movie embedding space (t-SNE projection), comparison
panels, heatmaps, and graph analysis tools.

All computation is done offline: a Python pipeline pre-generates JSON artifacts
that the static web frontend consumes. No model training happens in the browser.


INSTALLATION
Requirements:
  - Python 3.10+ (3.11 recommended)
  - ~2+ GB disk space (used for compressed data, unpacked CSVs, artifacts)
  - ~8+ GB RAM for full MovieLens 25M processing

Step 1: Clone the repository
  git clone https://github.com/Teghpreet3001/MovieLens-RecSys-Explorer.git
  cd MovieLens-RecSys-Explorer

Step 2: Download MovieLens 25M dataset
  - Visit: https://grouplens.org/datasets/movielens/
  - Download MovieLens 25M (zip file)
  - Extract the archive (you will get ml-25m/ folder)
  - Copy the required CSVs into the repo in a new data/ folder:
    
    mkdir -p data
    cp /path/to/ml-25m/ratings.csv /path/to/ml-25m/movies.csv data/
  
  Note: The data/ folder is in .gitignore so the local CSVs remain private.

Step 3: Install dependencies (automatic with demo.sh or you can do manually)
  python -m pip install -r requirements.txt

                       
EXECUTION

Quickest way (all-in-one):
  
  From the repository root, run:
    bash demo.sh
  
  This script will:
    1. Install Python dependencies
    2. Build all artifacts (baseline, MF, CF, map)
    3. Validate JSON outputs
    4. Optionally generate matplotlib plots (skip with SKIP_EVAL=1)
    5. Start a local HTTP server on port 8000
  
  Then open: http://localhost:8000 in your browser.

Manual setup (step-by-step):
  
  python -m pip install -r requirements.txt
  python scripts/build_all.py
  python scripts/validate_outputs.py
  python scripts/generate_eval.py     # generates PNG plots
  python -m http.server 8000          # starts the server
  
  Open: http://localhost:8000

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

 
DEMO VIDEO

For a visual walkthrough of installation and execution, we have vcreated 
1-minute video demonstrates the full setup process from command line 
execution through running the system and exploring recommendations:

https://youtu.be/jPVb2hn0gF4 
