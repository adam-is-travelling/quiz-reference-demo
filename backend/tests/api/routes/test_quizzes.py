from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import Player, Quiz, QuizResult, QuizResultPlayer, QuizStatus
from tests.utils.quiz import (
    create_approved_quiz,
    create_random_format,
    create_random_organization,
    create_random_player,
    create_random_quiz,
)
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string


@pytest.fixture(autouse=True)
def clean_quizzes_data(db: Session) -> Generator[None, None, None]:
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


def test_read_quizzes_public_sees_only_approved(client: TestClient, db: Session) -> None:
    create_random_quiz(db)  # pending — should not appear
    create_approved_quiz(db)  # approved — should appear
    response = client.get(f"{settings.API_V1_STR}/quizzes/")
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "approved" for e in data)


def _approved_quiz_named(db: Session, name: str) -> Quiz:
    from app.models import QuizCreate

    user = create_random_user(db)
    quiz = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=name, start_date=date(2024, 1, 1), end_date=date(2024, 1, 1)
        ),
        submitted_by_id=user.id,
    )
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_read_quizzes_filters_by_name_query(client: TestClient, db: Session) -> None:
    token = random_lower_string()[:8]
    match = _approved_quiz_named(db, f"Regional Heat {token}")
    other = _approved_quiz_named(db, f"Grand Final {token}")

    r = client.get(
        f"{settings.API_V1_STR}/quizzes/", params={"q": f"Regional Heat {token}"}
    )
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["data"]}
    assert str(match.id) in ids
    assert str(other.id) not in ids


def test_read_quizzes_name_query_is_case_insensitive_and_partial(
    client: TestClient, db: Session
) -> None:
    token = random_lower_string()[:8]
    match = _approved_quiz_named(db, f"Regional Heat {token}")

    r = client.get(
        f"{settings.API_V1_STR}/quizzes/", params={"q": f"rEgIoNaL hEaT {token}"}
    )
    assert r.status_code == 200
    assert str(match.id) in {row["id"] for row in r.json()["data"]}


def test_read_quizzes_name_query_still_hides_unapproved(
    client: TestClient, db: Session
) -> None:
    from app.models import QuizCreate

    token = random_lower_string()[:8]
    user = create_random_user(db)
    pending = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=f"Pending Regional {token}",
            start_date=date(2024, 1, 1),
            end_date=date(2024, 1, 1),
        ),
        submitted_by_id=user.id,
    )

    r = client.get(
        f"{settings.API_V1_STR}/quizzes/", params={"q": f"Pending Regional {token}"}
    )
    assert r.status_code == 200
    assert str(pending.id) not in {row["id"] for row in r.json()["data"]}


def test_superuser_without_status_sees_only_approved(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_quiz(db)  # pending — should not appear
    create_approved_quiz(db)  # approved — should appear
    response = client.get(
        f"{settings.API_V1_STR}/quizzes/",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "approved" for e in data)


def test_superuser_can_filter_pending(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_quiz(db)
    response = client.get(
        f"{settings.API_V1_STR}/quizzes/",
        headers=superuser_token_headers,
        params={"status": "pending"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "pending" for e in data)


def test_create_quiz_as_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    data = {
        "name": "Irish Quiz Championships 2025",
        "start_date": "2025-03-01",
        "end_date": "2025-03-02",
        "organizer_name": "Quiz Ireland",
        "description": "Annual Irish quiz",
    }
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "Irish Quiz Championships 2025"
    assert content["status"] == "pending"


def test_create_quiz_unauthenticated_forbidden(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        json={
            "name": "Ghost Quiz",
            "start_date": "2025-01-01",
            "end_date": "2025-01-01",
            "organizer_name": "Nobody",
        },
    )
    assert response.status_code == 401


def test_read_pending_quiz_as_public_returns_404(
    client: TestClient, db: Session
) -> None:
    quiz = create_random_quiz(db)
    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert response.status_code == 404


def test_read_approved_quiz_as_public(client: TestClient, db: Session) -> None:
    quiz = create_approved_quiz(db)
    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(quiz.id)


def test_approve_quiz_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/approve",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "approved"


def test_approve_quiz_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/approve",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_patch_quiz_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_approved_quiz(db)
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"name": "Corrected Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Corrected Name"


def test_final_rank_set_on_ingestion(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)
    player_c = create_random_player(db)

    # Ranks are explicit — same score order but rank mirrors the supplied values.
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
        json={
            "mode": "replace",
            "results": [
                {"participants": [{"player_id": str(player_b.id)}], "final_rank": 1, "score": 50.0},
                {"participants": [{"player_id": str(player_c.id)}], "final_rank": 2, "score": 40.0},
                {"participants": [{"player_id": str(player_a.id)}], "final_rank": 3, "score": 30.0},
            ],
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players",
        headers=superuser_token_headers,
    )
    results = response.json()["data"]
    ranked = {r["participants"][0]["player_id"]: r["final_rank"] for r in results}
    assert ranked[str(player_b.id)] == 1
    assert ranked[str(player_c.id)] == 2
    assert ranked[str(player_a.id)] == 3


def test_delete_result_preserves_remaining_ranks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)

    # Ingest: A=rank1, B=rank2
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
        json={
            "mode": "replace",
            "results": [
                {"participants": [{"player_id": str(player_a.id)}], "final_rank": 1, "score": 50.0},
                {"participants": [{"player_id": str(player_b.id)}], "final_rank": 2, "score": 40.0},
            ],
        },
    )
    with_players = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players",
        headers=superuser_token_headers,
    )
    result_a_id = next(
        r["id"]
        for r in with_players.json()["data"]
        if r["participants"][0]["player_id"] == str(player_a.id)
    )

    client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result_a_id}",
        headers=superuser_token_headers,
    )

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
    )
    results = response.json()["data"]
    assert len(results) == 1
    # B retains its ingested rank of 2, not shifted to 1
    assert results[0]["final_rank"] == 2


