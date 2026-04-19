# Tests

These are basic tests for the MovieLens recommender repo.

Current checks:
- expected output files exist
- output JSON files are not empty
- required fields exist in generated files
- duplicate movieIds are not present in key outputs
- important frontend containers exist in `index.html`


Run with:

python -m pytest tests -v
