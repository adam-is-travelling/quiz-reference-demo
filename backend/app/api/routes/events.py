from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Event,
    EventCreate,
    EventListPublic,
    EventPublic,
    EventUpdate,
    EventValidationError,
    Organization,
    PodiumPublic,
    Quiz,
    QuizStatus,
)
from app.podium import build_podium

router = APIRouter(prefix="/events", tags=["events"])


def _event_public(event: Event, session: Session) -> EventPublic:
    org = session.get(Organization, event.organization_id)
    quiz_count = session.exec(
        select(func.count())
        .select_from(Quiz)
        .where(Quiz.event_id == event.id, Quiz.status == QuizStatus.approved)
    ).one()
    return EventPublic(
        **event.model_dump(),
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
        quiz_count=quiz_count,
    )


@router.get("/", response_model=EventListPublic)
def read_events(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count = session.exec(select(func.count()).select_from(Event)).one()
    events = session.exec(
        select(Event).order_by(col(Event.start_date).desc()).offset(skip).limit(limit)
    ).all()
    return EventListPublic(
        data=[_event_public(e, session) for e in events], count=count
    )


@router.get("/{id}", response_model=EventPublic)
def read_event(session: SessionDep, id: str) -> Any:
    event = crud.resolve_by_id_or_slug(session=session, model=Event, value=id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return _event_public(event, session)


@router.get("/{id}/podium", response_model=PodiumPublic)
def read_event_podium(session: SessionDep, id: str) -> Any:
    event = crud.resolve_by_id_or_slug(session=session, model=Event, value=id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    quizzes = session.exec(
        select(Quiz)
        .where(Quiz.event_id == event.id, Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    ).all()
    return build_podium(session=session, quizzes=quizzes)


@router.post("/", response_model=EventPublic)
def create_event(
    *, session: SessionDep, current_user: CurrentUser, event_in: EventCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if not session.get(Organization, event_in.organization_id):
        raise HTTPException(status_code=404, detail="Organization not found")
    event = crud.create_event(session=session, event_in=event_in)
    return _event_public(event, session)


@router.patch("/{id}", response_model=EventPublic)
def update_event(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: str,
    event_in: EventUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = crud.resolve_by_id_or_slug(session=session, model=Event, value=id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event_in.organization_id is not None and not session.get(
        Organization, event_in.organization_id
    ):
        raise HTTPException(status_code=404, detail="Organization not found")
    try:
        event = crud.update_event(session=session, db_event=event, event_in=event_in)
    except EventValidationError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _event_public(event, session)


@router.delete("/{id}")
def delete_event(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = crud.resolve_by_id_or_slug(session=session, model=Event, value=id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    crud.delete_event(session=session, db_event=event)
    return {"ok": True}