def test_submit_results_with_tied_ranks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    players = [create_random_player(db) for _ in range(4)]

    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
        json={
            "mode": "replace",
            "results": [
                {"participants": [{"player_id": str(players[0].id)}], "final_rank": 1, "score": 50.0},
                {"participants": [{"player_id": str(players[1].id)}], "final_rank": 2, "score": 40.0},
                {"participants": [{"player_id": str(players[2].id)}], "final_rank": 2, "score": 38.0},
                {"participants": [{"player_id": str(players[3].id)}], "final_rank": 4, "score": 30.0},
            ],
        },
    )

    response = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    stored_ranks = sorted(r["final_rank"] for r in response.json()["data"])
    assert stored_ranks == [1, 2, 2, 4]


def test_parse_results(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_player(db)  # ensure at least one player exists
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/parse",
        headers=organizer_token_headers,
        json={
            "rows": [
                {
                    "player_name": "Test Player",
                    "country": "Ireland",
                    "score": 42.0,
                }
            ]
        },
    )
    assert response.status_code == 200
    content = response.json()
    assert len(content["results"]) == 1
    assert "candidates" in content["results"][0]


def test_submit_results_with_existing_player(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    player = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {"participants": [{"player_id": str(player.id)}], "final_rank": 1, "score": 42.0}
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_submit_results_creates_new_player(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "participants": [
                        {
                            "player_create": {
                                "display_name": "Brand New Player",
                                "country": "US",
                            },
                        }
                    ],
                    "final_rank": 1,
                    "score": 55.0,
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_submit_results_rejects_batch_without_partial_writes(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "participants": [
                        {
                            "player_create": {
                                "display_name": "Valid Row Player",
                                "country": "US",
                            },
                        }
                    ],
                    "final_rank": 1,
                    "score": 50.0,
                },
                {
                    "participants": [
                        {
                            "player_create": {
                                "display_name": "Invalid Row Player",
                                "country": "US",
                            },
                        }
                    ],
                    "final_rank": 2,
                    "score": None,
                },
            ]
        },
    )
    assert response.status_code == 422

    orphan = db.exec(
        select(Player).where(Player.display_name == "Valid Row Player")
    ).first()
    assert orphan is None


def test_submit_results_rejects_round_scores_without_partial_writes(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    fmt = create_random_format(db, num_rounds=2)
    quiz = create_random_quiz(db)
    quiz.format_id = fmt.id
    db.add(quiz)
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "participants": [
                        {
                            "player_create": {
                                "display_name": "First Valid Player",
                                "country": "US",
                            },
                        }
                    ],
                    "final_rank": 1,
                    "score": 50.0,
                    "round_scores": [25.0, 25.0],
                },
                {
                    "participants": [
                        {
                            "player_create": {
                                "display_name": "Too Many Rounds Player",
                                "country": "US",
                            },
                        }
                    ],
                    "final_rank": 2,
                    "score": 40.0,
                    "round_scores": [10.0, 10.0, 20.0],
                },
            ]
        },
    )
    assert response.status_code == 422

    orphan = db.exec(
        select(Player).where(Player.display_name == "First Valid Player")
    ).first()
    assert orphan is None


