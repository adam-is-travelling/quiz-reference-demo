import uuid

import pytest
from pydantic import ValidationError

from app.models import PlayerCreate, PlayerUpdate, QuizResultCreate


def test_player_create_accepts_multiple_valid_countries() -> None:
    p = PlayerCreate(display_name="Test", countries=["GB", "IE", "ENG"])
    assert p.countries == ["GB", "IE", "ENG"]  # order preserved


def test_player_create_defaults_to_empty_list() -> None:
    p = PlayerCreate(display_name="Test")
    assert p.countries == []


def test_player_create_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerCreate(display_name="Test", countries=["GB", "ZZ"])


def test_player_update_none_countries_allowed() -> None:
    u = PlayerUpdate(countries=None)
    assert u.countries is None


def test_player_update_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerUpdate(countries=["ZZ"])


def test_quiz_result_create_accepts_valid_country() -> None:
    r = QuizResultCreate(
        player_id=uuid.uuid4(), final_rank=1, score=10.0, country="ENG"
    )
    assert r.country == "ENG"


def test_quiz_result_create_allows_null_country() -> None:
    r = QuizResultCreate(player_id=uuid.uuid4(), final_rank=1, score=10.0)
    assert r.country is None


def test_quiz_result_create_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        QuizResultCreate(
            player_id=uuid.uuid4(), final_rank=1, score=10.0, country="ZZ"
        )
