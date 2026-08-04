import uuid

from sqlmodel import Session

from app import crud
from app.crud import generate_unique_slug, slugify
from app.models import Player


def test_slugify_lowercases_and_hyphenates() -> None:
    assert slugify("London Open") == "london-open"


def test_slugify_strips_punctuation_including_em_dash() -> None:
    assert slugify("Summer League — Quiz 10") == "summer-league-quiz-10"


def test_slugify_collapses_whitespace_and_underscores() -> None:
    assert slugify("Winter   Cup_2026") == "winter-cup-2026"


def test_slugify_strips_leading_and_trailing_hyphens() -> None:
    assert slugify("!! Big Quiz !!") == "big-quiz"


def test_slugify_preserves_non_ascii() -> None:
    # Deliberate: transliteration was rejected because NFD-stripping corrupts
    # non-Latin scripts and collides distinct names. Do not "fix" this.
    assert slugify("Московский Квиз") == "московский-квиз"
    assert slugify("Café Quiz") == "café-quiz"


def test_generate_unique_slug_returns_base_when_free(db: Session) -> None:
    assert (
        generate_unique_slug(
            session=db, model=Player, base=f"unused-slug-{uuid.uuid4().hex[:8]}"
        ).startswith("unused-slug-")
    )


def test_generate_unique_slug_appends_counter_on_collision(db: Session) -> None:
    from app.models import PlayerCreate

    name = f"Collision Player {uuid.uuid4().hex[:8]}"
    first = crud.create_player(session=db, player_in=PlayerCreate(display_name=name))
    try:
        assert generate_unique_slug(
            session=db, model=Player, base=first.slug
        ) == f"{first.slug}-2"
    finally:
        db.delete(first)
        db.commit()
