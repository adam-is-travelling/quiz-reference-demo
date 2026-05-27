from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.quiz import create_random_organization


def test_read_organizations_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/organizations/")
    assert response.status_code == 200
    content = response.json()
    assert "data" in content
    assert "count" in content


def test_create_organization_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"name": "Test Org", "description": "A test org"}
    response = client.post(
        f"{settings.API_V1_STR}/organizations/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "Test Org"
    assert "id" in content


def test_create_organization_as_organizer_forbidden(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/organizations/",
        headers=organizer_token_headers,
        json={"name": "Should Fail"},
    )
    assert response.status_code == 403


def test_read_organization_by_id(
    client: TestClient, db: Session
) -> None:
    org = create_random_organization(db)
    response = client.get(f"{settings.API_V1_STR}/organizations/{org.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(org.id)


def test_read_organization_not_found(client: TestClient) -> None:
    import uuid
    response = client.get(f"{settings.API_V1_STR}/organizations/{uuid.uuid4()}")
    assert response.status_code == 404


def test_update_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.patch(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=superuser_token_headers,
        json={"name": "Updated Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"
