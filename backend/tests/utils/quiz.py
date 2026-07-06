import uuid
from datetime import date

from sqlmodel import Session

from app import crud
from app.models import (
    Organization,
    OrganizationCreate,
    Player,
    PlayerCreate,
    Quiz,
    QuizCreate,
    QuizFormat,
    QuizFormatCreate,
    QuizSeries,
    QuizSeriesCreate,
    QuizStatus,
)
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string


def create_random_format(db: Session, num_rounds: int = 3) -> QuizFormat:
    rounds = [f"Round {i + 1}" for i in range(num_rounds)]
    format_in = QuizFormatCreate(
        name=f"Test Format {random_lower_string()}",
        rounds=rounds,
    )
    return crud.create_format(session=db, format_in=format_in)


def create_random_organization(db: Session) -> Organization:
    return crud.create_organization(
        session=db,
        org_in=OrganizationCreate(name=random_lower_string()),
    )


def create_random_series(
    db: Session, organization_id: uuid.UUID | None = None
) -> QuizSeries:
    if organization_id is None:
        organization_id = create_random_organization(db).id
    return crud.create_series(
        session=db,
        series_in=QuizSeriesCreate(
            name=random_lower_string(), organization_id=organization_id
        ),
    )


def create_random_player(db: Session) -> Player:
    return crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=random_lower_string(), countries=["IE"]
        ),
    )


def create_published_player(db: Session) -> Player:
    player = create_random_player(db)
    player.is_published = True
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


def create_random_event(
    db: Session, submitted_by_id: uuid.UUID | None = None
) -> Quiz:
    if submitted_by_id is None:
        user = create_random_user(db)
        submitted_by_id = user.id
    return crud.create_quiz(
        session=db,
        event_in=QuizCreate(
            name=random_lower_string(),
            start_date=date(2024, 1, 1),
            end_date=date(2024, 1, 1),
        ),
        submitted_by_id=submitted_by_id,
    )


def create_approved_event(db: Session) -> Quiz:
    event = create_random_event(db)
    event.status = QuizStatus.approved
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def create_rejected_event(db: Session) -> Quiz:
    event = create_random_event(db)
    event.status = QuizStatus.rejected
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
