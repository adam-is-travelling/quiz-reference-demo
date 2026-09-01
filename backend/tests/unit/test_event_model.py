from datetime import date

import pytest
from pydantic import ValidationError

from app.models import EventCreate


def _payload(**overrides):
    base = {
        "name": "Trivia Nationals",
        "start_date": date(2026, 6, 12),
        "end_date": date(2026, 6, 14),
        "is_online": False,
        "country": "GR",
        "organization_id": "11111111-1111-1111-1111-111111111111",
    }
    base.update(overrides)
    return base


def test_in_person_event_with_country_is_valid() -> None:
    event = EventCreate(**_payload(venue="Divani Caravel", city="Athens"))
    assert event.country == "GR"
    assert event.is_online is False


def test_online_event_with_no_location_is_valid() -> None:
    event = EventCreate(**_payload(is_online=True, country=None))
    assert event.is_online is True
    assert event.country is None


def test_online_event_with_venue_is_rejected() -> None:
    with pytest.raises(ValidationError, match="online event"):
        EventCreate(**_payload(is_online=True, country=None, venue="Divani Caravel"))


def test_online_event_with_city_is_rejected() -> None:
    with pytest.raises(ValidationError, match="online event"):
        EventCreate(**_payload(is_online=True, country=None, city="Athens"))


def test_online_event_with_country_is_rejected() -> None:
    with pytest.raises(ValidationError, match="online event"):
        EventCreate(**_payload(is_online=True))


def test_in_person_event_without_country_is_rejected() -> None:
    with pytest.raises(ValidationError, match="requires a country"):
        EventCreate(**_payload(country=None))


def test_invalid_country_code_is_rejected() -> None:
    with pytest.raises(ValidationError, match="Invalid country code"):
        EventCreate(**_payload(country="XXX"))


def test_end_date_before_start_date_is_rejected() -> None:
    with pytest.raises(ValidationError, match="end_date"):
        EventCreate(**_payload(start_date=date(2026, 6, 14), end_date=date(2026, 6, 12)))


def test_single_day_event_is_valid() -> None:
    event = EventCreate(**_payload(start_date=date(2026, 6, 12), end_date=date(2026, 6, 12)))
    assert event.start_date == event.end_date
