import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.quiz import (
    create_approved_quiz,
    create_random_organization,
    create_random_quiz,
)


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


def test_quiz_count_excludes_non_approved_quizzes(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    # quiz_count is read by the public event page; a pending or rejected quiz
    # leaking into that number would misrepresent unmoderated content as live.
    org = create_random_organization(db)
    created = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    ).json()
    event_id = uuid.UUID(created["id"])
    approved = create_approved_quiz(db)
    pending = create_random_quiz(db)
    approved.event_id = event_id
    pending.event_id = event_id
    db.add(approved)
    db.add(pending)
    db.commit()
    try:
        r = client.get(f"{settings.API_V1_STR}/events/{created['id']}")
        assert r.status_code == 200
        assert r.json()["quiz_count"] == 1
    finally:
        db.delete(approved)
        db.delete(pending)
        db.commit()
        client.delete(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=superuser_token_headers,
        )


def test_event_podium_excludes_non_approved_quizzes(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    # The public podium must never surface a pending/rejected quiz's results.
    org = create_random_organization(db)
    created = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id),
    ).json()
    event_id = uuid.UUID(created["id"])
    approved = create_approved_quiz(db)
    pending = create_random_quiz(db)
    approved.event_id = event_id
    pending.event_id = event_id
    db.add(approved)
    db.add(pending)
    db.commit()
    try:
        r = client.get(f"{settings.API_V1_STR}/events/{created['id']}/podium")
        assert r.status_code == 200
        quiz_ids = {q["quiz_id"] for q in r.json()["quizzes"]}
        assert quiz_ids == {str(approved.id)}
    finally:
        db.delete(approved)
        db.delete(pending)
        db.commit()
        client.delete(
            f"{settings.API_V1_STR}/events/{created['id']}",
            headers=superuser_token_headers,
        )


def test_read_events_returns_event_and_paginates(
    client: TestClient, superuser_token_headers, db: Session
) -> None:
    org = create_random_organization(db)
    first = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(org.id, name="Pagination One"),
    ).json()
    second = client.post(
        f"{settings.API_V1_STR}/events/",
        headers=superuser_token_headers,
        json=_payload(
            org.id,
            name="Pagination Two",
            start_date="2026-07-01",
            end_date="2026-07-02",
        ),
    ).json()
    try:
        r = client.get(f"{settings.API_V1_STR}/events/")
        assert r.status_code == 200
        body = r.json()
        ids = {e["id"] for e in body["data"]}
        assert first["id"] in ids
        assert second["id"] in ids

        page_a = client.get(f"{settings.API_V1_STR}/events/?skip=0&limit=1").json()
        page_b = client.get(f"{settings.API_V1_STR}/events/?skip=1&limit=1").json()
        assert len(page_a["data"]) == 1
        assert len(page_b["data"]) == 1
        assert page_a["data"][0]["id"] != page_b["data"][0]["id"]
        assert page_a["count"] == page_b["count"] == body["count"]
    finally:
        for event in (first, second):
            client.delete(
                f"{settings.API_V1_STR}/events/{event['id']}",
                headers=superuser_token_headers,
            )
