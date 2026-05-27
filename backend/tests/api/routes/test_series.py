import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.quiz import create_random_organization, create_random_series


def test_read_series_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/series/")
    assert response.status_code == 200
    content = response.json()
    assert "data" in content
    assert "count" in content


def test_create_series_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"name": "World Quizzing Championships"}
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "World Quizzing Championships"
    assert content["organization_id"] is None


def test_create_series_with_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=superuser_token_headers,
        json={"name": "IQA League", "organization_id": str(org.id)},
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(org.id)


def test_create_series_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/series/",
        headers=organizer_token_headers,
        json={"name": "Should Fail"},
    )
    assert response.status_code == 403


def test_read_series_by_id(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    response = client.get(f"{settings.API_V1_STR}/series/{series.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(series.id)


def test_read_series_not_found(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/series/{uuid.uuid4()}")
    assert response.status_code == 404


def test_update_series(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.patch(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
        json={"name": "Updated Series"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Series"
