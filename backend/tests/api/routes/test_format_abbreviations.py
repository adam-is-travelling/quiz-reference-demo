from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.models import QuizFormat
from tests.utils.quiz import create_random_format

URL = "/api/v1/formats/"


@pytest.fixture(autouse=True)
def clean_formats(db: Session) -> Generator[None, None, None]:
    pre = {f.id for f in db.exec(select(QuizFormat)).all()}
    yield
    db.expire_all()
    new = {f.id for f in db.exec(select(QuizFormat)).all()} - pre
    if new:
        db.execute(delete(QuizFormat).where(col(QuizFormat.id).in_(new)))
        db.commit()


def test_create_with_abbreviations_trims_and_nulls_blanks(
    client: TestClient, superuser_token_headers: dict
) -> None:
    response = client.post(
        URL,
        json={
            "name": "Abbrev Format",
            "rounds": ["Entertainment", "Lifestyle", "Science"],
            "round_abbreviations": [" Ent ", "", None],
        },
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["round_abbreviations"] == ["Ent", None, None]


def test_format_without_abbreviations_returns_empty_list(
    client: TestClient, db: Session
) -> None:
    fmt = create_random_format(db, num_rounds=2)
    response = client.get(f"{URL}{fmt.id}")
    assert response.status_code == 200
    assert response.json()["round_abbreviations"] == []


def test_abbreviation_longer_than_four_characters_is_rejected(
    client: TestClient, superuser_token_headers: dict
) -> None:
    response = client.post(
        URL,
        json={
            "name": "Too Long",
            "rounds": ["Entertainment"],
            "round_abbreviations": ["Enter"],
        },
        headers=superuser_token_headers,
    )
    assert response.status_code == 422


def test_more_abbreviations_than_rounds_is_rejected(
    client: TestClient, superuser_token_headers: dict
) -> None:
    response = client.post(
        URL,
        json={
            "name": "Too Many",
            "rounds": ["History"],
            "round_abbreviations": ["Hist", "Sci"],
        },
        headers=superuser_token_headers,
    )
    assert response.status_code == 422


def test_update_sets_abbreviations(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db, num_rounds=2)
    response = client.patch(
        f"{URL}{fmt.id}",
        json={"round_abbreviations": ["R1", None]},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["round_abbreviations"] == ["R1", None]


def test_update_rejects_more_abbreviations_than_stored_rounds(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db, num_rounds=1)
    response = client.patch(
        f"{URL}{fmt.id}",
        json={"round_abbreviations": ["A", "B"]},
        headers=superuser_token_headers,
    )
    assert response.status_code == 422


def test_shrinking_rounds_drops_orphaned_abbreviations(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    fmt = create_random_format(db, num_rounds=3)
    client.patch(
        f"{URL}{fmt.id}",
        json={"round_abbreviations": ["A", "B", "C"]},
        headers=superuser_token_headers,
    )
    response = client.patch(
        f"{URL}{fmt.id}",
        json={"rounds": ["One", "Two"]},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["round_abbreviations"] == ["A", "B"]
