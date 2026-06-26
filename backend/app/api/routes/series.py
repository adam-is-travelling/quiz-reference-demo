import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, func, select

from app.api.deps import CurrentUser, SessionDep
from app import crud
from app.models import (
    Organization,
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesListPublic,
    QuizSeriesPublic,
    QuizSeriesUpdate,
)

router = APIRouter(prefix="/series", tags=["series"])


def _series_public(series: QuizSeries, session: Session) -> QuizSeriesPublic:
    org = session.get(Organization, series.organization_id) if series.organization_id else None
    return QuizSeriesPublic(
        **series.model_dump(),
        organization_name=org.name if org else None,
    )


@router.get("/", response_model=QuizSeriesListPublic)
def read_series(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(QuizSeries)).one()
    series_list = session.exec(select(QuizSeries).offset(skip).limit(limit)).all()
    return QuizSeriesListPublic(
        data=[_series_public(s, session) for s in series_list],
        count=count,
    )


@router.get("/{id}", response_model=QuizSeriesPublic)
def read_series_item(session: SessionDep, id: uuid.UUID) -> Any:
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return _series_public(series, session)


@router.post("/", response_model=QuizSeriesPublic)
def create_series(
    *, session: SessionDep, current_user: CurrentUser, series_in: QuizSeriesCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = crud.create_series(session=session, series_in=series_in)
    return _series_public(series, session)


@router.patch("/{id}", response_model=QuizSeriesPublic)
def update_series(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    series_in: QuizSeriesUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    series = crud.update_series(session=session, db_series=series, series_in=series_in)
    return _series_public(series, session)


@router.delete("/{id}")
def delete_series(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    crud.delete_series(session=session, db_series=series)
    return {"ok": True}
