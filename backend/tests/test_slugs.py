import uuid
from datetime import date

from sqlmodel import Session

from app import crud
from app.crud import generate_unique_slug, slugify
from app.models import CompetitionCreate, OrganizationCreate, Player


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
    base = f"unused-slug-{uuid.uuid4().hex[:8]}"
    assert generate_unique_slug(session=db, model=Player, base=base) == base


def test_generate_unique_slug_appends_counter_on_collision(db: Session) -> None:
    from app.models import PlayerCreate

    name = f"Collision Player {uuid.uuid4().hex[:8]}"
    first = crud.create_player(session=db, player_in=PlayerCreate(display_name=name))
    try:
        assert (
            generate_unique_slug(session=db, model=Player, base=first.slug)
            == f"{first.slug}-2"
        )
    finally:
        db.delete(first)
        db.commit()


def test_organization_slug_generated_on_create(db: Session) -> None:
    name = f"Slug Test Org {uuid.uuid4().hex[:8]}"
    org = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    try:
        assert org.slug == slugify(name)
    finally:
        db.delete(org)
        db.commit()


def test_duplicate_organization_names_get_counter(db: Session) -> None:
    name = f"Dup Org {uuid.uuid4().hex[:8]}"
    first = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    second = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    try:
        assert first.slug == slugify(name)
        assert second.slug == f"{slugify(name)}-2"
    finally:
        db.delete(first)
        db.delete(second)
        db.commit()


def test_competition_slug_generated_on_create(db: Session) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Comp Org {uuid.uuid4().hex[:8]}")
    )
    name = f"Slug Test Competition {uuid.uuid4().hex[:8]}"
    comp = crud.create_competition(
        session=db,
        competition_in=CompetitionCreate(name=name, organization_id=org.id),
    )
    try:
        assert comp.slug == slugify(name)
    finally:
        db.delete(comp)
        db.delete(org)
        db.commit()


def test_quiz_slug_omits_start_date_when_name_is_free(db: Session) -> None:
    # The date is a disambiguator, not decoration: an unclaimed name slugifies
    # to a bare, readable slug.
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    name = f"Bare Slug Quiz {uuid.uuid4().hex[:8]}"
    quiz = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=name,
            start_date=date(2026, 3, 15),
            end_date=date(2026, 3, 15),
        ),
        submitted_by_id=user.id,
    )
    try:
        assert quiz.slug == slugify(name)
        assert "2026-03-15" not in quiz.slug
    finally:
        db.delete(quiz)
        db.delete(user)
        db.commit()


def test_quiz_slug_falls_back_to_start_date_on_name_collision(db: Session) -> None:
    # Second quiz of the same name on a different day: the date disambiguates.
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    name = f"Collide Slug Quiz {uuid.uuid4().hex[:8]}"
    first = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=name, start_date=date(2026, 4, 1), end_date=date(2026, 4, 1)
        ),
        submitted_by_id=user.id,
    )
    second = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=name, start_date=date(2026, 4, 2), end_date=date(2026, 4, 2)
        ),
        submitted_by_id=user.id,
    )
    try:
        assert first.slug == slugify(name)
        assert second.slug == f"{slugify(name)}-2026-04-02"
    finally:
        for quiz in (first, second):
            db.delete(quiz)
        db.delete(user)
        db.commit()


def test_same_name_same_day_quizzes_get_counter(db: Session) -> None:
    # Name free -> bare; name taken -> dated; both taken -> counter on the
    # dated form.
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    name = f"Repeat Day Quiz {uuid.uuid4().hex[:8]}"
    quizzes = [
        crud.create_quiz(
            session=db,
            quiz_in=QuizCreate(
                name=name,
                start_date=date(2026, 4, 1),
                end_date=date(2026, 4, 1),
            ),
            submitted_by_id=user.id,
        )
        for _ in range(3)
    ]
    try:
        assert quizzes[0].slug == slugify(name)
        assert quizzes[1].slug == f"{slugify(name)}-2026-04-01"
        assert quizzes[2].slug == f"{slugify(name)}-2026-04-01-2"
    finally:
        for quiz in quizzes:
            db.delete(quiz)
        db.delete(user)
        db.commit()


def test_quiz_with_empty_slugified_name_falls_back_to_date(db: Session) -> None:
    # "---" strips to "" under slugify; the bare-name candidate is unusable, so
    # the date alone must carry the slug rather than writing an empty string.
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    quiz = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name="---", start_date=date(2026, 5, 1), end_date=date(2026, 5, 1)
        ),
        submitted_by_id=user.id,
    )
    try:
        assert quiz.slug != ""
        assert not quiz.slug.startswith("-")
        assert quiz.slug.startswith("2026-05-01")
    finally:
        db.delete(quiz)
        db.delete(user)
        db.commit()


def test_organization_with_empty_slugified_name_gets_non_empty_slug(
    db: Session,
) -> None:
    # "---" strips to "" under slugify; the create path must not persist an
    # empty string into the NOT NULL unique slug column.
    org = crud.create_organization(session=db, org_in=OrganizationCreate(name="---"))
    try:
        assert org.slug != ""
        assert slugify(org.slug) == org.slug
    finally:
        db.delete(org)
        db.commit()


def test_quiz_with_long_name_clamps_slug_within_column_limit(db: Session) -> None:
    # A 250-char name slugifies to a 250-char base; appending "-" + an
    # 11-char ISO date would push a naive base to 261 chars, overflowing the
    # VARCHAR(255) `slug` column and raising StringDataRightTruncation (500).
    # The create path must clamp the name portion so the composed slug stays
    # within the column limit while still ending with the date.
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    long_name = "a" * 250
    first = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=long_name,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 1),
        ),
        submitted_by_id=user.id,
    )
    # The second one must fall back to the dated form, which is where the
    # overflow risk actually lives.
    second = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name=long_name,
            start_date=date(2026, 6, 2),
            end_date=date(2026, 6, 2),
        ),
        submitted_by_id=user.id,
    )
    try:
        assert len(first.slug) <= 255
        assert len(second.slug) <= 255
        assert second.slug.endswith("2026-06-02")
    finally:
        for quiz in (first, second):
            db.delete(quiz)
        db.delete(user)
        db.commit()


def test_quiz_with_empty_slugified_name_has_no_leading_hyphen(db: Session) -> None:
    from app.models import QuizCreate
    from tests.utils.user import create_random_user

    user = create_random_user(db)
    quiz = crud.create_quiz(
        session=db,
        quiz_in=QuizCreate(
            name="---",
            start_date=date(2026, 5, 20),
            end_date=date(2026, 5, 20),
        ),
        submitted_by_id=user.id,
    )
    try:
        assert quiz.slug == "2026-05-20"
        assert not quiz.slug.startswith("-")
        assert quiz.slug.endswith("2026-05-20")
    finally:
        db.delete(quiz)
        db.delete(user)
        db.commit()
