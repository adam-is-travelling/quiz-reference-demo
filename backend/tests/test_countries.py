from app.countries import VALID_COUNTRY_CODES, COUNTRY_NAMES


def test_valid_country_codes_is_frozenset() -> None:
    assert isinstance(VALID_COUNTRY_CODES, frozenset)
    assert len(VALID_COUNTRY_CODES) > 250


def test_country_names_covers_all_codes() -> None:
    for code in VALID_COUNTRY_CODES:
        assert code in COUNTRY_NAMES, f"Missing name for {code}"


def test_home_nations_present() -> None:
    for code in ("ENG", "SCO", "WAL", "NIR"):
        assert code in VALID_COUNTRY_CODES
        assert code in COUNTRY_NAMES


def test_gb_present() -> None:
    assert "GB" in VALID_COUNTRY_CODES
    assert COUNTRY_NAMES["GB"] == "United Kingdom"