def test_update_quiz_result_superuser(
    client: TestClient, superuser_token_headers: dict, db: Session
) -> None:
    player = create_random_player(db)
    quiz = create_approved_quiz(db)
    result = QuizResult(
        quiz_id=quiz.id,
        score=30.0,
        final_rank=1,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        json={"score": 55.0},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 55.0


def test_update_quiz_result_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict, db: Session
) -> None:
    player = create_random_player(db)
    quiz = create_approved_quiz(db)
    result = QuizResult(quiz_id=quiz.id, score=30.0, final_rank=1)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        json={"score": 55.0},
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_submit_results_mode_defaults_to_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    # Submit without a mode field
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [{"participants": [{"player_id": str(player.id)}], "final_rank": 1, "score": 10.0}]},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200


def test_submit_results_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_quiz(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    player3 = create_random_player(db)
    # First submission
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"participants": [{"player_id": str(player1.id)}], "final_rank": 1, "score": 10.0},
            {"participants": [{"player_id": str(player2.id)}], "final_rank": 2, "score": 8.0},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Append a third with an explicit rank
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"participants": [{"player_id": str(player3.id)}], "final_rank": 3, "score": 6.0},
        ], "mode": "append"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 3
    ranks = {r["final_rank"] for r in response.json()["data"]}
    assert ranks == {1, 2, 3}


def test_submit_results_replace(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_quiz(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    # First submission with two results
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"participants": [{"player_id": str(player1.id)}], "final_rank": 1, "score": 10.0},
            {"participants": [{"player_id": str(player2.id)}], "final_rank": 2, "score": 8.0},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Replace with one result
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"participants": [{"player_id": str(player1.id)}], "final_rank": 1, "score": 10.0},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_submit_results_append_overwrites_existing_player(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    # First submission
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [{"participants": [{"player_id": str(player.id)}], "final_rank": 1, "score": 10.0}], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Append same player with a new score — should overwrite, not error
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [{"participants": [{"player_id": str(player.id)}], "final_rank": 1, "score": 20.0}], "mode": "append"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["data"][0]["score"] == 20.0


def test_delete_quiz_result_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, score=20.0, final_rank=1)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()
    result_id = result.id

    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result_id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.get(QuizResult, result_id) is None


def test_delete_quiz_result_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, score=20.0, final_rank=1)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()

    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_read_rejected_quiz_as_public_returns_404(
    client: TestClient, db: Session
) -> None:
    from tests.utils.quiz import create_rejected_quiz
    quiz = create_rejected_quiz(db)
    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert response.status_code == 404


def test_superuser_can_filter_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_quiz
    create_rejected_quiz(db)
    response = client.get(
        f"{settings.API_V1_STR}/quizzes/",
        headers=superuser_token_headers,
        params={"status": "rejected"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "rejected" for e in data)


def test_reject_quiz_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/reject",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"


def test_reject_quiz_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/reject",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_reject_quiz_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/reject",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403


def test_reject_already_rejected_quiz(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_quiz
    quiz = create_rejected_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/reject",
        headers=superuser_token_headers,
    )
    assert response.status_code == 400


def test_reject_approved_quiz_forbidden(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_approved_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/reject",
        headers=superuser_token_headers,
    )
    assert response.status_code == 400


def test_set_pending_from_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_quiz
    quiz = create_rejected_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/set-pending",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


def test_set_pending_from_non_rejected_returns_400(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    # Both pending and approved quizzes should return 400
    for create_fn in (create_random_quiz, create_approved_quiz):
        quiz = create_fn(db)
        response = client.post(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}/set-pending",
            headers=superuser_token_headers,
        )
        assert response.status_code == 400


def test_set_pending_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_quiz
    quiz = create_rejected_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/set-pending",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_set_pending_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_quiz
    quiz = create_rejected_quiz(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/set-pending",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403


def test_delete_quiz_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    quiz_id = quiz.id
    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz_id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.get(Quiz, quiz_id) is None


def test_delete_quiz_cascades_results(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, score=10.0)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()
    result_id = result.id

    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200

    db.expire_all()
    assert db.get(QuizResult, result_id) is None


def test_delete_quiz_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_quiz_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403


def test_approve_quiz_publishes_players(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_quiz(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, score=10.0)
    db.add(result)
    db.commit()
    db.refresh(result)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=player.id
        )
    )
    db.commit()
    db.refresh(player)
    assert not player.is_published

    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/approve",
        headers=superuser_token_headers,
    )

    db.refresh(player)
    assert player.is_published


