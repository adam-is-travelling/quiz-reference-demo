from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import (
    Player,
    Quiz,
    QuizParticipantMode,
    QuizResultCreate,
    ResultParticipantCreate,
)
from tests.utils.quiz import create_approved_quiz, create_published_player


@pytest.fixture(autouse=True)
def clean_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.rollback()
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _pair_win(db: Session) -> tuple[Quiz, Player, Player]:
    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    alice, bob = create_published_player(db), create_published_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                player_id=alice.id,
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=alice.id, country="IE"),
                    ResultParticipantCreate(player_id=bob.id, country="GB"),
                ],
            )
        ],
    )
    return quiz, alice, bob


def test_pairs_win_appears_in_both_histories(client: TestClient, db: Session) -> None:
    quiz, alice, bob = _pair_win(db)
    for player in (alice, bob):
        response = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
        assert response.status_code == 200
        body = response.json()
        assert body["wins"] == 1
        assert body["podiums"] == 1
        assert body["total_quizzes"] == 1
        quiz_ids = [r["quiz_id"] for group in body["data"] for r in group["results"]]
        assert str(quiz.id) in quiz_ids


def test_history_names_the_partner(client: TestClient, db: Session) -> None:
    _quiz, alice, bob = _pair_win(db)
    response = client.get(f"{settings.API_V1_STR}/players/{alice.id}/history")
    result = response.json()["data"][0]["results"][0]
    assert [p["display_name"] for p in result["partners"]] == [bob.display_name]


def test_history_country_comes_from_the_participant_row(
    client: TestClient, db: Session
) -> None:
    _quiz, alice, bob = _pair_win(db)
    alice_result = client.get(
        f"{settings.API_V1_STR}/players/{alice.id}/history"
    ).json()["data"][0]["results"][0]
    bob_result = client.get(f"{settings.API_V1_STR}/players/{bob.id}/history").json()[
        "data"
    ][0]["results"][0]
    assert alice_result["country"] == "IE"
    assert bob_result["country"] == "GB"
