from collections.abc import Generator

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
from tests.utils.utils import random_lower_string


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


def _pairs_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_submit_pair_creates_two_participants(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200

    result = db.exec(
        select(QuizResult).where(QuizResult.quiz_id == quiz.id)
    ).one()
    participants = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [p.slot for p in participants] == [1, 2]
    assert {p.player_id for p in participants} == {alice.id, bob.id}
    assert all(p.quiz_id == quiz.id for p in participants)


def test_submit_solo_row_in_pairs_quiz_is_allowed(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [{"player_id": str(alice.id)}],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    participants = db.exec(
        select(QuizResultPlayer).where(
            QuizResultPlayer.quiz_result_id == result.id
        )
    ).all()
    assert len(participants) == 1


def test_submit_rejects_three_participants(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    players = [create_random_player(db) for _ in range(3)]
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [{"player_id": str(p.id)} for p in players],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "at most 2" in str(response.json()["detail"])


def test_submit_rejects_two_participants_on_individual_quiz(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = create_random_quiz(db)  # participant_mode defaults to individual
    alice, bob = create_random_player(db), create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "individual" in str(response.json()["detail"])


def test_submit_rejects_duplicate_player_in_one_result(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(alice.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "same player" in str(response.json()["detail"])


def test_submit_creates_new_players_for_both_halves(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    name_a, name_b = random_lower_string(), random_lower_string()
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_create": {"display_name": name_a, "countries": ["IE"]}},
                        {"player_create": {"display_name": name_b, "countries": ["GB"]}},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200
    created = db.exec(
        select(Player).where(col(Player.display_name).in_([name_a, name_b]))
    ).all()
    assert len(created) == 2


def test_submit_rejects_same_player_across_different_rows(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    bob = create_random_player(db)
    carol = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                },
                {
                    "final_rank": 2,
                    "score": 40,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(carol.id)},
                    ],
                },
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 422
    assert "player already appears in row 1" in str(response.json()["detail"])
    results = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
    assert results == []


def test_submit_append_rejects_player_with_existing_result(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    # Bob is already a *partner* (non-headline) in an existing result. A new
    # append row that reuses him — even paired with someone new — cannot be
    # reconciled by the headline-based upsert match (the new row's headline
    # is Carol, who has no existing result), so it would try to INSERT a
    # fresh result and collide with Bob's existing participant row.
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    bob = create_random_player(db)
    carol = create_random_player(db)
    first = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert first.status_code == 200

    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 2,
                    "score": 40,
                    "participants": [
                        {"player_id": str(carol.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "append",
        },
    )
    assert response.status_code == 422
    assert "player already has a result in this quiz" in str(response.json()["detail"])


def test_submit_replace_allows_player_with_existing_result(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    # Same overlap as test_submit_append_rejects_player_with_existing_result
    # (Bob already a partner in an earlier result, resubmitted with a new
    # headline), but in replace mode: the prior results — and their
    # cascading participant rows — are cleared before the inserts, so this
    # must succeed. This is the regression guard for the mode distinction.
    quiz = _pairs_quiz(db)
    alice = create_random_player(db)
    bob = create_random_player(db)
    carol = create_random_player(db)
    first = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert first.status_code == 200

    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 2,
                    "score": 40,
                    "participants": [
                        {"player_id": str(carol.id)},
                        {"player_id": str(bob.id)},
                    ],
                }
            ],
            "mode": "replace",
        },
    )
    assert response.status_code == 200
