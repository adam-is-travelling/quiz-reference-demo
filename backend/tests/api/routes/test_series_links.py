import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import RecurringSeriesType
from tests.utils.quiz import (
    create_random_event,
    create_random_organization,
    create_random_quiz,
    create_random_series,
)

API = settings.API_V1_STR


def _quiz_payload(**overrides) -> dict:
    payload = {"name": "Link Test Quiz", "start_date": "2026-08-07", "end_date": "2026-08-07"}
    payload.update(overrides)
    return payload


def _event_payload(org_id, **overrides) -> dict:
    payload = {
        "name": "Link Test Event",
        "start_date": "2026-08-07",
        "end_date": "2026-08-09",
        "is_online": True,
        "organization_id": str(org_id),
    }
    payload.update(overrides)
    return payload


# --- quizzes -----------------------------------------------------------------


def test_quiz_joins_a_quiz_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    r = client.post(
        f"{API}/quizzes/",
        headers=superuser_token_headers,
        json=_quiz_payload(series_id=str(series.id)),
    )
    assert r.status_code == 200
    assert r.json()["series_id"] == str(series.id)


def test_quiz_cannot_join_an_event_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.post(
        f"{API}/quizzes/",
        headers=superuser_token_headers,
        json=_quiz_payload(series_id=str(series.id)),
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "A quiz can only join a quiz series"


def test_quiz_with_unknown_series_is_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{API}/quizzes/",
        headers=superuser_token_headers,
        json=_quiz_payload(series_id=str(uuid.uuid4())),
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Series not found"


def test_patch_quiz_into_an_event_series_is_422(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    quiz = create_random_quiz(db)
    series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.patch(
        f"{API}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"series_id": str(series.id)},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "A quiz can only join a quiz series"


def test_patch_quiz_clears_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    quiz = create_random_quiz(db)
    quiz.series_id = series.id
    db.add(quiz)
    db.commit()
    r = client.patch(
        f"{API}/quizzes/{quiz.id}",
        headers=superuser_token_headers,
        json={"series_id": None},
    )
    assert r.status_code == 200
    assert r.json()["series_id"] is None


# --- events ------------------------------------------------------------------


def test_event_joins_an_event_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    r = client.post(
        f"{API}/events/",
        headers=superuser_token_headers,
        json=_event_payload(series.organization_id, series_id=str(series.id)),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["series_id"] == str(series.id)
    assert body["series_name"] == series.name
    assert body["series_slug"] == series.slug


def test_event_cannot_join_a_quiz_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db)
    r = client.post(
        f"{API}/events/",
        headers=superuser_token_headers,
        json=_event_payload(series.organization_id, series_id=str(series.id)),
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "An event can only join an event series"


def test_event_with_unknown_series_is_404(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    org = create_random_organization(db)
    r = client.post(
        f"{API}/events/",
        headers=superuser_token_headers,
        json=_event_payload(org.id, series_id=str(uuid.uuid4())),
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Series not found"


def test_patch_event_into_a_quiz_series_is_422(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    event = create_random_event(db)
    series = create_random_series(db)
    r = client.patch(
        f"{API}/events/{event.id}",
        headers=superuser_token_headers,
        json={"series_id": str(series.id)},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "An event can only join an event series"


def test_patch_event_clears_series(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    event = create_random_event(db, series_id=series.id)
    r = client.patch(
        f"{API}/events/{event.id}",
        headers=superuser_token_headers,
        json={"series_id": None},
    )
    assert r.status_code == 200
    assert r.json()["series_id"] is None
    assert r.json()["series_name"] is None


def test_event_without_series_has_null_series_fields(
    client: TestClient, db: Session
) -> None:
    event = create_random_event(db)
    body = client.get(f"{API}/events/{event.id}").json()
    assert body["series_id"] is None
    assert body["series_name"] is None
    assert body["series_slug"] is None


def test_read_events_filters_by_series_id(client: TestClient, db: Session) -> None:
    series = create_random_series(db, type=RecurringSeriesType.event)
    in_series = create_random_event(db, series_id=series.id)
    create_random_event(db)
    r = client.get(f"{API}/events/", params={"series_id": str(series.id)})
    assert r.status_code == 200
    body = r.json()
    assert [e["id"] for e in body["data"]] == [str(in_series.id)]
    assert body["count"] == 1
