from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.models import (
    Player,
    Quiz,
    QuizParticipantMode,
    QuizResult,
    QuizResultPlayer,
)
from tests.utils.quiz import create_random_player, create_random_quiz


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


def _teams_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def _submit(
    client: TestClient, quiz: Quiz, headers: dict[str, str], rows: list[dict[str, Any]]
) -> Any:
    return client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=headers,
        json={"results": rows, "mode": "append"},
    )


def test_submit_team_with_squad(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    a, b = create_random_player(db), create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(a.id)}, {"player_id": str(b.id)}],
            }
        ],
    )
    assert response.status_code == 200, response.text
    [row] = response.json()["data"]
    assert len(row["participants"]) == 2
    assert row["team_name"] == "England A"
    assert row["team_type"] == "national"
    assert row["team_country"] == "GB"


def test_submit_team_with_no_squad_is_allowed(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "Rest of the World",
                "team_type": "national",
                "team_country": None,
                "participants": [],
            }
        ],
    )
    assert response.status_code == 200, response.text
    [row] = response.json()["data"]
    assert row["participants"] == []
    assert row["team_country"] is None


def test_submit_team_without_a_name_is_rejected(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [{"final_rank": 1, "score": 100, "team_type": "national", "participants": []}],
    )
    assert response.status_code == 422


def test_individual_quiz_rejects_team_fields(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = create_random_quiz(db)
    player = create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "participants": [{"player_id": str(player.id)}],
            }
        ],
    )
    assert response.status_code == 422


def test_teams_quiz_rejects_a_result_with_no_team_name_but_players(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    player = create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "participants": [{"player_id": str(player.id)}],
            }
        ],
    )
    assert response.status_code == 422


def test_player_cannot_turn_out_for_two_teams_in_one_quiz(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _teams_quiz(db)
    player = create_random_player(db)
    response = _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(player.id)}],
            },
            {
                "final_rank": 2,
                "score": 90,
                "team_name": "Scotland",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(player.id)}],
            },
        ],
    )
    assert response.status_code == 422


def test_superuser_adds_a_player_to_an_empty_lineup(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    player = create_random_player(db)
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={"participants": [{"player_id": str(player.id)}]},
    )
    assert response.status_code == 200, response.text
    assert [p["player_id"] for p in response.json()["participants"]] == [str(player.id)]


def test_superuser_removes_the_last_player_from_a_lineup(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    player = create_random_player(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [{"player_id": str(player.id)}],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={"participants": []},
    )
    assert response.status_code == 200, response.text
    assert response.json()["participants"] == []
    assert (
        db.exec(
            select(QuizResultPlayer).where(QuizResultPlayer.quiz_result_id == result.id)
        ).all()
        == []
    )


def test_patch_can_correct_the_team_country(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={"team_country": None},
    )
    assert response.status_code == 200, response.text
    assert response.json()["team_country"] is None
    db.expire_all()
    stored = db.exec(select(QuizResult).where(QuizResult.id == result.id)).one()
    assert stored.team_country is None


def test_patch_rejects_a_team_name_another_result_already_holds(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    """Renaming a team onto another team's name in the same quiz.

    ix_quizresult_quiz_team_name is a partial unique index on
    (quiz_id, lower(team_name)), so without a guard this reaches the
    database and surfaces as a 500 rather than a validation error.
    """
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            },
            {
                "final_rank": 2,
                "score": 90,
                "team_name": "England B",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            },
        ],
    )
    b = db.exec(
        select(QuizResult)
        .where(QuizResult.quiz_id == quiz.id)
        .where(QuizResult.team_name == "England B")
    ).one()

    clash = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{b.id}",
        headers=superuser_token_headers,
        json={"team_name": "england a"},
    )
    assert clash.status_code == 422, clash.text
    assert "team name" in clash.json()["detail"].lower()
    db.expire_all()
    assert db.get(QuizResult, b.id).team_name == "England B"

    # A rename that collides with nothing still goes through, and so does
    # re-sending a result's own name (only other results are checked).
    ok = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{b.id}",
        headers=superuser_token_headers,
        json={"team_name": "England C"},
    )
    assert ok.status_code == 200, ok.text
    same = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{b.id}",
        headers=superuser_token_headers,
        json={"team_name": "England C", "team_type": "club"},
    )
    assert same.status_code == 200, same.text
    assert same.json()["team_type"] == "club"


def test_non_superuser_cannot_edit_a_lineup(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    quiz = _teams_quiz(db)
    _submit(
        client,
        quiz,
        organizer_token_headers,
        [
            {
                "final_rank": 1,
                "score": 100,
                "team_name": "England A",
                "team_type": "national",
                "team_country": "GB",
                "participants": [],
            }
        ],
    )
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=normal_user_token_headers,
        json={"participants": []},
    )
    assert response.status_code == 403
