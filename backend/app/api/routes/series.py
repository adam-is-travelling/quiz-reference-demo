from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Event,
    Organization,
    PodiumPublic,
    Quiz,
    QuizStatus,
    RecurringSeries,
    RecurringSeriesCreate,
    RecurringSeriesListPublic,
    RecurringSeriesPublic,
    RecurringSeriesType,
    RecurringSeriesUpdate,
)
from app.podium import build_podium

router = APIRouter(prefix="/series", tags=["series"])


def _series_public(series: RecurringSeries, session: Session) -> RecurringSeriesPublic:
    org = session.get(Organization, series.organization_id)
    return RecurringSeriesPublic(
        **series.model_dump(),
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
    )


@router.get("/", response_model=RecurringSeriesListPublic)
def read_series_list(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
    series_type: RecurringSeriesType | None = Query(default=None, alias="type"),
) -> Any:
    filters = []
    if series_type is not None:
        filters.append(RecurringSeries.type == series_type)
    count = session.exec(
        select(func.count()).select_from(RecurringSeries).where(*filters)
    ).one()
    series_list = session.exec(
        select(RecurringSeries)
        .where(*filters)
        .order_by(func.lower(RecurringSeries.name), col(RecurringSeries.id))
        .offset(skip)
        .limit(limit)
    ).all()
    return RecurringSeriesListPublic(
        data=[_series_public(s, session) for s in series_list],
        count=count,
    )


@router.get("/{id}", response_model=RecurringSeriesPublic)
def read_series(session: SessionDep, id: str) -> Any:
    series = crud.resolve_by_id_or_slug(
        session=session, model=RecurringSeries, value=id
    )
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return _series_public(series, session)


@router.get("/{id}/podium", response_model=PodiumPublic)
def read_series_podium(session: SessionDep, id: str) -> Any:
    series = crud.resolve_by_id_or_slug(
        session=session, model=RecurringSeries, value=id
    )
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    if series.type == RecurringSeriesType.event:
        # An event series' quizzes are the ones held at any of its editions.
        edition_quizzes = select(Quiz).join(Event, Quiz.event_id == Event.id).where(
            Event.series_id == series.id
        )
    else:
        edition_quizzes = select(Quiz).where(Quiz.series_id == series.id)
    quizzes = session.exec(
        edition_quizzes.where(Quiz.status == QuizStatus.approved)
        # Series history reads as a chronology: earliest quiz first.
        .order_by(col(Quiz.start_date).asc())
    ).all()
    return build_podium(session=session, quizzes=quizzes)


@router.post("/", response_model=RecurringSeriesPublic)
def create_series(
    *, session: SessionDep, current_user: CurrentUser, series_in: RecurringSeriesCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if not session.get(Organization, series_in.organization_id):
        raise HTTPException(status_code=404, detail="Organization not found")
    series = crud.create_series(session=session, series_in=series_in)
    return _series_public(series, session)


@router.patch("/{id}", response_model=RecurringSeriesPublic)
def update_series(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: str,
    series_in: RecurringSeriesUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = crud.resolve_by_id_or_slug(
        session=session, model=RecurringSeries, value=id
    )
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    if series_in.organization_id is not None and not session.get(
        Organization, series_in.organization_id
    ):
        raise HTTPException(status_code=404, detail="Organization not found")
    try:
        series = crud.update_series(
            session=session, db_series=series, series_in=series_in
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _series_public(series, session)


@router.delete("/{id}")
def delete_series(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = crud.resolve_by_id_or_slug(
        session=session, model=RecurringSeries, value=id
    )
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    crud.delete_series(session=session, db_series=series)
    return {"ok": True}
