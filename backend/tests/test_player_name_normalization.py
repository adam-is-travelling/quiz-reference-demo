import pytest

from app.models import PlayerBase, PlayerUpdate


# ---------------------------------------------------------------------------
# PlayerBase — ALL CAPS inputs that should be normalized to title case
# ---------------------------------------------------------------------------


def test_player_base_normalizes_all_caps_full_name() -> None:
    p = PlayerBase(display_name="JOHN SMITH")
    assert p.display_name == "John Smith"


def test_player_base_normalizes_all_caps_single_word() -> None:
    p = PlayerBase(display_name="SMITH")
    assert p.display_name == "Smith"


def test_player_base_normalizes_all_caps_hyphenated_name() -> None:
    p = PlayerBase(display_name="SMITH-JONES")
    assert p.display_name == "Smith-Jones"


def test_player_base_normalizes_all_caps_double_hyphenated_name() -> None:
    p = PlayerBase(display_name="ANNE-MARIE SMITH-JONES")
    assert p.display_name == "Anne-Marie Smith-Jones"


def test_player_base_normalizes_all_caps_with_initials() -> None:
    p = PlayerBase(display_name="G.E. MOORE")
    assert p.display_name == "G.E. Moore"


def test_player_base_normalizes_all_caps_with_apostrophe() -> None:
    p = PlayerBase(display_name="O'BRIEN")
    assert p.display_name == "O'Brien"


def test_player_base_normalizes_all_caps_with_accented_characters() -> None:
    p = PlayerBase(display_name="SÉAN ÓBRIEN")
    assert p.display_name == "Séan Óbrien"


# ---------------------------------------------------------------------------
# PlayerBase — all-lowercase inputs that should also be normalized to title case
# ---------------------------------------------------------------------------


def test_player_base_normalizes_all_lowercase_full_name() -> None:
    p = PlayerBase(display_name="john smith")
    assert p.display_name == "John Smith"


def test_player_base_normalizes_all_lowercase_single_word() -> None:
    p = PlayerBase(display_name="smith")
    assert p.display_name == "Smith"


def test_player_base_normalizes_all_lowercase_hyphenated_name() -> None:
    p = PlayerBase(display_name="smith-jones")
    assert p.display_name == "Smith-Jones"


def test_player_base_normalizes_all_lowercase_with_initials() -> None:
    p = PlayerBase(display_name="g.e. moore")
    assert p.display_name == "G.E. Moore"


def test_player_base_normalizes_all_lowercase_with_apostrophe() -> None:
    p = PlayerBase(display_name="o'brien")
    assert p.display_name == "O'Brien"


# ---------------------------------------------------------------------------
# PlayerBase — mixed-case inputs that must NOT be changed
# ---------------------------------------------------------------------------


def test_player_base_leaves_macdonald_style_unchanged() -> None:
    p = PlayerBase(display_name="MacDonald")
    assert p.display_name == "MacDonald"


def test_player_base_leaves_camel_style_unchanged() -> None:
    p = PlayerBase(display_name="RamaSita")
    assert p.display_name == "RamaSita"


def test_player_base_leaves_title_case_unchanged() -> None:
    p = PlayerBase(display_name="John Smith")
    assert p.display_name == "John Smith"


def test_player_base_leaves_title_case_hyphenated_unchanged() -> None:
    p = PlayerBase(display_name="Smith-Jones")
    assert p.display_name == "Smith-Jones"


def test_player_base_leaves_title_case_with_apostrophe_unchanged() -> None:
    p = PlayerBase(display_name="O'Brien")
    assert p.display_name == "O'Brien"


def test_player_base_leaves_title_case_with_initials_unchanged() -> None:
    p = PlayerBase(display_name="G.E. Moore")
    assert p.display_name == "G.E. Moore"


# ---------------------------------------------------------------------------
# PlayerBase — edge cases
# ---------------------------------------------------------------------------


def test_player_base_normalizes_all_caps_with_digits() -> None:
    # Letters are all caps; digits are unaffected by title()
    p = PlayerBase(display_name="PLAYER 1")
    assert p.display_name == "Player 1"


def test_player_base_normalizes_all_lowercase_with_digits() -> None:
    p = PlayerBase(display_name="player 1")
    assert p.display_name == "Player 1"


def test_player_base_leaves_no_alpha_characters_unchanged() -> None:
    # No alphabetic characters — nothing to detect or normalize
    p = PlayerBase(display_name="123")
    assert p.display_name == "123"


def test_player_base_leaves_single_uppercase_letter_unchanged() -> None:
    # Single uppercase letter is "all caps"; title() is a no-op here
    p = PlayerBase(display_name="A")
    assert p.display_name == "A"


def test_player_base_leaves_mixed_case_with_digits_unchanged() -> None:
    # Has both upper and lower alpha, so mixed-case — leave alone
    p = PlayerBase(display_name="Player1A")
    assert p.display_name == "Player1A"


def test_player_base_leaves_whitespace_only_name_unchanged() -> None:
    p = PlayerBase(display_name="   ")
    assert p.display_name == "   "


# ---------------------------------------------------------------------------
# PlayerUpdate — same normalization applies to display_name when provided
# ---------------------------------------------------------------------------


def test_player_update_normalizes_all_caps_display_name() -> None:
    u = PlayerUpdate(display_name="JANE DOE")
    assert u.display_name == "Jane Doe"


def test_player_update_normalizes_all_caps_hyphenated() -> None:
    u = PlayerUpdate(display_name="ANNE-MARIE")
    assert u.display_name == "Anne-Marie"


def test_player_update_normalizes_all_lowercase_display_name() -> None:
    u = PlayerUpdate(display_name="jane doe")
    assert u.display_name == "Jane Doe"


def test_player_update_leaves_mixed_case_display_name_unchanged() -> None:
    u = PlayerUpdate(display_name="MacDonald")
    assert u.display_name == "MacDonald"


def test_player_update_leaves_none_display_name_unchanged() -> None:
    u = PlayerUpdate(display_name=None)
    assert u.display_name is None


def test_player_update_leaves_title_case_display_name_unchanged() -> None:
    u = PlayerUpdate(display_name="Jane Doe")
    assert u.display_name == "Jane Doe"
