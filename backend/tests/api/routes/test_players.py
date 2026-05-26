import uuid
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.models import EventResultCreate
from tests.utils.quiz import create_random_player, create_approved_event
from tests.utils.user import create_organizer_user


def test_list_players_public(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    r = client.get("/api/v1/players/")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert "count" in data
    ids = [p["id"] for p in data["data"]]
    assert str(player.id) in ids


def test_search_players(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    r = client.get("/api/v1/players/search", params={"q": player.display_name})
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    ids = [item["player"]["id"] for item in data["data"]]
    assert str(player.id) in ids


def test_search_players_missing_q(client: TestClient) -> None:
    r = client.get("/api/v1/players/search")
    assert r.status_code == 422


def test_get_player_by_slug(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    assert player.slug is not None
    r = client.get(f"/api/v1/players/by-slug/{player.slug}")
    assert r.status_code == 200
    assert r.json()["id"] == str(player.id)


def test_get_player_by_slug_not_found(client: TestClient) -> None:
    r = client.get("/api/v1/players/by-slug/no-such-slug")
    assert r.status_code == 404


def test_get_player_history(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    event = create_approved_event(db)
    crud.create_event_results(
        session=db,
        event_id=event.id,
        results=[EventResultCreate(player_id=player.id, score=10.0, tiebreaker_rank=1)],
    )
    r = client.get(f"/api/v1/players/{player.id}/history")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert len(data["data"]) == 1
    entry = data["data"][0]
    assert entry["event_id"] == str(event.id)
    assert entry["score"] == 10.0


def test_get_player_history_empty(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    r = client.get(f"/api/v1/players/{player.id}/history")
    assert r.status_code == 200
    assert r.json() == {"data": []}


def test_get_player_by_id(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    r = client.get(f"/api/v1/players/{player.id}")
    assert r.status_code == 200
    assert r.json()["id"] == str(player.id)


def test_get_player_not_found(client: TestClient) -> None:
    r = client.get(f"/api/v1/players/{uuid.uuid4()}")
    assert r.status_code == 404


def test_create_player_organizer(client: TestClient, db: Session) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "Ireland"}
    r = client.post("/api/v1/players/", json=payload, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["display_name"] == "Test Player"
    assert data["slug"] is not None


def test_create_player_requires_organizer(client: TestClient, normal_user_token_headers: dict) -> None:
    payload = {"display_name": "Test Player", "country": "Ireland"}
    r = client.post("/api/v1/players/", json=payload, headers=normal_user_token_headers)
    assert r.status_code == 403


def test_update_player_superuser(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_random_player(db)
    r = client.patch(
        f"/api/v1/players/{player.id}",
        json={"bio": "Updated bio"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["bio"] == "Updated bio"


def test_update_player_requires_superuser(
    client: TestClient, db: Session, normal_user_token_headers: dict
) -> None:
    player = create_random_player(db)
    r = client.patch(
        f"/api/v1/players/{player.id}",
        json={"bio": "Updated bio"},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
