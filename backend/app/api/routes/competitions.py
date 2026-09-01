from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Competition,
    CompetitionCreate,
    CompetitionListPublic,
    CompetitionPublic,
    CompetitionUpdate,
    Organization,
    PodiumPublic,
    Quiz,
    QuizStatus,
)
from app.podium import build_podium

router = APIRouter(prefix="/competitions", tags=["competitions"])


def _competition_public(
    competition: Competition, session: Session
) -> CompetitionPublic:
    org = session.get(Organization, competition.organization_id)
    return CompetitionPublic(
        **competition.model_dump(),
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
    )


@router.get("/", response_model=CompetitionListPublic)
def read_competitions(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count = session.exec(select(func.count()).select_from(Competition)).one()
    competition_list = session.exec(select(Competition).offset(skip).limit(limit)).all()
    return CompetitionListPublic(
        data=[_competition_public(c, session) for c in competition_list],
        count=count,
    )


@router.get("/{id}", response_model=CompetitionPublic)
def read_competition(session: SessionDep, id: str) -> Any:
    competition = crud.resolve_by_id_or_slug(session=session, model=Competition, value=id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")
    return _competition_public(competition, session)


@router.get("/{id}/podium", response_model=PodiumPublic)
def read_competition_podium(session: SessionDep, id: str) -> Any:
    competition = crud.resolve_by_id_or_slug(session=session, model=Competition, value=id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    quizzes = session.exec(
        select(Quiz)
        .where(Quiz.competition_id == competition.id, Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    ).all()
    return build_podium(session=session, quizzes=quizzes)


@router.post("/", response_model=CompetitionPublic)
def create_competition(
    *, session: SessionDep, current_user: CurrentUser, competition_in: CompetitionCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if not session.get(Organization, competition_in.organization_id):
        raise HTTPException(status_code=404, detail="Organization not found")
    competition = crud.create_competition(
        session=session, competition_in=competition_in
    )
    return _competition_public(competition, session)


@router.patch("/{id}", response_model=CompetitionPublic)
def update_competition(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: str,
    competition_in: CompetitionUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    competition = crud.resolve_by_id_or_slug(session=session, model=Competition, value=id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")
    if competition_in.organization_id is not None and not session.get(
        Organization, competition_in.organization_id
    ):
        raise HTTPException(status_code=404, detail="Organization not found")
    try:
        competition = crud.update_competition(
            session=session, db_competition=competition, competition_in=competition_in
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _competition_public(competition, session)


@router.delete("/{id}")
def delete_competition(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    competition = crud.resolve_by_id_or_slug(session=session, model=Competition, value=id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")
    crud.delete_competition(session=session, db_competition=competition)
    return {"ok": True}
