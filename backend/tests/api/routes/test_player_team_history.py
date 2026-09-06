from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import Player, Quiz, QuizParticipantMode, QuizStatus
from tests.utils.quiz import create_published_player, create_random_quiz


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


def _approved_teams_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_every_squad_member_gets_the_result_and_the_win(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _approved_teams_quiz(db)
    # The public /history endpoint 404s for unpublished players (see
    # app/api/routes/players.py), same as the pairs history tests — the
    # squad must be published to exercise the response body at all.
    squad = [create_published_player(db) for _ in range(3)]
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 100,
                    "team_name": "England A",
                    "team_type": "national",
                    "team_country": "GB",
                    "participants": [{"player_id": str(p.id)} for p in squad],
                }
            ],
            "mode": "append",
        },
    )
    assert response.status_code == 200, response.text

    for player in squad:
        history = client.get(
            f"{settings.API_V1_STR}/players/{player.id}/history"
        ).json()
        assert history["total_quizzes"] == 1
        assert history["wins"] == 1
        assert history["podiums"] == 1
        [result] = history["data"][0]["results"]
        assert result["team_name"] == "England A"
        assert result["team_type"] == "national"
        assert result["team_country"] == "GB"
        # A squad is named by its team, not by listing every teammate.
        assert result["partners"] == []


def test_a_team_with_no_squad_credits_nobody_but_still_lists(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _approved_teams_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 100,
                    "team_name": "Rest of the World",
                    "team_type": "national",
                    "team_country": None,
                    "participants": [],
                }
            ],
            "mode": "append",
        },
    )
    assert response.status_code == 200, response.text

    listed = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players"
    ).json()
    assert listed["count"] == 1
    [row] = listed["data"]
    assert row["team_name"] == "Rest of the World"
    assert row["team_country"] is None
    assert row["participants"] == []
