import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import Player, PlayerCreate, Quiz, QuizResult, QuizResultCreate
from tests.utils.quiz import (
    create_approved_event,
    create_published_player,
    create_random_player,
)
from tests.utils.user import create_organizer_user


@pytest.fixture(scope="module", autouse=True)
def clear_accumulated_data(db: Session) -> Generator[None, None, None]:
    db.execute(delete(Quiz))
    db.execute(delete(Player))
    db.commit()
    yield


@pytest.fixture(autouse=True)
def clean_player_data(db: Session) -> Generator[None, None, None]:
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    yield
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


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
    player = create_published_player(db)
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"q": player.display_name}
    )
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    ids = [item["player"]["id"] for item in data["data"]]
    assert str(player.id) in ids


def test_search_players_no_params_returns_empty(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/players/search")
    assert r.status_code == 200
    assert r.json()["data"] == []


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
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=10.0)],
    )
    r = client.get(f"{settings.API_V1_STR}/players/{player.id}/history")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert len(data["data"]) == 1
    entry = data["data"][0]
    assert entry["quiz_id"] == str(event.id)
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
    payload = {"display_name": "Test Player", "countries": ["Narnia"]}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 422


def test_create_player_null_country_succeeds(client: TestClient, db: Session) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "countries": []}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["countries"] == []


def test_create_player_eng_country_succeeds(client: TestClient, db: Session) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "countries": ["ENG"]}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["countries"] == ["ENG"]


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


def test_search_players_excludes_unpublished_for_anonymous(client: TestClient, db: Session) -> None:
    player = create_random_player(db)  # is_published=False by default
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"q": player.display_name}
    )
    assert r.status_code == 200
    ids = [item["player"]["id"] for item in r.json()["data"]]
    assert str(player.id) not in ids


def test_search_players_excludes_unpublished_for_regular_user(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    player = create_random_player(db)  # is_published=False by default
    r = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": player.display_name},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 200
    ids = [item["player"]["id"] for item in r.json()["data"]]
    assert str(player.id) not in ids


def test_search_players_includes_unpublished_for_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    player = create_random_player(db)  # is_published=False by default
    r = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": player.display_name},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    ids = [item["player"]["id"] for item in r.json()["data"]]
    assert str(player.id) in ids


def test_search_players_normalizes_diacritics(client: TestClient, db: Session) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Lucian Sosic", country="HR"),
    )
    player.is_published = True
    db.add(player)
    db.commit()
    db.refresh(player)
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


def test_delete_player_with_no_results_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    player = create_random_player(db)
    player_id = player.id
    response = client.delete(
        f"{settings.API_V1_STR}/players/{player_id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.get(Player, player_id) is None


def test_delete_player_with_results_returns_400(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    player = create_random_player(db)
    event = create_approved_event(db)
    db.add(QuizResult(quiz_id=event.id, player_id=player.id, score=10.0))
    db.commit()
    response = client.delete(
        f"{settings.API_V1_STR}/players/{player.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 400


def test_delete_player_as_organizer_forbidden(
    client: TestClient,
    db: Session,
) -> None:
    headers = create_organizer_user(client=client, db=db)
    player = create_random_player(db)
    response = client.delete(
        f"{settings.API_V1_STR}/players/{player.id}",
        headers=headers,
    )
    assert response.status_code == 403


def test_delete_player_as_regular_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    player = create_random_player(db)
    response = client.delete(
        f"{settings.API_V1_STR}/players/{player.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403


def test_search_players_filters_by_country_membership(db: Session) -> None:
    from app.models import PlayerCreate

    match = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Zoltan Countrymatch", countries=["IE", "GB"]),
    )
    match.is_published = True
    db.add(match)
    other = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Zoltan Countrymatch", countries=["FR"]),
    )
    other.is_published = True
    db.add(other)
    db.commit()

    results = crud.search_players(session=db, q="Zoltan Countrymatch", country="GB")
    ids = {p.id for p, _ in results}
    assert match.id in ids
    assert other.id not in ids


def test_create_quiz_results_stores_country(db: Session) -> None:
    from app.models import PlayerCreate, QuizResultCreate

    event = create_approved_event(db)
    player = crud.create_player(
        session=db, player_in=PlayerCreate(display_name="Flag Bearer", countries=["ENG"])
    )
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[
            QuizResultCreate(player_id=player.id, final_rank=1, score=50.0, country="ENG")
        ],
    )
    stored = db.exec(
        select(QuizResult).where(QuizResult.quiz_id == event.id)
    ).first()
    assert stored is not None
    assert stored.country == "ENG"


def test_search_by_country_partial_name_only(client: TestClient, db: Session) -> None:
    from app.models import PlayerCreate

    ie = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Aoife Irishplayer", countries=["IE"]),
    )
    ie.is_published = True
    fr = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Marie Frenchplayer", countries=["FR"]),
    )
    fr.is_published = True
    db.add(ie)
    db.add(fr)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "irel"}
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(ie.id) in ids
    assert str(fr.id) not in ids