def test_quiz_returns_nested_format(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    from tests.utils.quiz import create_random_format
    fmt = create_random_format(db, num_rounds=3)
    quiz_data = {
        "name": "Format Test Quiz",
        "start_date": "2025-01-01",
        "end_date": "2025-01-01",
        "format_id": str(fmt.id),
    }
    r = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        json=quiz_data,
        headers=organizer_token_headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["format_id"] == str(fmt.id)
    assert data["format"] is not None
    assert len(data["format"]["rounds"]) == 3


def test_submit_and_retrieve_round_scores(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    from tests.utils.quiz import create_random_format
    fmt = create_random_format(db, num_rounds=2)
    quiz = create_random_quiz(db)
    quiz.format_id = fmt.id
    db.add(quiz)
    db.commit()
    player = create_random_player(db)
    results = [{"participants": [{"player_id": str(player.id)}], "final_rank": 1, "score": 10.0, "round_scores": [5.0, 5.0]}]
    r = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": results, "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert r.status_code == 200
    # Retrieve results with round scores
    r2 = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players",
        headers=superuser_token_headers,
    )
    assert r2.status_code == 200
    result_data = r2.json()["data"][0]
    assert result_data["round_scores"] == [5.0, 5.0]


def test_round_scores_rejected_without_format(
    client: TestClient,
    db: Session,
    organizer_token_headers: dict[str, str],
) -> None:
    quiz = create_random_quiz(db)
    player = create_random_player(db)
    results = [{"participants": [{"player_id": str(player.id)}], "final_rank": 1, "score": 10.0, "round_scores": [5.0]}]
    r = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": results, "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert r.status_code == 422


def test_submit_results_persists_country(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    from app.models import PlayerCreate

    quiz = create_approved_quiz(db)
    player = crud.create_player(
        session=db, player_in=PlayerCreate(display_name="Country Rep", countries=["GB"])
    )
    r = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=superuser_token_headers,
        json={
            "results": [
                {
                    "participants": [
                        {"player_id": str(player.id), "country": "SCO"}
                    ],
                    "final_rank": 1,
                    "score": 42.0,
                }
            ],
            "mode": "replace",
        },
    )
    assert r.status_code == 200

    wp = client.get(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players",
        headers=superuser_token_headers,
    )
    assert wp.status_code == 200
    rows = wp.json()["data"]
    assert rows[0]["participants"][0]["country"] == "SCO"


def test_create_quiz_with_event_id(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    event = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json={
            "name": "Attach Target",
            "start_date": "2026-06-12",
            "end_date": "2026-06-14",
            "is_online": True,
            "organization_id": str(org.id),
        },
    ).json()
    quiz = create_approved_quiz(db)
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=superuser_token_headers,
            json={"event_id": event["id"]},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["event_id"] == event["id"]
        assert body["event_name"] == "Attach Target"
        assert body["event_slug"] == event["slug"]
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{event['id']}",
            headers=superuser_token_headers,
        )


def test_quiz_can_attach_to_event_owned_by_another_organizer(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    quiz_org = create_random_organization(db)
    event_org = create_random_organization(db)
    event = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json={
            "name": "Cross Organizer Target",
            "start_date": "2026-06-12",
            "end_date": "2026-06-14",
            "is_online": True,
            "organization_id": str(event_org.id),
        },
    ).json()
    quiz = create_approved_quiz(db)
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=superuser_token_headers,
            json={
                "organization_id": str(quiz_org.id),
                "event_id": event["id"],
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["organization_id"] == str(quiz_org.id)
        assert body["event_id"] == event["id"]

        # The event counts and lists the quiz even though the organizers differ.
        detail = client.get(f"{settings.API_V1_STR}/events/{event['id']}").json()
        assert detail["organization_id"] == str(event_org.id)
        assert detail["quiz_count"] == 1
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{event['id']}",
            headers=superuser_token_headers,
        )


