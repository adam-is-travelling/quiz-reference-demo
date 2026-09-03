import re
import unicodedata
import uuid
from difflib import SequenceMatcher
from typing import Any, Protocol, TypeVar

from sqlalchemy import func, or_
from sqlmodel import Session, col, delete, select

from app.core.security import get_password_hash, verify_password
from app.countries import COUNTRY_NAMES
from app.models import (
    Competition,
    CompetitionCreate,
    CompetitionUpdate,
    Event,
    EventCreate,
    EventUpdate,
    MergeConflict,
    MergePlayersPreview,
    Organization,
    OrganizationCreate,
    OrganizationUpdate,
    Player,
    PlayerCompetitionGroup,
    PlayerCountry,
    PlayerCreate,
    PlayerHistoryGrouped,
    PlayerMergeAudit,
    PlayerPublic,
    PlayerResultWithQuiz,
    PlayerUpdate,
    Quiz,
    QuizCreate,
    QuizFormat,
    QuizFormatCreate,
    QuizFormatUpdate,
    QuizResult,
    QuizResultCreate,
    QuizResultPlayer,
    QuizResultUpdate,
    QuizStatus,
    QuizUpdate,
    ResultParticipantPublic,
    ResultPartner,
    User,
    UserCreate,
    UserUpdate,
    validate_event_fields,
)
from app.utils import COUNTRY_ALIASES


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


# --- Organization ---


def create_organization(
    *, session: Session, org_in: OrganizationCreate
) -> Organization:
    # `name` has no min_length, so a name like "---" slugifies to "". Fall back to
    # an opaque unique token rather than writing an empty slug. This deliberately
    # differs from the backfill migration's row-id fallback: both are opaque and
    # non-user-facing, but the row id isn't available here before insert.
    base = clamp_slug_base(slugify(org_in.name)) or uuid.uuid4().hex[:12]
    org = Organization.model_validate(
        org_in,
        update={
            "slug": generate_unique_slug(session=session, model=Organization, base=base)
        },
    )
    session.add(org)
    session.commit()
    session.refresh(org)
    return org


def update_organization(
    *, session: Session, db_org: Organization, org_in: OrganizationUpdate
) -> Organization:
    data = org_in.model_dump(exclude_unset=True)
    if data.get("slug") is None:
        data.pop("slug", None)
    if data.get("slug") is not None:
        existing = session.exec(
            select(Organization).where(Organization.slug == data["slug"])
        ).first()
        if existing and existing.id != db_org.id:
            raise ValueError("Slug already in use")
    db_org.sqlmodel_update(data)
    session.add(db_org)
    session.commit()
    session.refresh(db_org)
    return db_org


# --- Competition ---


def create_competition(
    *, session: Session, competition_in: CompetitionCreate
) -> Competition:
    # Same empty-slug guard as create_organization — see comment there.
    base = clamp_slug_base(slugify(competition_in.name)) or uuid.uuid4().hex[:12]
    competition = Competition.model_validate(
        competition_in,
        update={
            "slug": generate_unique_slug(session=session, model=Competition, base=base)
        },
    )
    session.add(competition)
    session.commit()
    session.refresh(competition)
    return competition


def update_competition(
    *,
    session: Session,
    db_competition: Competition,
    competition_in: CompetitionUpdate,
) -> Competition:
    update_data = competition_in.model_dump(exclude_unset=True)
    if update_data.get("organization_id") is None:
        update_data.pop("organization_id", None)
    if update_data.get("slug") is None:
        update_data.pop("slug", None)
    if update_data.get("slug") is not None:
        existing = session.exec(
            select(Competition).where(Competition.slug == update_data["slug"])
        ).first()
        if existing and existing.id != db_competition.id:
            raise ValueError("Slug already in use")
    db_competition.sqlmodel_update(update_data)
    session.add(db_competition)
    session.commit()
    session.refresh(db_competition)
    return db_competition


def delete_competition(*, session: Session, db_competition: Competition) -> None:
    session.delete(db_competition)
    session.commit()


# --- Event ---


