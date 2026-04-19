# Tests

This folder contains non-invasive tests for the MovieLens recommender 
explorer.

## What these tests cover

- output artifact existence
- output JSON schema checks
- duplicate `movieId` checks
- neighbor structure checks
- basic static frontend container checks

## What these tests do NOT do

- they do not modify production code
- they do not test recommendation quality
- they do not test browser interactions
- they do not retrain models

## How to run

From the repo root:

python -m pytest tests -v
