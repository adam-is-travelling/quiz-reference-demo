from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import Player, Quiz, QuizResult, QuizResultPlayer
from tests.utils.quiz import (
    create_approved_quiz,
    create_random_player,
    create_random_quiz,
)


@pytest.fixture(autouse=True)
def clean_venue_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _submit(client, headers, quiz_id, results, mode="replace"):
    return client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz_id}/results",
        headers=headers,
        json={"mode": mode, "results": results},
    )


def _row(player, **extra):
    return {
        "participants": [{"player_id": str(player.id)}],
        "final_rank": 1,
        "score": 50.0,
        **extra,
    }


def test_submit_stores_venue_and_reads_it_back(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    b = create_random_player(db)
    response = _submit(
        client,
        superuser_token_headers,
        quiz.id,
        [
            _row(a, venue="  The Crown, Leeds "),
            _row(b, final_rank=2, score=40.0),
        ],
    )
    assert response.status_code == 200
    by_rank = {r["final_rank"]: r for r in response.json()["data"]}
    assert by_rank[1]["venue"] == "The Crown, Leeds"
    assert by_rank[2]["venue"] is None

    read = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players",
        headers=superuser_token_headers,
    )
    by_rank = {r["final_rank"]: r for r in read.json()["data"]}
    assert by_rank[1]["venue"] == "The Crown, Leeds"
    assert by_rank[2]["venue"] is None


def test_whitespace_only_venue_is_stored_as_null(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    response = _submit(client, superuser_token_headers, quiz.id, [_row(a, venue="   ")])
    assert response.status_code == 200
    assert response.json()["data"][0]["venue"] is None


def test_append_resubmit_updates_existing_result_venue(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    _submit(client, superuser_token_headers, quiz.id, [_row(a, venue="Leeds")])
    response = _submit(
        client,
        superuser_token_headers,
        quiz.id,
        [_row(a, venue="Oslo")],
        mode="append",
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["venue"] == "Oslo"


def _seed_result(db: Session, venue: str | None) -> tuple[Quiz, QuizResult]:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, score=30.0, final_rank=1, venue=venue)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()
    return quiz, result


def test_patch_sets_and_clears_venue(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz, result = _seed_result(db, venue=None)
    url = f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}"

    set_resp = client.patch(
        url, json={"venue": " Oslo "}, headers=superuser_token_headers
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["venue"] == "Oslo"

    clear_resp = client.patch(url, json={"venue": ""}, headers=superuser_token_headers)
    assert clear_resp.status_code == 200
    assert clear_resp.json()["venue"] is None


def test_patch_without_venue_keeps_it(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz, result = _seed_result(db, venue="Leeds")
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        json={"score": 55.0},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["venue"] == "Leeds"


def test_venue_longer_than_255_is_rejected(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    response = _submit(
        client, superuser_token_headers, quiz.id, [_row(a, venue="x" * 256)]
    )
    assert response.status_code == 422


def test_append_resubmit_without_venue_keeps_stored_venue(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    # A corrected-scores file with no Venue column must not wipe the venues
    # an earlier upload recorded.
    quiz = create_random_quiz(db)
    a = create_random_player(db)
    _submit(client, superuser_token_headers, quiz.id, [_row(a, venue="Leeds")])
    response = _submit(
        client,
        superuser_token_headers,
        quiz.id,
        [_row(a, score=60.0)],
        mode="append",
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert data[0]["score"] == 60.0
    assert data[0]["venue"] == "Leeds"
