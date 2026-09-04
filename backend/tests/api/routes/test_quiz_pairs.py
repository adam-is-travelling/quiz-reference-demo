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
    QuizStatus,
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


def test_results_with_players_returns_both_members(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _pairs_quiz(db)
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "final_rank": 1,
                    "score": 50,
                    "participants": [
                        {"player_id": str(alice.id), "country": "IE"},
                        {"player_id": str(bob.id), "country": "GB"},
                    ],
                }
            ],
            "mode": "replace",
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players"
    )
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert [p["slot"] for p in row["participants"]] == [1, 2]
    assert [p["player_display_name"] for p in row["participants"]] == [
        alice.display_name,
        bob.display_name,
    ]
    assert [p["country"] for p in row["participants"]] == ["IE", "GB"]


def test_results_with_players_country_falls_back_to_players_own_country(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    # A pairs upload done exactly as the wizard advises leaves country
    # unmapped — both participant rows get country=None. Every display must
    # then fall back to the player's own countries from PlayerCountry
    # (create_random_player defaults every player to "IE").
    quiz = _pairs_quiz(db)
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    client.post(
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

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players"
    )
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert [p["country"] for p in row["participants"]] == ["IE", "IE"]


def test_update_result_replaces_the_second_member(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _pairs_quiz(db)
    alice, bob, carol = (
        create_random_player(db),
        create_random_player(db),
        create_random_player(db),
    )
    client.post(
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
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()

    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={
            "participants": [
                {"player_id": str(alice.id)},
                {"player_id": str(carol.id)},
            ]
        },
    )
    assert response.status_code == 200

    db.expire_all()
    participants = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [p.player_id for p in participants] == [alice.id, carol.id]


def test_update_result_rejects_duplicate_participants(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    quiz = _pairs_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    client.post(
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
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={
            "participants": [
                {"player_id": str(alice.id)},
                {"player_id": str(alice.id)},
            ]
        },
    )
    assert response.status_code == 422


def test_update_result_rejects_participant_held_by_another_result(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    # Bob already holds a result (partnering alice) elsewhere in this quiz.
    # crud.update_quiz_result deletes and re-inserts join rows, so adding
    # him to a different result here would violate
    # UNIQUE (quiz_id, player_id) — this must be a clean 422, not a 500.
    quiz = _pairs_quiz(db)
    alice, bob, carol = (
        create_random_player(db),
        create_random_player(db),
        create_random_player(db),
    )
    client.post(
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
                    "participants": [{"player_id": str(carol.id)}],
                },
            ],
            "mode": "replace",
        },
    )
    carol_result = db.exec(
        select(QuizResult).where(
            QuizResult.quiz_id == quiz.id, QuizResult.final_rank == 2
        )
    ).one()

    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{carol_result.id}",
        headers=superuser_token_headers,
        json={
            "participants": [
                {"player_id": str(carol.id)},
                {"player_id": str(bob.id)},
            ]
        },
    )
    assert response.status_code == 422
    assert "already has a result" in str(response.json()["detail"])

    # And the constraint really was there to violate — the guard isn't
    # rejecting something harmless.
    db.expire_all()
    remaining = db.exec(
        select(QuizResultPlayer).where(
            QuizResultPlayer.quiz_result_id == carol_result.id
        )
    ).all()
    assert [p.player_id for p in remaining] == [carol.id]


def test_update_result_allows_resubmitting_existing_participant(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    # A participant already on THIS result must still be accepted — the
    # guard only rejects a collision with a DIFFERENT result.
    quiz = _pairs_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    client.post(
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
    result = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).one()

    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=superuser_token_headers,
        json={
            "participants": [
                {"player_id": str(alice.id)},
                {"player_id": str(bob.id)},
            ],
            "score": 60,
        },
    )
    assert response.status_code == 200
    assert response.json()["score"] == 60