def test_search_by_country_code_matches_same_as_name(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    ie = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Sean Codeplayer", countries=["IE"]),
    )
    ie.is_published = True
    db.add(ie)
    db.commit()

    r = client.get(f"{settings.API_V1_STR}/players/search", params={"country": "IE"})
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(ie.id) in ids


def test_search_by_country_matches_multiple_countries(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    us = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Hank Unitedstates", countries=["US"]),
    )
    us.is_published = True
    gb = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Nigel Unitedkingdom", countries=["GB"]),
    )
    gb.is_published = True
    fr = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Marie Notunited", countries=["FR"]),
    )
    fr.is_published = True
    db.add(us)
    db.add(gb)
    db.add(fr)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "united"}
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(us.id) in ids
    assert str(gb.id) in ids
    assert str(fr.id) not in ids


def test_search_by_country_no_match_returns_empty(client: TestClient) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "zzzznotacountry"}
    )
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_search_name_and_country_combined(client: TestClient, db: Session) -> None:
    from app.models import PlayerCreate

    match = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Liam Combined", countries=["IE"]),
    )
    match.is_published = True
    wrong_country = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Liam Combined", countries=["FR"]),
    )
    wrong_country.is_published = True
    db.add(match)
    db.add(wrong_country)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search",
        params={"q": "Liam Combined", "country": "ireland"},
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(match.id) in ids
    assert str(wrong_country.id) not in ids


def test_search_by_country_only_excludes_unpublished_for_anonymous(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    hidden = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Ghost Hiddenplayer", countries=["IE"]),
    )  # is_published defaults False
    db.add(hidden)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "ireland"}
    )
    assert r.status_code == 200
    ids = {item["player"]["id"] for item in r.json()["data"]}
    assert str(hidden.id) not in ids


def test_create_player_countries_round_trip_primary_first(
    client: TestClient, db: Session
) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Round Tripper", "countries": ["GB", "IE"]}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["countries"] == ["GB", "IE"]


def test_update_player_countries_replaces_and_reprimaries(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Replaceable", countries=["IE"]),
    )
    r = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
        json={"countries": ["FR", "DE"]},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["countries"] == ["FR", "DE"]


def test_update_player_omitted_countries_leaves_existing_untouched(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Untouched", countries=["IE", "GB"]),
    )
    r = client.patch(
        f"{settings.API_V1_STR}/players/{player.id}",
        json={"bio": "just updating bio"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["countries"] == ["IE", "GB"]


def test_search_by_country_only_orders_alphabetically(
    client: TestClient, db: Session
) -> None:
    zebra = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Zebra Orderplayer", countries=["IE"]),
    )
    zebra.is_published = True
    apple = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name="Apple Orderplayer", countries=["IE"]),
    )
    apple.is_published = True
    db.add(zebra)
    db.add(apple)
    db.commit()

    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "ireland"}
    )
    assert r.status_code == 200
    names = [
        item["player"]["display_name"]
        for item in r.json()["data"]
        if item["player"]["id"] in {str(zebra.id), str(apple.id)}
    ]
    assert names == ["Apple Orderplayer", "Zebra Orderplayer"]


def test_search_by_country_resolves_new_shorthand_aliases(
    client: TestClient, db: Session
) -> None:
    from app.models import PlayerCreate

    seeded = {
        "uae": ("AE", "Zayed Aliasplayer"),
        "png": ("PG", "Kila Aliasplayer"),
        "drc": ("CD", "Joseph Aliasplayer"),
        "rsa": ("ZA", "Thabo Aliasplayer"),
        "ksa": ("SA", "Faisal Aliasplayer"),
        "car": ("CF", "Jean Aliasplayer"),
        "ivory coast": ("CI", "Kolo Aliasplayer"),
        "dprk": ("KP", "Kim Aliasplayer"),
        "rok": ("KR", "Sun Aliasplayer"),
    }
    players = {}
    for alias, (code, name) in seeded.items():
        p = crud.create_player(
            session=db, player_in=PlayerCreate(display_name=name, countries=[code])
        )
        p.is_published = True
        db.add(p)
        players[alias] = p
    db.commit()

    for alias in seeded:
        r = client.get(
            f"{settings.API_V1_STR}/players/search", params={"country": alias}
        )
        assert r.status_code == 200
        ids = {item["player"]["id"] for item in r.json()["data"]}
        assert str(players[alias].id) in ids, f"alias {alias!r} did not match its player"


def test_search_by_country_alias_near_miss_returns_empty(client: TestClient) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/players/search", params={"country": "usab"}
    )
    assert r.status_code == 200
    assert r.json()["data"] == []
