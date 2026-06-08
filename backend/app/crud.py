import re
import uuid
from difflib import SequenceMatcher
from typing import Any

from sqlmodel import Session, col, select

from app.core.security import get_password_hash, verify_password
from app.models import (
    EventResult,
    EventResultCreate,
    EventStatus,
    Organization,
    OrganizationCreate,
    OrganizationUpdate,
    Player,
    PlayerCreate,
    PlayerUpdate,
    QuizEvent,
    QuizEventCreate,
    QuizEventUpdate,
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesUpdate,
    User,
    UserCreate,
    UserUpdate,
)


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

def create_organization(*, session: Session, org_in: OrganizationCreate) -> Organization:
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
    db_series.sqlmodel_update(series_in.model_dump(exclude_unset=True))
    session.add(db_series)
    session.commit()
    session.refresh(db_series)
    return db_series


# --- Player ---

def _generate_slug(*, session: Session, display_name: str) -> str:
    base = re.sub(r"[^\w\s-]", "", display_name.lower())
    base = re.sub(r"[\s_]+", "-", base).strip("-")
    slug, counter = base, 2
    while session.exec(select(Player).where(Player.slug == slug)).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def create_player(*, session: Session, player_in: PlayerCreate) -> Player:
    slug = _generate_slug(session=session, display_name=player_in.display_name)
    player = Player.model_validate(player_in, update={"slug": slug})
    session.add(player)
    session.commit()
    session.refresh(player)
    return player


def get_player_by_slug(*, session: Session, slug: str) -> Player | None:
    return session.exec(select(Player).where(Player.slug == slug)).first()


def search_players(
    *, session: Session, q: str, country: str | None = None, limit: int = 5
) -> list[tuple[Player, float]]:
    stmt = select(Player).where(col(Player.display_name).ilike(f"%{q}%"))
    if country:
        stmt = stmt.where(col(Player.country).ilike(f"%{country}%"))
    players = session.exec(stmt).all()
    scored = [
        (p, SequenceMatcher(None, q.lower(), p.display_name.lower()).ratio())
        for p in players
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


def update_player(
    *, session: Session, db_player: Player, player_in: PlayerUpdate
) -> Player:
    data = player_in.model_dump(exclude_unset=True)
    if "slug" in data and data["slug"] is not None:
        existing = get_player_by_slug(session=session, slug=data["slug"])
        if existing and existing.id != db_player.id:
            raise ValueError("Slug already in use")
    db_player.sqlmodel_update(data)
    session.add(db_player)
    session.commit()
    session.refresh(db_player)
    return db_player


def get_player_history(
    *, session: Session, player_id: uuid.UUID
) -> list[tuple[EventResult, QuizEvent]]:
    stmt = (
        select(EventResult, QuizEvent)
        .join(QuizEvent, EventResult.event_id == QuizEvent.id)
        .where(EventResult.player_id == player_id)
        .where(QuizEvent.status == EventStatus.approved)
        .order_by(col(QuizEvent.start_date).desc())
    )
    return session.exec(stmt).all()


# --- QuizEvent ---

def create_event(
    *, session: Session, event_in: QuizEventCreate, submitted_by_id: uuid.UUID
) -> QuizEvent:
    event = QuizEvent.model_validate(event_in, update={"submitted_by_id": submitted_by_id})
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def update_event(
    *, session: Session, db_event: QuizEvent, event_in: QuizEventUpdate
) -> QuizEvent:
    db_event.sqlmodel_update(event_in.model_dump(exclude_unset=True))
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


def _recompute_ranks(*, session: Session, event_id: uuid.UUID) -> None:
    results = session.exec(
        select(EventResult)
        .where(EventResult.event_id == event_id)
        .order_by(EventResult.score.desc(), EventResult.tiebreaker_rank.asc())
    ).all()
    for rank, result in enumerate(results, start=1):
        result.final_rank = rank
        session.add(result)
    session.commit()


def approve_event(*, session: Session, db_event: QuizEvent) -> QuizEvent:
    _recompute_ranks(session=session, event_id=db_event.id)
    player_ids = session.exec(
        select(EventResult.player_id).where(EventResult.event_id == db_event.id)
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
    db_event.status = EventStatus.approved
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


# --- EventResult ---

def create_event_results(
    *, session: Session, event_id: uuid.UUID, results: list[EventResultCreate]
) -> list[EventResult]:
    db_results = []
    for r in results:
        existing = session.exec(
            select(EventResult)
            .where(EventResult.event_id == event_id)
            .where(EventResult.player_id == r.player_id)
        ).first()
        if existing:
            existing.score = r.score
            existing.tiebreaker_rank = r.tiebreaker_rank
            session.add(existing)
            db_results.append(existing)
        else:
            result = EventResult(
                event_id=event_id,
                player_id=r.player_id,
                score=r.score,
                tiebreaker_rank=r.tiebreaker_rank,
            )
            session.add(result)
            db_results.append(result)
    session.commit()
    _recompute_ranks(session=session, event_id=event_id)
    for result in db_results:
        session.refresh(result)
    return db_results


def delete_event_result(*, session: Session, db_result: EventResult) -> None:
    event_id = db_result.event_id
    session.delete(db_result)
    session.commit()
    _recompute_ranks(session=session, event_id=event_id)


def update_event_result(
    *, session: Session, db_result: EventResult, result_in: EventResultCreate
) -> EventResult:
    data = result_in.model_dump(exclude_unset=True)
    db_result.sqlmodel_update(data)
    session.add(db_result)
    session.commit()
    _recompute_ranks(session=session, event_id=db_result.event_id)
    session.refresh(db_result)
    return db_result
