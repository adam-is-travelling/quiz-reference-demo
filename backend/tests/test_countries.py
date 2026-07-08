import pytest
from pydantic import ValidationError

from app.countries import COUNTRY_NAMES, VALID_COUNTRY_CODES
from app.models import PlayerCreate, PlayerUpdate
from app.utils import normalize_country


def test_valid_country_codes_is_frozenset() -> None:
    assert isinstance(VALID_COUNTRY_CODES, frozenset)
    assert len(VALID_COUNTRY_CODES) == 229


def test_country_names_all_values_are_nonempty_strings() -> None:
    for code, name in COUNTRY_NAMES.items():
        assert isinstance(name, str) and name.strip(), f"Empty or non-string name for {code}"


def test_home_nations_present() -> None:
    for code in ("ENG", "SCO", "WAL", "NIR"):
        assert code in VALID_COUNTRY_CODES
        assert code in COUNTRY_NAMES


def test_gb_present() -> None:
    assert "GB" in VALID_COUNTRY_CODES
    assert COUNTRY_NAMES["GB"] == "United Kingdom"


def test_normalize_country_exact_code_uppercase() -> None:
    assert normalize_country("IE") == "IE"


def test_normalize_country_exact_code_lowercase() -> None:
    assert normalize_country("ie") == "IE"


def test_normalize_country_home_nation_code() -> None:
    assert normalize_country("ENG") == "ENG"
    assert normalize_country("sco") == "SCO"


def test_normalize_country_full_name() -> None:
    assert normalize_country("Ireland") == "IE"
    assert normalize_country("ireland") == "IE"
    assert normalize_country("United Kingdom") == "GB"


def test_normalize_country_alias_uk() -> None:
    assert normalize_country("UK") == "GB"
    assert normalize_country("Britain") == "GB"
    assert normalize_country("Great Britain") == "GB"


def test_normalize_country_alias_home_nations() -> None:
    assert normalize_country("England") == "ENG"
    assert normalize_country("Scotland") == "SCO"
    assert normalize_country("Wales") == "WAL"
    assert normalize_country("Northern Ireland") == "NIR"


def test_normalize_country_alias_usa() -> None:
    assert normalize_country("USA") == "US"
    assert normalize_country("United States of America") == "US"


def test_normalize_country_alias_russia() -> None:
    assert normalize_country("Russia") == "RU"


def test_normalize_country_new_shorthand_aliases() -> None:
    assert normalize_country("UAE") == "AE"
    assert normalize_country("PNG") == "PG"
    assert normalize_country("DRC") == "CD"
    assert normalize_country("RSA") == "ZA"
    assert normalize_country("KSA") == "SA"
    assert normalize_country("CAR") == "CF"
    assert normalize_country("Ivory Coast") == "CI"
    assert normalize_country("DPRK") == "KP"
    assert normalize_country("ROK") == "KR"


def test_normalize_country_unknown_returns_none() -> None:
    assert normalize_country("Narnia") is None
    assert normalize_country("xyz123") is None


def test_normalize_country_none_input() -> None:
    assert normalize_country(None) is None


def test_normalize_country_empty_string() -> None:
    assert normalize_country("") is None
    assert normalize_country("   ") is None


def test_player_base_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerCreate(display_name="Test", countries=["Narnia"])


def test_player_base_accepts_valid_iso_code() -> None:
    p = PlayerCreate(display_name="Test", countries=["IE"])
    assert p.countries == ["IE"]


def test_player_base_accepts_home_nation() -> None:
    p = PlayerCreate(display_name="Test", countries=["ENG"])
    assert p.countries == ["ENG"]


def test_player_base_accepts_empty_countries() -> None:
    p = PlayerCreate(display_name="Test", countries=[])
    assert p.countries == []


def test_player_update_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerUpdate(country="NotACode")


def test_player_update_accepts_none() -> None:
    p = PlayerUpdate(country=None)
    assert p.country is None
