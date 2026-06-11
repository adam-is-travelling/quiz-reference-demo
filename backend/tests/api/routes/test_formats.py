import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.utils.quiz import create_random_event, create_random_format


def test_list_formats_unauthenticated(client: TestClient, db: Session) -> None:
    create_random_format(db)
    response = client.get("/api/v1/formats/")
    assert response.status_code == 200
    data = response.json()
    assert "data" in data
    assert data["count"] >= 1


def test_get_format_by_id(client: TestClient, db: Session) -> None:
    fmt = create_random_format(db, num_rounds=3)
    response = client.get(f"/api/v1/formats/{fmt.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(fmt.id)
    assert len(response.json()["rounds"]) == 3


def test_get_format_not_found(client: TestClient) -> None:
    response = client.get(f"/api/v1/formats/{uuid.uuid4()}")
    assert response.status_code == 404


def test_create_format_as_superuser(
    client: TestClient, superuser_token_headers: dict
) -> None:
    payload = {"name": "Championship Format", "rounds": ["Round 1", "Round 2", "Final"]}
    response = client.post("/api/v1/formats/", json=payload, headers=superuser_token_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Championship Format"
    assert data["rounds"] == ["Round 1", "Round 2", "Final"]
    assert "id" in data


def test_create_format_unauthenticated(client: TestClient) -> None:
    payload = {"name": "Test", "rounds": ["R1"]}
    response = client.post("/api/v1/formats/", json=payload)
    assert response.status_code == 401


def test_update_format_as_superuser(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db, num_rounds=2)
    response = client.patch(
        f"/api/v1/formats/{fmt.id}",
        json={"name": "Updated Name"},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


def test_delete_format_as_superuser(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db)
    response = client.delete(f"/api/v1/formats/{fmt.id}", headers=superuser_token_headers)
    assert response.status_code == 200


def test_delete_format_blocked_when_in_use(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db)
    event = create_random_event(db)
    # Assign format to event
    event.format_id = fmt.id
    db.add(event)
    db.commit()
    response = client.delete(f"/api/v1/formats/{fmt.id}", headers=superuser_token_headers)
    assert response.status_code == 409
