from urllib.parse import quote

from fastapi.testclient import TestClient

from app.core.config import settings
from app.countries import COUNTRY_NAMES
from app.country_page import COUNTRY_CODE_BY_SLUG, country_slug

API = f"{settings.API_V1_STR}/countries"


def test_every_country_has_a_unique_slug_that_round_trips() -> None:
    assert len(COUNTRY_CODE_BY_SLUG) == len(COUNTRY_NAMES)
    for code in COUNTRY_NAMES:
        assert COUNTRY_CODE_BY_SLUG[country_slug(code)] == code


def test_slugs_follow_the_site_slug_rule() -> None:
    # Pinned byte-for-byte in frontend/tests/countries.test.ts as well.
    assert country_slug("CA") == "canada"
    assert country_slug("AE") == "united-arab-emirates"
    assert country_slug("AX") == "åland-islands"
    assert country_slug("CI") == "côte-divoire"
    assert country_slug("VI") == "us-virgin-islands"
    assert country_slug("CD") == "congo-democratic-republic"


def test_known_slug_returns_the_country(client: TestClient) -> None:
    response = client.get(f"{API}/united-arab-emirates")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"] == "AE"
    assert body["name"] == "United Arab Emirates"
    assert body["slug"] == "united-arab-emirates"
    assert set(body) == {
        "code",
        "name",
        "slug",
        "stats",
        "players",
        "medal_table",
        "national_teams",
        "national_team_medals",
    }
    assert set(body["stats"]) == {
        "quizzer_count",
        "competed_count",
        "quiz_count",
        "medals",
    }
    assert set(body["stats"]["medals"]) == {"gold", "silver", "bronze"}


def test_percent_encoded_non_ascii_slug_resolves(client: TestClient) -> None:
    response = client.get(f"{API}/{quote('åland-islands')}")
    assert response.status_code == 200, response.text
    assert response.json()["code"] == "AX"


def test_unknown_slug_is_404(client: TestClient) -> None:
    response = client.get(f"{API}/atlantis")
    assert response.status_code == 404
    assert response.json()["detail"] == "Country not found"


def test_a_country_code_is_not_a_slug(client: TestClient) -> None:
    assert client.get(f"{API}/ca").status_code == 404
    assert client.get(f"{API}/CA").status_code == 404
