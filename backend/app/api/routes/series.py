import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Organization,
    Player,
    PodiumFinisher,
    PodiumStanding,
    Quiz,
    QuizResult,
    QuizSeries,
    QuizSeriesCreate,
    QuizSeriesListPublic,
    QuizSeriesPublic,
    QuizSeriesUpdate,
    QuizStatus,
    SeriesEventPodium,
    SeriesPodiumPublic,
)

router = APIRouter(prefix="/series", tags=["series"])


def _series_public(series: QuizSeries, session: Session) -> QuizSeriesPublic:
    org = session.get(Organization, series.organization_id)
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


@router.get("/{id}/podium", response_model=SeriesPodiumPublic)
def read_series_podium(session: SessionDep, id: uuid.UUID) -> Any:
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    events = session.exec(
        select(Quiz)
        .where(Quiz.series_id == id, Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    ).all()

    event_podiums: list[SeriesEventPodium] = []
    tally: dict[uuid.UUID, PodiumStanding] = {}

    for event in events:
        rows = session.exec(
            select(QuizResult, Player)
            .join(Player, QuizResult.player_id == Player.id)
            .where(
                QuizResult.quiz_id == event.id,
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
        event_podiums.append(
            SeriesEventPodium(
                quiz_id=event.id,
                quiz_name=event.name,
                start_date=event.start_date,
                end_date=event.end_date,
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
    return SeriesPodiumPublic(events=event_podiums, standings=standings)


@router.post("/", response_model=QuizSeriesPublic)
def create_series(
    *, session: SessionDep, current_user: CurrentUser, series_in: QuizSeriesCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if not session.get(Organization, series_in.organization_id):
        raise HTTPException(status_code=404, detail="Organization not found")
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
    if series_in.organization_id is not None and not session.get(
        Organization, series_in.organization_id
    ):
        raise HTTPException(status_code=404, detail="Organization not found")
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
