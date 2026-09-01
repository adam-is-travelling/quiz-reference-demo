from datetime import date

import pytest
from sqlmodel import Session

from app import crud
from app.models import EventCreate, EventUpdate, EventValidationError
from tests.utils.quiz import create_random_organization


def _event_in(org_id, **overrides) -> EventCreate:
    payload = {
        "name": "Trivia Nationals",
        "start_date": date(2026, 6, 12),
        "end_date": date(2026, 6, 14),
        "is_online": False,
        "venue": "Divani Caravel",
        "city": "Athens",
        "country": "GR",
        "organization_id": org_id,
    }
    payload.update(overrides)
    return EventCreate(**payload)


def test_create_event_generates_slug_from_name_and_year(db: Session) -> None:
    org = create_random_organization(db)
    event = crud.create_event(session=db, event_in=_event_in(org.id))
    try:
        assert event.slug == "trivia-nationals-2026"
    finally:
        crud.delete_event(session=db, db_event=event)


def test_create_event_deduplicates_colliding_slugs(db: Session) -> None:
    org = create_random_organization(db)
    first = crud.create_event(session=db, event_in=_event_in(org.id))
    second = crud.create_event(session=db, event_in=_event_in(org.id))
    try:
        assert first.slug == "trivia-nationals-2026"
        assert second.slug != first.slug
        assert second.slug.startswith("trivia-nationals-2026")
    finally:
        crud.delete_event(session=db, db_event=first)
        crud.delete_event(session=db, db_event=second)


def test_create_event_falls_back_when_name_has_no_slug_characters(db: Session) -> None:
    org = create_random_organization(db)
    event = crud.create_event(session=db, event_in=_event_in(org.id, name="!!!"))
    try:
        assert event.slug
        assert event.slug != "-2026"
    finally:
        crud.delete_event(session=db, db_event=event)


def test_update_event_rejects_online_with_stored_venue(db: Session) -> None:
    org = create_random_organization(db)
    event = crud.create_event(session=db, event_in=_event_in(org.id))
    try:
        with pytest.raises(EventValidationError, match="online event"):
            crud.update_event(
                session=db, db_event=event, event_in=EventUpdate(is_online=True)
            )
    finally:
        crud.delete_event(session=db, db_event=event)


def test_update_event_accepts_online_when_location_cleared_together(db: Session) -> None:
    org = create_random_organization(db)
    event = crud.create_event(session=db, event_in=_event_in(org.id))
    try:
        updated = crud.update_event(
            session=db,
            db_event=event,
            event_in=EventUpdate(
                is_online=True, venue=None, city=None, country=None
            ),
        )
        assert updated.is_online is True
        assert updated.venue is None
        assert updated.country is None
    finally:
        crud.delete_event(session=db, db_event=event)


def test_update_event_rejects_colliding_slug(db: Session) -> None:
    org = create_random_organization(db)
    first = crud.create_event(session=db, event_in=_event_in(org.id))
    second = crud.create_event(session=db, event_in=_event_in(org.id, name="Other Meet"))
    try:
        with pytest.raises(ValueError, match="Slug already in use"):
            crud.update_event(
                session=db, db_event=second, event_in=EventUpdate(slug=first.slug)
            )
    finally:
        crud.delete_event(session=db, db_event=first)
        crud.delete_event(session=db, db_event=second)