def test_attaching_quiz_to_event_requires_superuser(
    client: TestClient,
    superuser_token_headers,
    organizer_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    event = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json={
            "name": "Superuser Only Target",
            "start_date": "2026-06-12",
            "end_date": "2026-06-14",
            "is_online": True,
            "organization_id": str(org.id),
        },
    ).json()
    quiz = create_approved_quiz(db)
    try:
        # The event page exposes attach-to-event to superusers only; the API
        # has to hold that line for anyone calling it directly.
        for headers in (organizer_token_headers, normal_user_token_headers):
            r = client.patch(
                f"{settings.API_V1_STR}/quizzes/{quiz.id}",
                headers=headers,
                json={"event_id": event["id"]},
            )
            assert r.status_code == 403

        r = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
        assert r.json()["event_id"] is None

        # ...and the superuser still can.
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=superuser_token_headers,
            json={"event_id": event["id"]},
        )
        assert r.status_code == 200
        assert r.json()["event_id"] == event["id"]
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{event['id']}",
            headers=superuser_token_headers,
        )


def test_quiz_can_be_removed_from_an_event(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    event = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json={
            "name": "Detach Source",
            "start_date": "2026-06-12",
            "end_date": "2026-06-14",
            "is_online": True,
            "organization_id": str(org.id),
        },
    ).json()
    quiz = create_approved_quiz(db)
    try:
        client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=superuser_token_headers,
            json={"event_id": event["id"]},
        )
        detail = client.get(f"{settings.API_V1_STR}/events/{event['id']}").json()
        assert detail["quiz_count"] == 1

        # Removal is an explicit null, which QuizUpdate must carry through
        # crud.update_quiz's exclude_unset dump — otherwise it reads as
        # "field omitted" and the quiz stays silently attached.
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=superuser_token_headers,
            json={"event_id": None},
        )
        assert r.status_code == 200
        assert r.json()["event_id"] is None
        assert r.json()["event_name"] is None

        detail = client.get(f"{settings.API_V1_STR}/events/{event['id']}").json()
        assert detail["quiz_count"] == 0

        # The quiz itself survives — removal detaches, it does not delete.
        assert client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}").status_code == 200
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{event['id']}",
            headers=superuser_token_headers,
        )


def test_removing_quiz_from_event_requires_superuser(
    client: TestClient,
    superuser_token_headers,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    event = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json={
            "name": "Detach Guarded",
            "start_date": "2026-06-12",
            "end_date": "2026-06-14",
            "is_online": True,
            "organization_id": str(org.id),
        },
    ).json()
    quiz = create_approved_quiz(db)
    try:
        client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=superuser_token_headers,
            json={"event_id": event["id"]},
        )
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}",
            headers=organizer_token_headers,
            json={"event_id": None},
        )
        assert r.status_code == 403
        assert (
            client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}").json()["event_id"]
            == event["id"]
        )
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{event['id']}",
            headers=superuser_token_headers,
        )


def test_update_quiz_with_unknown_event_id_is_404(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    quiz = create_approved_quiz(db)
    r = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"event_id": "11111111-1111-1111-1111-111111111111"},
    )
    assert r.status_code == 404


def test_deleting_event_nulls_quiz_event_id(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    event = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json={
            "name": "Doomed Event",
            "start_date": "2026-06-12",
            "end_date": "2026-06-14",
            "is_online": True,
            "organization_id": str(org.id),
        },
    ).json()
    quiz = create_approved_quiz(db)
    client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"event_id": event["id"]},
    )

    client.delete(
        f"{settings.API_V1_STR}/events/{event['id']}", headers=superuser_token_headers
    )

    r = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert r.status_code == 200
    assert r.json()["event_id"] is None


def test_create_quiz_defaults_to_individual(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json={
            "name": random_lower_string(),
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
        },
    )
    assert response.status_code == 200
    assert response.json()["participant_mode"] == "individual"


def test_create_quiz_accepts_pairs(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json={
            "name": random_lower_string(),
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
            "participant_mode": "pairs",
        },
    )
    assert response.status_code == 200
    assert response.json()["participant_mode"] == "pairs"


def test_create_quiz_rejects_unknown_participant_mode(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/",
        headers=organizer_token_headers,
        json={
            "name": random_lower_string(),
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
            "participant_mode": "trios",
        },
    )
    assert response.status_code == 422
