import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"

EXPECTED_FILES = {
    "baseline_top100.json": {"movieId", "title", "genres", "score", "popularity_score", "popularity_percentile", "popularity_tier"},
    "popularity.json": {"movieId", "title", "genres", "rating_count", "avg_rating", "weighted_rating", "popularity_score", "niche_score", "popularity_percentile", "popularity_tier"},
    "title_index.json": {"movieId", "title", "normalized_title", "year", "genres"},
    "movie_map.json": {"movieId", "title", "genres", "x", "y", "popularity_score", "niche_score", "popularity_tier"},
    "mf_neighbors_topk.json": {"movieId", "neighbors"},
    "cf_neighbors_topk.json": {"movieId", "neighbors"},
}


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def assert_unique_movie_ids(name, rows):
    movie_ids = [row["movieId"] for row in rows if "movieId" in row]
    if len(movie_ids) != len(set(movie_ids)):
        raise AssertionError(f"{name} contains duplicate movieId values")


def validate_neighbor_rows(name, rows):
    assert_unique_movie_ids(name, rows)
    for row in rows[:10]:
        if not isinstance(row.get("neighbors"), list):
            raise AssertionError(f"{name} row missing neighbors list")
        for neighbor in row["neighbors"][:5]:
            if "movieId" not in neighbor or "score" not in neighbor:
                raise AssertionError(f"{name} neighbor missing movieId/score")


def main():
    for filename, required_fields in EXPECTED_FILES.items():
        path = OUTPUT_DIR / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing expected file: {filename}")

        rows = load_json(path)
        if not isinstance(rows, list) or not rows:
            raise AssertionError(f"{filename} is empty or not a JSON array")

        missing = required_fields - set(rows[0].keys())
        if missing:
            raise AssertionError(f"{filename} missing required fields: {sorted(missing)}")

        if filename.endswith("neighbors_topk.json"):
            validate_neighbor_rows(filename, rows)
        elif filename in {"baseline_top100.json", "popularity.json", "title_index.json", "movie_map.json"}:
            assert_unique_movie_ids(filename, rows)

    title_index = load_json(OUTPUT_DIR / "title_index.json")
    title_ids = {row["movieId"] for row in title_index}
    popularity = load_json(OUTPUT_DIR / "popularity.json")
    unresolved = [row["movieId"] for row in popularity[:100] if row["movieId"] not in title_ids]
    if unresolved:
        raise AssertionError(f"Found popularity rows missing from title index: {unresolved[:5]}")

    print("All output artifacts validated successfully.")


if __name__ == "__main__":
    main()
