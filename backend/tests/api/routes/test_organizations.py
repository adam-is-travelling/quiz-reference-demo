from collections.abc import Generator

import pytest
import uuid
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import Organization, Quiz
from tests.utils.quiz import create_random_organization, create_random_event


@pytest.fixture(autouse=True)
def clean_org_data(db: Session) -> Generator[None, None, None]:
    pre_orgs = {r.id for r in db.exec(select(Organization)).all()}
    yield
    db.expire_all()
    new_org_ids = {r.id for r in db.exec(select(Organization)).all()} - pre_orgs
    if new_org_ids:
        db.execute(delete(Organization).where(col(Organization.id).in_(new_org_ids)))
    db.commit()


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


def test_delete_organization_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    get_response = client.get(f"{settings.API_V1_STR}/organizations/{org.id}")
    assert get_response.status_code == 404


def test_delete_organization_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_organization_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404


def test_delete_organization_nullifies_quiz_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    quiz = create_random_event(db)
    quiz.organization_id = org.id
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    quiz_id = quiz.id

    try:
        response = client.delete(
            f"{settings.API_V1_STR}/organizations/{org.id}",
            headers=superuser_token_headers,
        )
        assert response.status_code == 200

        db.expire_all()
        refreshed_quiz = db.get(Quiz, quiz_id)
        assert refreshed_quiz is not None
        assert refreshed_quiz.organization_id is None
    finally:
        db.expire_all()
        leftover = db.get(Quiz, quiz_id)
        if leftover:
            db.delete(leftover)
            db.commit()
