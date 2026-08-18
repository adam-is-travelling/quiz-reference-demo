import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Competition,
    CompetitionCreate,
    CompetitionListPublic,
    CompetitionPodiumPublic,
    CompetitionPublic,
    CompetitionUpdate,
    Organization,
    Player,
    PodiumFinisher,
    PodiumStanding,
    Quiz,
    QuizPodium,
    QuizResult,
    QuizStatus,
)

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


@router.get("/{id}/podium", response_model=CompetitionPodiumPublic)
def read_competition_podium(session: SessionDep, id: str) -> Any:
    competition = crud.resolve_by_id_or_slug(session=session, model=Competition, value=id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    quizzes = session.exec(
        select(Quiz)
        .where(Quiz.competition_id == competition.id, Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    ).all()

    quiz_podiums: list[QuizPodium] = []
    tally: dict[uuid.UUID, PodiumStanding] = {}

    for quiz in quizzes:
        rows = session.exec(
            select(QuizResult, Player)
            .join(Player, QuizResult.player_id == Player.id)
            .where(
                QuizResult.quiz_id == quiz.id,
                col(QuizResult.final_rank).in_([1, 2, 3]),
            )
            .order_by(col(QuizResult.final_rank).asc())
        ).all()

        finishers = [
            PodiumFinisher(
                place=result.final_rank,  # non-null: filtered to 1/2/3
                player_id=result.player_id,
                player_display_name=player.display_name,
                player_slug=player.slug,
                score=result.score,
                country=result.country,
            )
            for result, player in rows
        ]
        quiz_podiums.append(
            QuizPodium(
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                quiz_slug=quiz.slug,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                finishers=finishers,
            )
        )

        for result, player in rows:
            standing = tally.get(result.player_id)
            if standing is None:
                standing = PodiumStanding(
                    player_id=result.player_id,
                    player_display_name=player.display_name,
                    player_slug=player.slug,
                    gold=0,
                    silver=0,
                    bronze=0,
                )
                tally[result.player_id] = standing
            if result.final_rank == 1:
                standing.gold += 1
            elif result.final_rank == 2:
                standing.silver += 1
            elif result.final_rank == 3:
                standing.bronze += 1

    standings = sorted(
        tally.values(),
        key=lambda s: (
            -s.gold,
            -s.silver,
            -s.bronze,
            s.player_display_name.lower(),
        ),
    )
    return CompetitionPodiumPublic(quizzes=quiz_podiums, standings=standings)


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