def create_event(*, session: Session, event_in: EventCreate) -> Event:
    # Same empty-slug guard as create_organization — see comment there.
    name_part = clamp_slug_base(slugify(event_in.name))
    parts = [part for part in (name_part, str(event_in.start_date.year)) if part]
    base = "-".join(parts) if name_part else uuid.uuid4().hex[:12]
    event = Event.model_validate(
        event_in,
        update={"slug": generate_unique_slug(session=session, model=Event, base=base)},
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def update_event(*, session: Session, db_event: Event, event_in: EventUpdate) -> Event:
    update_data = event_in.model_dump(exclude_unset=True)
    if update_data.get("organization_id") is None:
        update_data.pop("organization_id", None)
    if update_data.get("slug") is None:
        update_data.pop("slug", None)
    if update_data.get("slug") is not None:
        existing = session.exec(
            select(Event).where(Event.slug == update_data["slug"])
        ).first()
        if existing and existing.id != db_event.id:
            raise ValueError("Slug already in use")

    # A partial patch cannot be validated alone — check the merged result.
    merged = {
        "is_online": db_event.is_online,
        "venue": db_event.venue,
        "city": db_event.city,
        "country": db_event.country,
        "start_date": db_event.start_date,
        "end_date": db_event.end_date,
    }
    merged.update({k: v for k, v in update_data.items() if k in merged})
    validate_event_fields(**merged)

    db_event.sqlmodel_update(update_data)
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def delete_event(*, session: Session, db_event: Event) -> None:
    session.delete(db_event)
    session.commit()


# --- Player ---


class _SlugModel(Protocol):
    """Structural bound for models eligible for `generate_unique_slug`.

    Read-only so both `Player.slug` (`str | None`) and the NOT NULL
    `slug: str` columns on Organization/Competition/Quiz satisfy it —
    a mutable Protocol attribute would be invariant and reject the latter.
    """

    @property
    def slug(self) -> str | None: ...


_SlugModelT = TypeVar("_SlugModelT", bound=_SlugModel)


def slugify(text: str) -> str:
    base = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_]+", "-", base).strip("-")


# `slug` columns are VARCHAR(255). Cap the base we hand to `generate_unique_slug`
# well below that so its `-NN` counter suffix (and, for quizzes, the appended
# date) always fits without truncating the column and raising a 500.
SLUG_BASE_LIMIT = 240


def clamp_slug_base(base: str) -> str:
    return base[:SLUG_BASE_LIMIT].rstrip("-")


def generate_unique_slug(
    *, session: Session, model: type[_SlugModelT], base: str
) -> str:
    slug, counter = base, 2
    while session.exec(
        # mypy's strict-equality flags `property == str` here because the
        # Protocol member is read-only; at runtime `model.slug` is a SQLModel
        # InstrumentedAttribute, not the property object, so the comparison
        # builds a SQL expression as intended. The read-only member is load-
        # bearing: a mutable one would be invariant and reject the NOT NULL
        # `slug: str` columns added later.
        select(model).where(model.slug == slug)  # type: ignore[comparison-overlap]
    ).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def resolve_by_id_or_slug(
    *, session: Session, model: type[_SlugModelT], value: str
) -> _SlugModelT | None:
    try:
        pk = uuid.UUID(value)
    except ValueError:
        # Same strict-equality situation as generate_unique_slug above: the
        # Protocol's `slug` member is a read-only property for variance reasons,
        # but at runtime `model.slug` is a SQLModel InstrumentedAttribute.
        return session.exec(
            select(model).where(model.slug == value)  # type: ignore[comparison-overlap]
        ).first()
    return session.get(model, pk)


