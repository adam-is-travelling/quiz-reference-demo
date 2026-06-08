import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import EventResultCreate, PlayerCreate
from tests.utils.quiz import (
    create_approved_event,
    create_published_player,
    create_random_player,
)
from tests.utils.user import create_organizer_user


def test_list_players_public(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    r = client.get(f"{settings.API_V1_STR}/players/")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert "count" in data
    ids = [p["id"] for p in data["data"]]
    assert str(player.id) in ids


def test_search_players(client: TestClient, db: Session) -> None:
    player = create_random_player(db)
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"q": player.display_name}
    )
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    ids = [item["player"]["id"] for item in data["data"]]
    assert str(player.id) in ids


def test_search_players_missing_q(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/players/search")
    assert r.status_code == 422


def test_get_player_by_slug(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    assert player.slug is not None
    r = client.get(f"{settings.API_V1_STR}/players/by-slug/{player.slug}")
    assert r.status_code == 200
    assert r.json()["id"] == str(player.id)


def test_get_player_by_slug_not_found(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/players/by-slug/no-such-slug")
    assert r.status_code == 404


def test_get_player_history(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    event = create_approved_event(db)
    crud.create_event_results(
        session=db,
        event_id=event.id,
        results=[EventResultCreate(player_id=player.id, score=10.0, tiebreaker_rank=1)],
    )
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert len(data["data"]) == 1
    entry = data["data"][0]
    assert entry["event_id"] == str(event.id)
    assert entry["score"] == 10.0


def test_get_player_history_empty(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert r.status_code == 200
    assert r.json() == {"data": []}


def test_get_player_history_not_found(client: TestClient) -> None:
    import uuid as uuid_module

    r = client.get(f"{settings.API_V1_STR}/players/{uuid_module.uuid4()}/history")
    assert r.status_code == 404


def test_get_player_by_id(client: TestClient, db: Session) -> None:
    player = create_published_player(db)
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}")
    assert r.status_code == 200
    assert r.json()["id"] == str(player.id)


def test_get_player_not_found(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/players/{uuid.uuid4()}")
    assert r.status_code == 404


def test_create_player_organizer(client: TestClient, db: Session) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "IE"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["display_name"] == "Test Player"
    assert data["slug"] is not None


def test_create_player_requires_organizer(
    client: TestClient, normal_user_token_headers: dict
) -> None:
    payload = {"display_name": "Test Player", "country": "IE"}
    r = client.post(
        f"{settings.API_V1_STR}/players/",
        json=payload,
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


def test_create_player_invalid_country_returns_422(
    client: TestClient, db: Session
) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "Narnia"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 422


def test_create_player_null_country_succeeds(client: TestClient, db: Session) -> None:
    # Requires Task 4 migration (country varchar(3) nullable) to pass against a real DB
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": None}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["country"] is None


def test_create_player_eng_country_succeeds(client: TestClient, db: Session) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "ENG"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["country"] == "ENG"


def test_update_player_superuser(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_random_player(db)
    r = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
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
        f"{settings.API_V1_STR}/players/{player.id}",
        json={"bio": "Updated bio"},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


def test_list_players_public_excludes_unpublished(
    client: TestClient, db: Session
) -> None:
    player = create_random_player(db)  # is_published=False by default
    r = client.get(f"{settings.API_V1_STR}/players/")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["data"]]
    assert str(player.id) not in ids


def test_list_players_public_excludes_manually_unpublished(
    client: TestClient, db: Session
) -> None:
    player = create_published_player(db)
    player.is_published = False
    db.add(player)
    db.commit()

    r = client.get(f"{settings.API_V1_STR}/players/")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["data"]]
    assert str(player.id) not in ids


def test_list_players_superuser_does_not_see_unpublished(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_random_player(db)  # is_published=False
    r = client.get(f"{settings.API_V1_STR}/players/", headers=superuser_token_headers)
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["data"]]
    assert str(player.id) not in ids


def test_get_player_by_slug_unpublished_returns_404(
    client: TestClient, db: Session
) -> None:
    player = create_random_player(db)
    assert player.slug is not None
    r = client.get(f"{settings.API_V1_STR}/players/by-slug/{player.slug}")
    assert r.status_code == 404


def test_get_player_by_slug_superuser_sees_unpublished(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_random_player(db)
    assert player.slug is not None
    r = client.get(
        f"{settings.API_V1_STR}/players/by-slug/{player.slug}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == str(player.id)


def test_get_player_by_id_unpublished_returns_404(
    client: TestClient, db: Session
) -> None:
    player = create_random_player(db)
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}")
    assert r.status_code == 404


def test_get_player_by_id_superuser_sees_unpublished(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_random_player(db)
    r = client.get(
        f"{settings.API_V1_STR}/players/{player.id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == str(player.id)


def test_get_player_history_unpublished_returns_404(
    client: TestClient, db: Session
) -> None:
    player = create_random_player(db)
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert r.status_code == 404


def test_get_player_history_superuser_sees_unpublished(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_random_player(db)
    r = client.get(
        f"{settings.API_V1_STR}/players/{player.id}/history",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200


def test_search_players_finds_unpublished(client: TestClient, db: Session) -> None:
    player = create_random_player(db)  # is_published=False — search is unrestricted
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"q": player.display_name}
    )
    assert r.status_code == 200
    ids = [item["player"]["id"] for item in r.json()["data"]]
    assert str(player.id) in ids


def test_search_players_normalizes_diacritics(client: TestClient, db: Session) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Lucian Sosic", country="HR"),
    )
    r = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": "Lucian Šošić"},
    )
    assert r.status_code == 200
    ids = [item["player"]["id"] for item in r.json()["data"]]
    assert str(player.id) in ids
    match = next(
        item for item in r.json()["data"] if item["player"]["id"] == str(player.id)
    )
    assert match["similarity"] >= 0.9
