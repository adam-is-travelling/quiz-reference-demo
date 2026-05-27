from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import EventResult
from tests.utils.quiz import (
    create_approved_event,
    create_random_event,
    create_random_player,
)


def test_read_events_public_sees_only_approved(client: TestClient, db: Session) -> None:
    create_random_event(db)  # pending — should not appear
    create_approved_event(db)  # approved — should appear
    response = client.get(f"{settings.API_V1_STR}/events/")
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
        f"{settings.API_V1_STR}/events/",
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
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        params={"status": "pending"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert all(e["status"] == "pending" for e in data)


def test_create_event_as_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    data = {
        "name": "Irish Quiz Championships 2025",
        "start_date": "2025-03-01",
        "end_date": "2025-03-02",
        "organizer_name": "Quiz Ireland",
        "description": "Annual Irish quiz",
        "format": {"questions": 240, "rounds": 8, "categories": ["Science", "History"]},
    }
    response = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=organizer_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "Irish Quiz Championships 2025"
    assert content["status"] == "pending"
    assert content["format"]["rounds"] == 8


def test_create_event_unauthenticated_forbidden(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/events/",
        json={
            "name": "Ghost Event",
            "start_date": "2025-01-01",
            "end_date": "2025-01-01",
            "organizer_name": "Nobody",
        },
    )
    assert response.status_code == 401


def test_read_pending_event_as_public_returns_404(
    client: TestClient, db: Session
) -> None:
    event = create_random_event(db)
    response = client.get(f"{settings.API_V1_STR}/events/{event.id}")
    assert response.status_code == 404


def test_read_approved_event_as_public(client: TestClient, db: Session) -> None:
    event = create_approved_event(db)
    response = client.get(f"{settings.API_V1_STR}/events/{event.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(event.id)


def test_approve_event_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "approved"


def test_approve_event_as_organizer_forbidden(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_patch_event_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_approved_event(db)
    response = client.patch(
        f"{settings.API_V1_STR}/events/{event.id}",
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
    event = create_random_event(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)
    player_c = create_random_player(db)

    for player, score, tb in [
        (player_a, 30.0, 1),
        (player_b, 50.0, 1),
        (player_c, 50.0, 2),
    ]:
        db.add(
            EventResult(
                event_id=event.id,
                player_id=player.id,
                score=score,
                tiebreaker_rank=tb,
            )
        )
    db.commit()

    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/approve",
        headers=superuser_token_headers,
    )

    response = client.get(f"{settings.API_V1_STR}/events/{event.id}/results")
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
    event = create_random_event(db)
    player_a = create_random_player(db)
    player_b = create_random_player(db)

    result_a = EventResult(
        event_id=event.id, player_id=player_a.id, score=50.0, tiebreaker_rank=1
    )
    result_b = EventResult(
        event_id=event.id, player_id=player_b.id, score=40.0, tiebreaker_rank=1
    )
    db.add(result_a)
    db.add(result_b)
    db.commit()
    db.refresh(result_a)

    crud.approve_event(session=db, db_event=event)

    client.delete(
        f"{settings.API_V1_STR}/events/{event.id}/results/{result_a.id}",
        headers=superuser_token_headers,
    )

    response = client.get(f"{settings.API_V1_STR}/events/{event.id}/results")
    results = response.json()["data"]
    assert len(results) == 1
    assert results[0]["final_rank"] == 1


def test_parse_results(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    create_random_player(db)  # ensure at least one player exists
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results/parse",
        headers=organizer_token_headers,
        json={
            "rows": [
                {
                    "player_name": "Test Player",
                    "country": "Ireland",
                    "score": 42.0,
                    "tiebreaker_rank": 1,
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
    event = create_random_event(db)
    player = create_random_player(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {"player_id": str(player.id), "score": 42.0, "tiebreaker_rank": 1}
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
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_create": {
                        "display_name": "Brand New Player",
                        "country": "USA",
                    },
                    "score": 55.0,
                    "tiebreaker_rank": 1,
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_update_event_result_superuser(
    client: TestClient, superuser_token_headers: dict, db: Session
) -> None:
    player = create_random_player(db)
    event = create_approved_event(db)
    result = EventResult(
        event_id=event.id,
        player_id=player.id,
        score=30.0,
        tiebreaker_rank=1,
        final_rank=1,
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.patch(
        f"{settings.API_V1_STR}/events/{event.id}/results/{result.id}",
        json={"score": 55.0},
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 55.0


def test_update_event_result_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict, db: Session
) -> None:
    player = create_random_player(db)
    event = create_approved_event(db)
    result = EventResult(
        event_id=event.id, player_id=player.id, score=30.0, tiebreaker_rank=1, final_rank=1
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    response = client.patch(
        f"{settings.API_V1_STR}/events/{event.id}/results/{result.id}",
        json={"score": 55.0},
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_submit_results_mode_defaults_to_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player = create_random_player(db)
    # Submit without a mode field
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [{"player_id": str(player.id), "score": 10.0, "tiebreaker_rank": 1}]},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200


def test_submit_results_append(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    player3 = create_random_player(db)
    # First submission
    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0, "tiebreaker_rank": 1},
            {"player_id": str(player2.id), "score": 8.0, "tiebreaker_rank": 1},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Append a third
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player3.id), "score": 6.0, "tiebreaker_rank": 1},
        ], "mode": "append"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_submit_results_replace(
    client: TestClient, organizer_token_headers: dict[str, str], db: Session
) -> None:
    event = create_approved_event(db)
    player1 = create_random_player(db)
    player2 = create_random_player(db)
    # First submission with two results
    client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0, "tiebreaker_rank": 1},
            {"player_id": str(player2.id), "score": 8.0, "tiebreaker_rank": 1},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    # Replace with one result
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        json={"results": [
            {"player_id": str(player1.id), "score": 10.0, "tiebreaker_rank": 1},
        ], "mode": "replace"},
        headers=organizer_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