def _normalize(s: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def create_player(
    *, session: Session, player_in: PlayerCreate, commit: bool = True
) -> Player:
    # Same empty-slug guard as create_organization — see comment there.
    base = slugify(player_in.display_name) or uuid.uuid4().hex[:12]
    slug = generate_unique_slug(
        session=session,
        model=Player,
        base=base,
    )
    player_data = player_in.model_dump(exclude={"countries"})
    player = Player(**player_data, slug=slug)
    session.add(player)
    session.flush()
    session.refresh(player)

    for index, code in enumerate(player_in.countries):
        session.add(
            PlayerCountry(player_id=player.id, code=code, is_primary=(index == 0))
        )
    if commit:
        session.commit()
    else:
        session.flush()
    return player


def get_player_by_slug(*, session: Session, slug: str) -> Player | None:
    return session.exec(select(Player).where(Player.slug == slug)).first()


def _resolve_country_codes(text: str) -> set[str]:
    needle = text.strip().lower()
    if not needle:
        return set()
    upper = needle.upper()
    codes = {
        code
        for code, name in COUNTRY_NAMES.items()
        if upper == code or needle in name.lower()
    }
    if upper in COUNTRY_ALIASES:
        codes.add(COUNTRY_ALIASES[upper])
    return codes


def search_players(
    *,
    session: Session,
    q: str = "",
    country: str | None = None,
    limit: int = 5,
    published_only: bool = False,
) -> list[tuple[Player, float]]:
    name_query = (q or "").strip()
    country_text = (country or "").strip()
    if not name_query and not country_text:
        return []

    q_norm = _normalize(q or "")
    stmt = select(Player)
    if name_query:
        stmt = stmt.where(
            or_(
                col(Player.display_name).ilike(f"%{q}%"),
                col(Player.display_name).ilike(f"%{q_norm}%"),
            )
        )
    if published_only:
        stmt = stmt.where(Player.is_published == True)  # noqa: E712

    if country_text:
        codes = _resolve_country_codes(country_text)
        if not codes:
            return []
        stmt = stmt.where(
            col(Player.id).in_(
                select(PlayerCountry.player_id).where(
                    col(PlayerCountry.code).in_(codes)
                )
            )
        )

    if name_query:
        players = list(session.exec(stmt).all())
        scored = [
            (p, SequenceMatcher(None, q_norm, _normalize(p.display_name)).ratio())
            for p in players
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
    else:
        stmt = stmt.order_by(func.lower(Player.display_name)).limit(limit)
        players = list(session.exec(stmt).all())
        scored = [(p, 0.0) for p in players]

    return scored[:limit]


def search_players_batch(
    *,
    session: Session,
    names: list[str],
    limit: int = 5,
    published_only: bool = False,
) -> dict[str, list[tuple[Player, float]]]:
    """Search many names in one pass: load players once, score in memory.

    Matching and scoring mirror search_players (case-insensitive substring
    match on raw or diacritic-normalized query, ranked by SequenceMatcher
    similarity of normalized names).
    """
    stmt = select(Player)
    if published_only:
        stmt = stmt.where(Player.is_published == True)  # noqa: E712
    players = list(session.exec(stmt).all())
    indexed = [(p, p.display_name.lower(), _normalize(p.display_name)) for p in players]

    results: dict[str, list[tuple[Player, float]]] = {}
    for name in names:
        if name in results:
            continue
        query = name.strip()
        if not query:
            results[name] = []
            continue
        q_lower = query.lower()
        q_norm = _normalize(query)
        scored = [
            (p, SequenceMatcher(None, q_norm, p_norm).ratio())
            for p, p_lower, p_norm in indexed
            if q_lower in p_lower or q_norm in p_lower
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        results[name] = scored[:limit]
    return results


def update_player(
    *, session: Session, db_player: Player, player_in: PlayerUpdate
) -> Player:
    data = player_in.model_dump(exclude_unset=True)
    new_countries = data.pop("countries", None)
    if "slug" in data and data["slug"] is not None:
        existing = get_player_by_slug(session=session, slug=data["slug"])
        if existing and existing.id != db_player.id:
            raise ValueError("Slug already in use")
    db_player.sqlmodel_update(data)
    session.add(db_player)

    if new_countries is not None:
        session.exec(
            delete(PlayerCountry).where(col(PlayerCountry.player_id) == db_player.id)
        )
        for index, code in enumerate(new_countries):
            session.add(
                PlayerCountry(
                    player_id=db_player.id, code=code, is_primary=(index == 0)
                )
            )

    session.commit()
    session.refresh(db_player)
    return db_player


def build_players_public(
    *, session: Session, players: list[Player]
) -> list[PlayerPublic]:
    if not players:
        return []
    ids = [p.id for p in players]
    links = session.exec(
        select(PlayerCountry).where(col(PlayerCountry.player_id).in_(ids))
    ).all()
    by_player: dict[uuid.UUID, list[PlayerCountry]] = {}
    for link in links:
        by_player.setdefault(link.player_id, []).append(link)

    def _countries(player_id: uuid.UUID) -> list[str]:
        player_links = by_player.get(player_id, [])
        primary = [pc.code for pc in player_links if pc.is_primary]
        rest = sorted(pc.code for pc in player_links if not pc.is_primary)
        return primary + rest

    return [
        PlayerPublic(**p.model_dump(), countries=_countries(p.id)) for p in players
    ]


def build_player_public(*, session: Session, player: Player) -> PlayerPublic:
    return build_players_public(session=session, players=[player])[0]


def _partners_by_result(
    *, session: Session, result_ids: list[uuid.UUID], player_id: uuid.UUID
) -> dict[uuid.UUID, list[ResultPartner]]:
    """Every participant of these results except `player_id` themselves."""
    if not result_ids:
        return {}
    rows = session.exec(
        select(QuizResultPlayer, Player)
        .join(Player, col(QuizResultPlayer.player_id) == col(Player.id))
        .where(col(QuizResultPlayer.quiz_result_id).in_(result_ids))
        .where(col(QuizResultPlayer.player_id) != player_id)
        .order_by(col(QuizResultPlayer.slot).asc())
    ).all()
    partners: dict[uuid.UUID, list[ResultPartner]] = {}
    for participant, player in rows:
        partners.setdefault(participant.quiz_result_id, []).append(
            ResultPartner(
                player_id=player.id,
                display_name=player.display_name,
                slug=player.slug,
            )
        )
    return partners


def _primary_countries(
    *, session: Session, player_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """Each player's own primary country from PlayerCountry (or, absent a
    primary, any one of theirs, deterministically by code).

    This is the fallback the pairs-quizzes spec promises for a null
    participant country: "every display falls back to the player's own
    countries from PlayerCountry." One query for however many players are
    asked about, not one per participant.
    """
    if not player_ids:
        return {}
    rows = session.exec(
        select(PlayerCountry)
        .where(col(PlayerCountry.player_id).in_(player_ids))
        .order_by(
            col(PlayerCountry.player_id),
            col(PlayerCountry.is_primary).desc(),
            col(PlayerCountry.code).asc(),
        )
    ).all()
    result: dict[uuid.UUID, str | None] = {}
    for row in rows:
        result.setdefault(row.player_id, row.code)
    return result


def _participant_countries(
    *, session: Session, result_ids: list[uuid.UUID], player_id: uuid.UUID
) -> dict[uuid.UUID, str | None]:
    """This player's own recorded country per result, falling back to their
    own primary PlayerCountry when the participant row's country is null."""
    if not result_ids:
        return {}
    rows = session.exec(
        select(QuizResultPlayer)
        .where(col(QuizResultPlayer.quiz_result_id).in_(result_ids))
        .where(col(QuizResultPlayer.player_id) == player_id)
    ).all()
    fallback: str | None = None
    if any(r.country is None for r in rows):
        fallback = _primary_countries(
            session=session, player_ids=[player_id]
        ).get(player_id)
    return {r.quiz_result_id: r.country or fallback for r in rows}


def build_participants_public(
    *, session: Session, result_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ResultParticipantPublic]]:
    """Every participant of these results, grouped by result id, ready for
    the API. A null participant country falls back to that player's own
    primary country from PlayerCountry (see `_primary_countries`), so this
    is the one place every read path that returns participants should build
    them from — results, player history, and podium all get the fallback by
    construction rather than each reimplementing it.

    One query for the participant rows, one for the fallback countries,
    regardless of how many results are asked about.
    """
    if not result_ids:
        return {}
    rows = session.exec(
        select(QuizResultPlayer, Player)
        .join(Player, col(QuizResultPlayer.player_id) == col(Player.id))
        .where(col(QuizResultPlayer.quiz_result_id).in_(result_ids))
        .order_by(col(QuizResultPlayer.slot).asc())
    ).all()
    fallback = _primary_countries(
        session=session, player_ids=[player.id for _participant, player in rows]
    )
    by_result: dict[uuid.UUID, list[ResultParticipantPublic]] = {}
    for participant, player in rows:
        by_result.setdefault(participant.quiz_result_id, []).append(
            ResultParticipantPublic(
                slot=participant.slot,
                player_id=participant.player_id,
                player_display_name=player.display_name,
                player_slug=player.slug,
                country=participant.country or fallback.get(player.id),
            )
        )
    return by_result


def get_player_history_grouped(
    *, session: Session, player_id: uuid.UUID
) -> PlayerHistoryGrouped:
    stmt = (
        select(QuizResult, Quiz, Competition)
        .join(
            QuizResultPlayer,
            col(QuizResultPlayer.quiz_result_id) == col(QuizResult.id),
        )
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .join(Competition, Quiz.competition_id == Competition.id, isouter=True)
        .where(col(QuizResultPlayer.player_id) == player_id)
        .where(Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    )
    rows = session.exec(stmt).all()

    result_ids = [result.id for result, _quiz, _competition in rows]
    partners = _partners_by_result(
        session=session, result_ids=result_ids, player_id=player_id
    )
    countries = _participant_countries(
        session=session, result_ids=result_ids, player_id=player_id
    )

    groups: dict[uuid.UUID | None, list[PlayerResultWithQuiz]] = {}
    competition_names: dict[uuid.UUID | None, str | None] = {}
    competition_slugs: dict[uuid.UUID | None, str | None] = {}
    wins = 0
    podiums = 0
    for result, quiz, competition in rows:
        key = quiz.competition_id
        groups.setdefault(key, []).append(
            PlayerResultWithQuiz(
                result_id=result.id,
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                quiz_slug=quiz.slug,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                score=result.score,
                final_rank=result.final_rank,
                country=countries.get(result.id),
                competition_id=quiz.competition_id,
                competition_name=competition.name if competition else None,
                partners=partners.get(result.id, []),
            )
        )
        competition_names[key] = competition.name if competition else None
        competition_slugs[key] = competition.slug if competition else None
        if result.final_rank == 1:
            wins += 1
        if result.final_rank is not None and result.final_rank <= 3:
            podiums += 1

    # dict preserves insertion order (newest result first per group);
    # the ungrouped (None) bucket is always placed last.
    ordered_keys = [k for k in groups if k is not None]
    if None in groups:
        ordered_keys.append(None)

    data = [
        PlayerCompetitionGroup(
            competition_id=key,
            competition_name=competition_names[key],
            competition_slug=competition_slugs[key],
            results=groups[key][:5],
            total_count=len(groups[key]),
        )
        for key in ordered_keys
    ]
    return PlayerHistoryGrouped(
        data=data, total_quizzes=len(rows), wins=wins, podiums=podiums
    )


def get_player_competition_history(
    *,
    session: Session,
    player_id: uuid.UUID,
    competition_id: uuid.UUID | None,
    skip: int,
    limit: int,
) -> tuple[list[PlayerResultWithQuiz], int, str | None]:
    base = (
        select(QuizResult, Quiz)
        .join(
            QuizResultPlayer,
            col(QuizResultPlayer.quiz_result_id) == col(QuizResult.id),
        )
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .where(col(QuizResultPlayer.player_id) == player_id)
        .where(Quiz.status == QuizStatus.approved)
    )
    if competition_id is None:
        base = base.where(col(Quiz.competition_id).is_(None))
    else:
        base = base.where(Quiz.competition_id == competition_id)

    count = session.exec(select(func.count()).select_from(base.subquery())).one()

    rows = session.exec(
        base.order_by(col(Quiz.start_date).desc()).offset(skip).limit(limit)
    ).all()

    competition_name: str | None = None
    if competition_id is not None:
        competition = session.get(Competition, competition_id)
        competition_name = competition.name if competition else None

    result_ids = [result.id for result, _quiz in rows]
    partners = _partners_by_result(
        session=session, result_ids=result_ids, player_id=player_id
    )
    countries = _participant_countries(
        session=session, result_ids=result_ids, player_id=player_id
    )

    data = [
        PlayerResultWithQuiz(
            result_id=result.id,
            quiz_id=quiz.id,
            quiz_name=quiz.name,
            quiz_slug=quiz.slug,
            start_date=quiz.start_date,
            end_date=quiz.end_date,
            score=result.score,
            final_rank=result.final_rank,
            country=countries.get(result.id),
            competition_id=quiz.competition_id,
            competition_name=competition_name,
            partners=partners.get(result.id, []),
        )
        for result, quiz in rows
    ]
    return data, count, competition_name


# --- Quiz ---


def create_quiz(
    *, session: Session, quiz_in: QuizCreate, submitted_by_id: uuid.UUID
) -> Quiz:
    # `name` has no min_length, so a name like "---" slugifies to "". Join only the
    # non-empty parts so that case doesn't leave a leading hyphen (e.g. "-2026-03-15");
    # the date alone still guarantees a non-empty, non-user-facing-garbage base.
    # Clamp the name portion (not the whole composed base) so the date never gets
    # truncated off the end.
    name_part = clamp_slug_base(slugify(quiz_in.name))
    base = "-".join(
        part for part in (name_part, quiz_in.start_date.isoformat()) if part
    )
    quiz = Quiz.model_validate(
        quiz_in,
        update={
            "submitted_by_id": submitted_by_id,
            "slug": generate_unique_slug(session=session, model=Quiz, base=base),
        },
    )
    session.add(quiz)
    session.commit()
    session.refresh(quiz)
    return quiz


def update_quiz(
    *, session: Session, db_quiz: Quiz, quiz_in: QuizUpdate
) -> Quiz:
    data = quiz_in.model_dump(exclude_unset=True)
    if data.get("slug") is None:
        data.pop("slug", None)
    if data.get("slug") is not None:
        existing = session.exec(select(Quiz).where(Quiz.slug == data["slug"])).first()
        if existing and existing.id != db_quiz.id:
            raise ValueError("Slug already in use")
    db_quiz.sqlmodel_update(data)
    session.add(db_quiz)
    session.commit()
    session.refresh(db_quiz)
    return db_quiz


def approve_quiz(*, session: Session, db_quiz: Quiz) -> Quiz:
    player_ids = session.exec(
        select(QuizResultPlayer.player_id).where(
            QuizResultPlayer.quiz_id == db_quiz.id
        )
    ).all()
    if player_ids:
        players = session.exec(
            select(Player)
            .where(col(Player.id).in_(player_ids))
            .where(Player.is_published == False)  # noqa: E712
        ).all()
        for player in players:
            player.is_published = True
            session.add(player)
    db_quiz.status = QuizStatus.approved
    session.add(db_quiz)
    session.commit()
    session.refresh(db_quiz)
    return db_quiz


def reject_quiz(*, session: Session, db_quiz: Quiz) -> Quiz:
    db_quiz.status = QuizStatus.rejected
    session.add(db_quiz)
    session.commit()
    session.refresh(db_quiz)
    return db_quiz


def set_quiz_pending(*, session: Session, db_quiz: Quiz) -> Quiz:
    db_quiz.status = QuizStatus.pending
    session.add(db_quiz)
    session.commit()
    session.refresh(db_quiz)
    return db_quiz


def delete_quiz(*, session: Session, db_quiz: Quiz) -> None:
    session.delete(db_quiz)
    session.commit()


# --- QuizResult ---


def _apply_round_scores(result: QuizResult, round_scores: list[float | None]) -> None:
    for i in range(1, 21):
        idx = i - 1
        setattr(result, f"round_{i}", round_scores[idx] if idx < len(round_scores) else None)


def create_quiz_results(
    *,
    session: Session,
    quiz_id: uuid.UUID,
    results: list[QuizResultCreate],
    commit: bool = True,
) -> list[QuizResult]:
    db_results = []
    for r in results:
        existing_ids = {
            pr.quiz_result_id
            for pr in session.exec(
                select(QuizResultPlayer)
                .where(QuizResultPlayer.quiz_id == quiz_id)
                .where(
                    col(QuizResultPlayer.player_id).in_(
                        [p.player_id for p in r.participants]
                    )
                )
            ).all()
        }
        existing = (
            session.get(QuizResult, next(iter(existing_ids)))
            if len(existing_ids) == 1
            else None
        )
        if existing:
            existing.score = r.score
            existing.final_rank = r.final_rank
            if r.round_scores is not None:
                _apply_round_scores(existing, r.round_scores)
            session.add(existing)
            db_results.append(existing)
        else:
            result = QuizResult(
                quiz_id=quiz_id,
                score=r.score,
                final_rank=r.final_rank,
            )
            if r.round_scores is not None:
                _apply_round_scores(result, r.round_scores)
            session.add(result)
            db_results.append(result)
    session.flush()  # results need ids before participants can reference them
    for result, r in zip(db_results, results, strict=True):
        for row in session.exec(
            select(QuizResultPlayer).where(
                QuizResultPlayer.quiz_result_id == result.id
            )
        ).all():
            session.delete(row)
        session.flush()
        for slot, participant in enumerate(r.participants, start=1):
            session.add(
                QuizResultPlayer(
                    quiz_result_id=result.id,
                    slot=slot,
                    quiz_id=quiz_id,
                    player_id=participant.player_id,
                    country=participant.country,
                )
            )
    if commit:
        session.commit()
    else:
        session.flush()
    for result in db_results:
        session.refresh(result)
    return db_results


def delete_player(*, session: Session, db_player: Player) -> None:
    session.delete(db_player)
    session.commit()


_MERGE_FILL_FIELDS = ("city", "club", "bio", "photo_url")


def _is_blank(value: str | None) -> bool:
    return value is None or value == ""


def _result_by_quiz(
    *, session: Session, player_id: uuid.UUID
) -> dict[uuid.UUID, uuid.UUID]:
    """quiz_id -> quiz_result_id for every result this player participates in.

    `UNIQUE (quiz_id, player_id)` on QuizResultPlayer means a player has at
    most one result per quiz, headline or partner, so this is well-defined.
    """
    return {
        r.quiz_id: r.quiz_result_id
        for r in session.exec(
            select(QuizResultPlayer).where(col(QuizResultPlayer.player_id) == player_id)
        ).all()
    }


def _merge_conflicts(
    *, session: Session, source_id: uuid.UUID, target_id: uuid.UUID
) -> list[tuple[QuizResult, QuizResult, Quiz, str]]:
    """(source_result, target_result, quiz, kind) for quizzes both players participate in.

    kind is "same_result" when source and target were partners in one shared
    result (source_result is target_result), or "separate_results" when they
    held two distinct results in the same quiz.
    """
    source_by_quiz = _result_by_quiz(session=session, player_id=source_id)
    if not source_by_quiz:
        return []
    target_by_quiz = _result_by_quiz(session=session, player_id=target_id)
    shared_quiz_ids = set(source_by_quiz) & set(target_by_quiz)
    if not shared_quiz_ids:
        return []
    result_ids = {source_by_quiz[q] for q in shared_quiz_ids} | {
        target_by_quiz[q] for q in shared_quiz_ids
    }
    rows = session.exec(
        select(QuizResult, Quiz)
        .join(Quiz, col(QuizResult.quiz_id) == col(Quiz.id))
        .where(col(QuizResult.id).in_(result_ids))
    ).all()
    results_by_id = {result.id: (result, quiz) for result, quiz in rows}
    conflicts = []
    for quiz_id in shared_quiz_ids:
        source_result, quiz = results_by_id[source_by_quiz[quiz_id]]
        if source_by_quiz[quiz_id] == target_by_quiz[quiz_id]:
            conflicts.append((source_result, source_result, quiz, "same_result"))
        else:
            target_result, _quiz = results_by_id[target_by_quiz[quiz_id]]
            conflicts.append((source_result, target_result, quiz, "separate_results"))
    return conflicts


def _player_country_rows(
    *, session: Session, player_id: uuid.UUID
) -> list[PlayerCountry]:
    return list(
        session.exec(
            select(PlayerCountry).where(col(PlayerCountry.player_id) == player_id)
        ).all()
    )


def preview_merge_players(
    *, session: Session, source: Player, target: Player
) -> MergePlayersPreview:
    conflicts = _merge_conflicts(
        session=session, source_id=source.id, target_id=target.id
    )
    source_participant_count = session.exec(
        select(func.count())
        .select_from(QuizResultPlayer)
        .where(col(QuizResultPlayer.player_id) == source.id)
    ).one()
    filled_fields = [
        f
        for f in _MERGE_FILL_FIELDS
        if _is_blank(getattr(target, f)) and not _is_blank(getattr(source, f))
    ]
    target_codes = {
        pc.code for pc in _player_country_rows(session=session, player_id=target.id)
    }
    added_countries = [
        pc.code
        for pc in _player_country_rows(session=session, player_id=source.id)
        if pc.code not in target_codes
    ]
    return MergePlayersPreview(
        moved_results_count=source_participant_count - len(conflicts),
        conflicts=[
            MergeConflict(
                kind=kind,
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                start_date=quiz.start_date,
                source_score=s.score,
                source_rank=s.final_rank,
                target_score=t.score,
                target_rank=t.final_rank,
            )
            for s, t, quiz, kind in conflicts
        ],
        filled_fields=filled_fields,
        added_countries=added_countries,
    )


def merge_players(
    *, session: Session, source: Player, target: Player, performed_by: User
) -> Player:
    preview = preview_merge_players(session=session, source=source, target=target)
    conflicts = _merge_conflicts(
        session=session, source_id=source.id, target_id=target.id
    )
    conflict_quiz_ids = {quiz.id for _s, _t, quiz, _kind in conflicts}
    # For both kinds, the result to remove is the one source participates
    # in: the shared result itself for same_result, or source's own
    # separate result for separate_results (target's own result is kept).
    for source_result, _target_result, _quiz, _kind in conflicts:
        session.delete(source_result)
    session.flush()
    # Guarded by conflict_quiz_ids defensively, though by now every row for
    # a conflicting quiz has already been cascade-deleted above (autoflush
    # runs before this select), so no remaining source participant row can
    # collide with a target row on UNIQUE (quiz_id, player_id).
    for participant in session.exec(
        select(QuizResultPlayer).where(col(QuizResultPlayer.player_id) == source.id)
    ).all():
        if participant.quiz_id in conflict_quiz_ids:
            continue
        participant.player_id = target.id
        session.add(participant)
    target_codes = {
        pc.code for pc in _player_country_rows(session=session, player_id=target.id)
    }
    for pc in _player_country_rows(session=session, player_id=source.id):
        if pc.code not in target_codes:
            session.add(
                PlayerCountry(player_id=target.id, code=pc.code, is_primary=False)
            )
    for field in preview.filled_fields:
        setattr(target, field, getattr(source, field))
    session.add(target)
    session.add(
        PlayerMergeAudit(
            performed_by_id=performed_by.id,
            performed_by_email=performed_by.email,
            source_player_id=source.id,
            source_display_name=source.display_name,
            source_slug=source.slug,
            target_player_id=target.id,
            target_display_name=target.display_name,
            moved_results_count=preview.moved_results_count,
            deleted_conflicts_count=len(preview.conflicts),
        )
    )
    session.delete(source)
    session.commit()
    session.refresh(target)
    return target


def list_merge_audits(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[PlayerMergeAudit], int]:
    count = session.exec(select(func.count()).select_from(PlayerMergeAudit)).one()
    audits = session.exec(
        select(PlayerMergeAudit)
        .order_by(
            col(PlayerMergeAudit.merged_at).desc(),
            col(PlayerMergeAudit.id).desc(),
        )
        .offset(skip)
        .limit(limit)
    ).all()
    return list(audits), count


def delete_quiz_result(*, session: Session, db_result: QuizResult) -> None:
    session.delete(db_result)
    session.commit()


def update_quiz_result(
    *, session: Session, db_result: QuizResult, result_in: QuizResultUpdate
) -> QuizResult:
    data = result_in.model_dump(exclude_unset=True)
    data.pop("round_scores", None)
    data.pop("participants", None)
    db_result.sqlmodel_update(data)
    if result_in.round_scores is not None:
        _apply_round_scores(db_result, result_in.round_scores)
    if result_in.participants is not None:
        for row in session.exec(
            select(QuizResultPlayer).where(
                col(QuizResultPlayer.quiz_result_id) == db_result.id
            )
        ).all():
            session.delete(row)
        session.flush()
        for slot, participant in enumerate(result_in.participants, start=1):
            session.add(
                QuizResultPlayer(
                    quiz_result_id=db_result.id,
                    slot=slot,
                    quiz_id=db_result.quiz_id,
                    player_id=participant.player_id,
                    country=participant.country,
                )
            )
    session.add(db_result)
    session.commit()
    session.refresh(db_result)
    return db_result


# --- QuizFormat ---


def get_formats(*, session: Session, skip: int = 0, limit: int = 100) -> tuple[list[QuizFormat], int]:
    count = session.exec(select(func.count()).select_from(QuizFormat)).one()
    formats = session.exec(select(QuizFormat).offset(skip).limit(limit)).all()
    return list(formats), count


def get_format(*, session: Session, format_id: uuid.UUID) -> QuizFormat | None:
    return session.get(QuizFormat, format_id)


def create_format(*, session: Session, format_in: QuizFormatCreate) -> QuizFormat:
    db_format = QuizFormat.model_validate(format_in)
    session.add(db_format)
    session.commit()
    session.refresh(db_format)
    return db_format


def update_format(*, session: Session, db_format: QuizFormat, format_in: QuizFormatUpdate) -> QuizFormat:
    update_data = format_in.model_dump(exclude_unset=True)
    db_format.sqlmodel_update(update_data)
    session.add(db_format)
    session.commit()
    session.refresh(db_format)
    return db_format
