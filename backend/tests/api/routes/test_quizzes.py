from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import Player, Quiz, QuizResult
from tests.utils.quiz import (
    create_approved_event,
    create_random_event,
    create_random_player,
)


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
    create_random_event(db)  # pending — should not appear
    create_approved_event(db)  # approved — should appear
    response = client.get(f"{settings.API_V1_STR}/quizzes/")
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "approved" for e in data)


def test_superuser_without_status_sees_only_approved(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_event(db)  # pending — should not appear
    create_approved_event(db)  # approved — should appear
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
    create_random_event(db)
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
    quiz = create_random_event(db)
    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert response.status_code == 404


def test_read_approved_quiz_as_public(client: TestClient, db: Session) -> None:
    quiz = create_approved_event(db)
    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(quiz.id)


def test_approve_quiz_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
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
    quiz = create_approved_event(db)
    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"name": "Corrected Name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Corrected Name"


def test_final_rank_computed_on_approval(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_event(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)
    player_c = create_random_player(db)

    for player, score in [
        (player_a, 30.0),
        (player_b, 50.0),
        (player_c, 40.0),
    ]:
        db.add(
            QuizResult(
                quiz_id=quiz.id,
                player_id=player.id,
                score=score,
            )
        )
    db.commit()

    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/approve",
        headers=superuser_token_headers,
    )

    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}/results")
    results = response.json()["data"]
    ranked = {r["player_id"]: r["final_rank"] for r in results}
    assert ranked[str(player_b.id)] == 1
    assert ranked[str(player_c.id)] == 2
    assert ranked[str(player_a.id)] == 3


def test_delete_result_recomputes_ranks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    quiz = create_random_event(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)

    result_a = QuizResult(
        quiz_id=quiz.id, player_id=player_a.id, score=50.0
    )
    result_b = QuizResult(
        quiz_id=quiz.id, player_id=player_b.id, score=40.0
    )
    db.add(result_a)
    db.add(result_b)
    db.commit()
    db.refresh(result_a)

    crud.approve_quiz(session=db, db_event=quiz)

    client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result_a.id}",
        headers=superuser_token_headers,
    )

    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}/results")
    results = response.json()["data"]
    assert len(results) == 1
    assert results[0]["final_rank"] == 1


def test_parse_results(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_player(db)  # ensure at least one player exists
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
    player = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {"player_id": str(player.id), "score": 42.0}
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
    quiz = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_create": {
                        "display_name": "Brand New Player",
                        "country": "US",
                    },
                    "score": 55.0,
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_update_quiz_result_superuser(
    client: TestClient, superuser_token_headers: dict, db: Session
) -> None:
    player = create_random_player(db)
    quiz = create_approved_event(db)
    result = QuizResult(
        quiz_id=quiz.id,
        player_id=player.id,
        score=30.0,
        final_rank=1,
    )
    db.add(result)
    db.commit()
    db.refresh(result)

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
    quiz = create_approved_event(db)
    result = QuizResult(
        quiz_id=quiz.id, player_id=player.id, score=30.0, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.patch(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        json={"score": 55.0},
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_submit_results_mode_defaults_to_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_event(db)
    player = create_random_player(db)
    # Submit without a mode field
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [{"player_id": str(player.id), "score": 10.0}]},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200


def test_submit_results_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_event(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    player3 = create_random_player(db)
    # First submission
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0},
            {"player_id": str(player2.id), "score": 8.0},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Append a third
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"player_id": str(player3.id), "score": 6.0},
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
    quiz = create_approved_event(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    # First submission with two results
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0},
            {"player_id": str(player2.id), "score": 8.0},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Replace with one result
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_submit_results_append_overwrites_existing_player(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_event(db)
    player = create_random_player(db)
    # First submission
    client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [{"player_id": str(player.id), "score": 10.0}], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Append same player with a new score — should overwrite, not error
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": [{"player_id": str(player.id), "score": 20.0}], "mode": "append"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["data"][0]["score"] == 20.0


def test_delete_quiz_result_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_approved_event(db)
    player = create_random_player(db)
    result = QuizResult(
        quiz_id=quiz.id, player_id=player.id, score=20.0, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)
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
    quiz = create_approved_event(db)
    player = create_random_player(db)
    result = QuizResult(
        quiz_id=quiz.id, player_id=player.id, score=20.0, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.delete(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/{result.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_read_rejected_quiz_as_public_returns_404(
    client: TestClient, db: Session
) -> None:
    from tests.utils.quiz import create_rejected_event
    quiz = create_rejected_event(db)
    response = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
    assert response.status_code == 404


def test_superuser_can_filter_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    from tests.utils.quiz import create_rejected_event
    create_rejected_event(db)
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
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
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
    from tests.utils.quiz import create_rejected_event
    quiz = create_rejected_event(db)
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
    quiz = create_approved_event(db)
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
    from tests.utils.quiz import create_rejected_event
    quiz = create_rejected_event(db)
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
    for create_fn in (create_random_event, create_approved_event):
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
    from tests.utils.quiz import create_rejected_event
    quiz = create_rejected_event(db)
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
    from tests.utils.quiz import create_rejected_event
    quiz = create_rejected_event(db)
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
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
    player = create_random_player(db)
    result = QuizResult(quiz_id=quiz.id, player_id=player.id, score=10.0)
    db.add(result)
    db.commit()
    db.refresh(result)
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
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
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
    quiz = create_random_event(db)
    player = create_random_player(db)
    db.add(QuizResult(quiz_id=quiz.id, player_id=player.id, score=10.0))
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
    quiz = create_random_event(db)
    quiz.format_id = fmt.id
    db.add(quiz)
    db.commit()
    player = create_random_player(db)
    results = [{"player_id": str(player.id), "score": 10.0, "round_scores": [5.0, 5.0]}]
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
    quiz = create_random_event(db)
    player = create_random_player(db)
    results = [{"player_id": str(player.id), "score": 10.0, "round_scores": [5.0]}]
    r = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        json={"results": results, "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert r.status_code == 422
