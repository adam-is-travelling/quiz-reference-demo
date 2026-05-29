import uuid
from datetime import date

from sqlmodel import Session

from app import crud
from app.models import (
    EventStatus,
    Organization,
    OrganizationCreate,
    Player,
    PlayerCreate,
    QuizEvent,
    QuizEventCreate,
    QuizSeries,
    QuizSeriesCreate,
)
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string


def create_random_organization(db: Session) -> Organization:
    return crud.create_organization(
        session=db,
        org_in=OrganizationCreate(name=random_lower_string()),
    )


def create_random_series(
    db: Session, organization_id: uuid.UUID | None = None
) -> QuizSeries:
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
            display_name=random_lower_string(), country="IE"
        ),
    )


def create_random_event(
    db: Session, submitted_by_id: uuid.UUID | None = None
) -> QuizEvent:
    if submitted_by_id is None:
        user = create_random_user(db)
        submitted_by_id = user.id
    return crud.create_event(
        session=db,
        event_in=QuizEventCreate(
            name=random_lower_string(),
            start_date=date(2024, 1, 1),
            end_date=date(2024, 1, 1),
            organizer_name=random_lower_string(),
        ),
        submitted_by_id=submitted_by_id,
    )


def create_approved_event(db: Session) -> QuizEvent:
    event = create_random_event(db)
    event.status = EventStatus.approved
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
