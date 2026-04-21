from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = ROOT / "index.html"


def test_index_html_exists():
    assert INDEX_HTML.exists(), "index.html should exist at repo root"


def test_required_ui_containers_exist():
    html = INDEX_HTML.read_text(encoding="utf-8")

    required_ids = [
        'id="chart"',
        'id="recommendation-list"',
        'id="heatmap"',
        'id="reco-graph"',
        'id="movie-info"',
        'id="comparison-stats"',
        'id="selected-anchors"',
        'id="niche-slider"',
    ]

    for required_id in required_ids:
        assert required_id in html, f"Missing required UI element: {required_id}"


def test_personalization_button_exists():
    html = INDEX_HTML.read_text(encoding="utf-8")
    assert "Build My Personal Map" in html, "Personalization button text should exist"
