import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output"

EXPECTED_FILES = {
    "baseline_top100.json": {
        "movieId",
        "title",
        "genres",
        "score",
        "popularity_score",
        "popularity_percentile",
        "popularity_tier",
    },
    "popularity.json": {
        "movieId",
        "title",
        "genres",
        "rating_count",
        "avg_rating",
        "weighted_rating",
        "popularity_score",
        "niche_score",
        "popularity_percentile",
        "popularity_tier",
    },
    "title_index.json": {
        "movieId",
        "title",
        "normalized_title",
        "year",
        "genres",
    },
    "movie_map.json": {
        "movieId",
        "title",
        "genres",
        "x",
        "y",
        "popularity_score",
        "niche_score",
        "popularity_tier",
    },
    "mf_neighbors_topk.json": {
        "movieId",
        "neighbors",
    },
    "cf_neighbors_topk.json": {
        "movieId",
        "neighbors",
    },
}


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def test_expected_output_files_exist():
    missing = [name for name in EXPECTED_FILES if not (OUTPUT_DIR / name).exists()]
    assert not missing, f"Missing expected output files: {missing}"


def test_output_files_are_non_empty_arrays():
    for filename in EXPECTED_FILES:
        rows = load_json(OUTPUT_DIR / filename)
        assert isinstance(rows, list), f"{filename} should be a JSON array"
        assert len(rows) > 0, f"{filename} should not be empty"


def test_required_fields_present_in_first_row():
    for filename, required_fields in EXPECTED_FILES.items():
        rows = load_json(OUTPUT_DIR / filename)
        first_row_keys = set(rows[0].keys())
        missing = required_fields - first_row_keys
        assert not missing, f"{filename} missing required fields: {sorted(missing)}"


def test_unique_movie_ids_for_catalog_files():
    catalog_files = [
        "baseline_top100.json",
        "popularity.json",
        "title_index.json",
        "movie_map.json",
    ]
    for filename in catalog_files:
        rows = load_json(OUTPUT_DIR / filename)
        movie_ids = [row["movieId"] for row in rows if "movieId" in row]
        assert len(movie_ids) == len(set(movie_ids)), f"{filename} has duplicate movieId values"


def test_neighbor_files_have_valid_structure():
    neighbor_files = ["mf_neighbors_topk.json", "cf_neighbors_topk.json"]
    for filename in neighbor_files:
        rows = load_json(OUTPUT_DIR / filename)

        movie_ids = [row["movieId"] for row in rows if "movieId" in row]
        assert len(movie_ids) == len(set(movie_ids)), f"{filename} has duplicate movieId values"

        for row in rows[:25]:
            assert "neighbors" in row, f"{filename} row missing neighbors"
            assert isinstance(row["neighbors"], list), f"{filename} neighbors should be a list"

            for neighbor in row["neighbors"][:10]:
                assert "movieId" in neighbor, f"{filename} neighbor missing movieId"
                assert "score" in neighbor, f"{filename} neighbor missing score"
                assert isinstance(neighbor["score"], (int, float)), f"{filename} neighbor score must be numeric"


def test_title_index_covers_popularity_movies():
    title_index = load_json(OUTPUT_DIR / "title_index.json")
    popularity = load_json(OUTPUT_DIR / "popularity.json")

    title_ids = {row["movieId"] for row in title_index}
    missing_ids = [row["movieId"] for row in popularity[:100] if row["movieId"] not in title_ids]

    assert not missing_ids, f"Popularity movies missing from title index: {missing_ids[:10]}"
