from app.countries import COUNTRY_NAMES, VALID_COUNTRY_CODES


def test_valid_country_codes_is_frozenset() -> None:
    assert isinstance(VALID_COUNTRY_CODES, frozenset)
    assert len(VALID_COUNTRY_CODES) == 253


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
