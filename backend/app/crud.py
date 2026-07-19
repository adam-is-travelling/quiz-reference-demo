import re
import unicodedata
import uuid
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import func, or_
from sqlmodel import Session, col, delete, select

from app.core.security import get_password_hash, verify_password
from app.countries import COUNTRY_NAMES
from app.models import (
    MergeConflict,
    MergePlayersPreview,
    Organization,
    OrganizationCreate,
    OrganizationUpdate,
    Player,
    PlayerCountry,
    PlayerCreate,
    PlayerMergeAudit,
    PlayerPublic,
    PlayerUpdate,
    Quiz,
    QuizCreate,
    QuizFormat,
    QuizFormatCreate,
    QuizFormatUpdate,
    QuizResult,
    QuizResultCreate,
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesUpdate,
    QuizStatus,
    QuizUpdate,
    User,
    UserCreate,
    UserUpdate,
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
    org = Organization.model_validate(org_in)
    session.add(org)
    session.commit()
    session.refresh(org)
    return org


def update_organization(
    *, session: Session, db_org: Organization, org_in: OrganizationUpdate
) -> Organization:
    db_org.sqlmodel_update(org_in.model_dump(exclude_unset=True))
    session.add(db_org)
    session.commit()
    session.refresh(db_org)
    return db_org


# --- QuizSeries ---


def create_series(*, session: Session, series_in: QuizSeriesCreate) -> QuizSeries:
    series = QuizSeries.model_validate(series_in)
    session.add(series)
    session.commit()
    session.refresh(series)
    return series


def update_series(
    *, session: Session, db_series: QuizSeries, series_in: QuizSeriesUpdate
) -> QuizSeries:
    update_data = series_in.model_dump(exclude_unset=True)
    if update_data.get("organization_id") is None:
        update_data.pop("organization_id", None)
    db_series.sqlmodel_update(update_data)
    session.add(db_series)
    session.commit()
    session.refresh(db_series)
    return db_series


def delete_series(*, session: Session, db_series: QuizSeries) -> None:
    session.delete(db_series)
    session.commit()


# --- Player ---


def _generate_slug(*, session: Session, display_name: str) -> str:
    base = re.sub(r"[^\w\s-]", "", display_name.lower())
    base = re.sub(r"[\s_]+", "-", base).strip("-")
    slug, counter = base, 2
    while session.exec(select(Player).where(Player.slug == slug)).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def _normalize(s: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def create_player(
    *, session: Session, player_in: PlayerCreate, commit: bool = True
) -> Player:
    slug = _generate_slug(session=session, display_name=player_in.display_name)
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


def get_player_history(
    *, session: Session, player_id: uuid.UUID
) -> list[tuple[QuizResult, Quiz]]:
    stmt = (
        select(QuizResult, Quiz)
        .join(Quiz, QuizResult.quiz_id == Quiz.id)
        .where(QuizResult.player_id == player_id)
        .where(Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    )
    return session.exec(stmt).all()


# --- Quiz ---


def create_quiz(
    *, session: Session, event_in: QuizCreate, submitted_by_id: uuid.UUID
) -> Quiz:
    event = Quiz.model_validate(
        event_in, update={"submitted_by_id": submitted_by_id}
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def update_quiz(
    *, session: Session, db_event: Quiz, event_in: QuizUpdate
) -> Quiz:
    db_event.sqlmodel_update(event_in.model_dump(exclude_unset=True))
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def approve_quiz(*, session: Session, db_event: Quiz) -> Quiz:
    player_ids = session.exec(
        select(QuizResult.player_id).where(QuizResult.quiz_id == db_event.id)
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
    db_event.status = QuizStatus.approved
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def reject_quiz(*, session: Session, db_event: Quiz) -> Quiz:
    db_event.status = QuizStatus.rejected
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def set_quiz_pending(*, session: Session, db_event: Quiz) -> Quiz:
    db_event.status = QuizStatus.pending
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def delete_quiz(*, session: Session, db_event: Quiz) -> None:
    session.delete(db_event)
    session.commit()


# --- QuizResult ---


def _apply_round_scores(result: QuizResult, round_scores: list[float | None]) -> None:
    for i in range(1, 21):
        idx = i - 1
        setattr(result, f"round_{i}", round_scores[idx] if idx < len(round_scores) else None)


def create_quiz_results(
    *,
    session: Session,
    event_id: uuid.UUID,
    results: list[QuizResultCreate],
    commit: bool = True,
) -> list[QuizResult]:
    db_results = []
    for r in results:
        existing = session.exec(
            select(QuizResult)
            .where(QuizResult.quiz_id == event_id)
            .where(QuizResult.player_id == r.player_id)
        ).first()
        if existing:
            existing.score = r.score
            existing.final_rank = r.final_rank
            if r.country is not None:
                existing.country = r.country
            if r.round_scores is not None:
                _apply_round_scores(existing, r.round_scores)
            session.add(existing)
            db_results.append(existing)
        else:
            result = QuizResult(
                quiz_id=event_id,
                player_id=r.player_id,
                score=r.score,
                final_rank=r.final_rank,
                country=r.country,
            )
            if r.round_scores is not None:
                _apply_round_scores(result, r.round_scores)
            session.add(result)
            db_results.append(result)
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


def _merge_conflicts(
    *, session: Session, source_id: uuid.UUID, target_id: uuid.UUID
) -> list[tuple[QuizResult, QuizResult, Quiz]]:
    """(source_result, target_result, quiz) for quizzes where both players have results."""
    source_rows = session.exec(
        select(QuizResult, Quiz)
        .join(Quiz, col(QuizResult.quiz_id) == col(Quiz.id))
        .where(col(QuizResult.player_id) == source_id)
    ).all()
    conflicts = []
    for source_result, quiz in source_rows:
        target_result = session.exec(
            select(QuizResult)
            .where(col(QuizResult.quiz_id) == quiz.id)
            .where(col(QuizResult.player_id) == target_id)
        ).first()
        if target_result is not None:
            conflicts.append((source_result, target_result, quiz))
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
    source_result_count = session.exec(
        select(func.count())
        .select_from(QuizResult)
        .where(col(QuizResult.player_id) == source.id)
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
        moved_results_count=source_result_count - len(conflicts),
        conflicts=[
            MergeConflict(
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                start_date=quiz.start_date,
                source_score=s.score,
                source_rank=s.final_rank,
                target_score=t.score,
                target_rank=t.final_rank,
            )
            for s, t, quiz in conflicts
        ],
        filled_fields=filled_fields,
        added_countries=added_countries,
    )


def merge_players(
    *, session: Session, source: Player, target: Player, performed_by: User
) -> Player:
    preview = preview_merge_players(session=session, source=source, target=target)
    conflict_quiz_ids = {c.quiz_id for c in preview.conflicts}
    for result in session.exec(
        select(QuizResult).where(col(QuizResult.player_id) == source.id)
    ).all():
        if result.quiz_id in conflict_quiz_ids:
            session.delete(result)
        else:
            result.player_id = target.id
            session.add(result)
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
    *, session: Session, db_result: QuizResult, result_in: QuizResultCreate
) -> QuizResult:
    data = result_in.model_dump(exclude_unset=True)
    data.pop("round_scores", None)
    db_result.sqlmodel_update(data)
    if result_in.round_scores is not None:
        _apply_round_scores(db_result, result_in.round_scores)
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
