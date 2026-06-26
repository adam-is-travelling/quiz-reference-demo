import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import Organization, Quiz, QuizSeries
from tests.utils.quiz import create_random_event, create_random_organization, create_random_series


@pytest.fixture(autouse=True)
def clean_series_data(db: Session) -> Generator[None, None, None]:
    pre_series = {r.id for r in db.exec(select(QuizSeries)).all()}
    pre_orgs = {r.id for r in db.exec(select(Organization)).all()}
    yield
    db.expire_all()
    new_series_ids = {r.id for r in db.exec(select(QuizSeries)).all()} - pre_series
    if new_series_ids:
        db.execute(delete(QuizSeries).where(col(QuizSeries.id).in_(new_series_ids)))
    new_org_ids = {r.id for r in db.exec(select(Organization)).all()} - pre_orgs
    if new_org_ids:
        db.execute(delete(Organization).where(col(Organization.id).in_(new_org_ids)))
    db.commit()


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


def test_delete_series_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.delete(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    get_response = client.get(f"{settings.API_V1_STR}/series/{series.id}")
    assert get_response.status_code == 404


def test_delete_series_forbidden_for_organizer(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    response = client.delete(
        f"{settings.API_V1_STR}/series/{series.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_series_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/series/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404


def test_delete_series_nullifies_quiz_series_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    series = create_random_series(db)
    quiz = create_random_event(db)
    quiz.series_id = series.id
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    quiz_id = quiz.id

    try:
        response = client.delete(
            f"{settings.API_V1_STR}/series/{series.id}",
            headers=superuser_token_headers,
        )
        assert response.status_code == 200

        db.expire_all()
        refreshed_quiz = db.get(Quiz, quiz_id)
        assert refreshed_quiz is not None
        assert refreshed_quiz.series_id is None
    finally:
        db.expire_all()
        leftover = db.get(Quiz, quiz_id)
        if leftover:
            db.delete(leftover)
            db.commit()


def test_read_series_includes_organization_name(
    client: TestClient,
    db: Session,
) -> None:
    org = create_random_organization(db)
    series = create_random_series(db, organization_id=org.id)
    response = client.get(f"{settings.API_V1_STR}/series/")
    assert response.status_code == 200
    data = response.json()["data"]
    match = next((s for s in data if s["id"] == str(series.id)), None)
    assert match is not None
    assert match["organization_name"] == org.name


def test_read_series_item_includes_organization_name(
    client: TestClient,
    db: Session,
) -> None:
    org = create_random_organization(db)
    series = create_random_series(db, organization_id=org.id)
    response = client.get(f"{settings.API_V1_STR}/series/{series.id}")
    assert response.status_code == 200
    assert response.json()["organization_name"] == org.name
