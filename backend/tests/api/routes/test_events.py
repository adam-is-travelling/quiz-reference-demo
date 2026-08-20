from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.quiz import create_random_organization


def _payload(org_id, **overrides) -> dict:
    payload = {
        "name": "Trivia Nationals",
        "start_date": "2026-06-12",
        "end_date": "2026-06-14",
        "is_online": False,
        "venue": "Divani Caravel",
        "city": "Athens",
        "country": "GR",
        "organization_id": str(org_id),
    }
    payload.update(overrides)
    return payload


def test_create_event(client: TestClient, superuser_token_headers, db: Session) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    )
    assert r.status_code == 200
    body = r.json()
    try:
        assert body["slug"] == "trivia-nationals-2026"
        assert body["organization_name"] == org.name
        assert body["quiz_count"] == 0
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{body['id']}",
            headers=superuser_token_headers,
        )


def test_create_event_requires_superuser(
    client: TestClient, normal_user_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=normal_user_token_headers,
        json=_payload(org.id),
    )
    assert r.status_code == 403


def test_create_event_unknown_organization(
    client: TestClient, superuser_token_headers
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload("11111111-1111-1111-1111-111111111111"),
    )
    assert r.status_code == 404


def test_create_online_event_with_venue_is_rejected(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id, is_online=True, city=None, country=None),
    )
    assert r.status_code == 422


def test_read_event_by_uuid_and_by_slug(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    created = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    ).json()
    try:
        by_id = client.get(f"{settings.API_V1_STR}/events/{created['id']}")
        by_slug = client.get(f"{settings.API_V1_STR}/events/{created['slug']}")
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["id"] == by_slug.json()["id"] == created["id"]
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=superuser_token_headers,
        )


def test_read_unknown_event_returns_404(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/events/no-such-event")
    assert r.status_code == 404


def test_update_event_patch_online_over_stored_venue_is_422(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    created = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    ).json()
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=superuser_token_headers,
            json={"is_online": True},
        )
        assert r.status_code == 422
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=superuser_token_headers,
        )


def test_update_event_slug_collision_is_409(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    first = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    ).json()
    second = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id, name="Other Meet"),
    ).json()
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/events/{second['id']}",
            headers=superuser_token_headers,
            json={"slug": first["slug"]},
        )
        assert r.status_code == 409
    finally:
        for event in (first, second):
            client.delete(
                f"{settings.API_V1_STR}/events/{event['id']}",
                headers=superuser_token_headers,
            )


def test_delete_event_requires_superuser(
    client: TestClient, normal_user_token_headers, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    created = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    ).json()
    try:
        r = client.delete(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=normal_user_token_headers,
        )
        assert r.status_code == 403
    finally:
        client.delete(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=superuser_token_headers,
        )
