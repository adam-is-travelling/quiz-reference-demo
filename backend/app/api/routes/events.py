import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app import crud
from app.api.deps import CurrentOrganizer, CurrentSuperuser, CurrentUser, OptionalCurrentUser, SessionDep
from app.models import (
    EventResult,
    EventResultCreate,
    EventResultPublic,
    EventResultsPublic,
    EventResultUpdate,
    EventResultWithPlayer,
    EventResultsWithPlayersPublic,
    EventStatus,
    ParsedResultWithCandidates,
    ParseResultsRequest,
    ParseResultsResponse,
    Player,
    PlayerPublic,
    PlayerSearchResult,
    QuizEvent,
    QuizEventCreate,
    QuizEventPublic,
    QuizEventsPublic,
    QuizEventUpdate,
    SubmitMode,
    SubmitResultsRequest,
)

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/", response_model=QuizEventsPublic)
def read_events(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: EventStatus | None = None,
    series_id: uuid.UUID | None = None,
) -> Any:
    is_superuser = current_user is not None and current_user.is_superuser
    effective_status = status if (is_superuser and status) else EventStatus.approved

    filters = [QuizEvent.status == effective_status]
    if series_id:
        filters.append(QuizEvent.series_id == series_id)

    count = session.exec(
        select(func.count()).select_from(QuizEvent).where(*filters)
    ).one()
    events = session.exec(
        select(QuizEvent)
        .where(*filters)
        .order_by(col(QuizEvent.start_date).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return QuizEventsPublic(data=events, count=count)


@router.get("/{id}", response_model=QuizEventPublic)
def read_event(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != EventStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/", response_model=QuizEventPublic)
def create_event(
    *, session: SessionDep, current_user: CurrentOrganizer, event_in: QuizEventCreate
) -> Any:
    return crud.create_event(
        session=session, event_in=event_in, submitted_by_id=current_user.id
    )


@router.patch("/{id}", response_model=QuizEventPublic)
def update_event(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    event_in: QuizEventUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return crud.update_event(session=session, db_event=event, event_in=event_in)


@router.post("/{id}/approve", response_model=QuizEventPublic)
def approve_event(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending events can be approved")
    return crud.approve_event(session=session, db_event=event)


@router.post("/{id}/reject", response_model=QuizEventPublic)
def reject_event(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending events can be rejected")
    return crud.reject_event(session=session, db_event=event)


@router.post("/{id}/set-pending", response_model=QuizEventPublic)
def set_event_pending(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.rejected:
        raise HTTPException(status_code=400, detail="Only rejected events can be returned to pending")
    return crud.set_event_pending(session=session, db_event=event)


@router.get("/{id}/results", response_model=EventResultsPublic)
def read_event_results(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != EventStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    results = session.exec(
        select(EventResult)
        .where(EventResult.event_id == id)
        .order_by(EventResult.final_rank.asc(), EventResult.score.desc())
    ).all()
    return EventResultsPublic(data=results, count=len(results))


@router.get("/{id}/results/with-players", response_model=EventResultsWithPlayersPublic)
def read_event_results_with_players(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != EventStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Event not found")
    rows = session.exec(
        select(EventResult, Player)
        .join(Player, EventResult.player_id == Player.id)
        .where(EventResult.event_id == id)
        .order_by(EventResult.final_rank.asc(), EventResult.score.desc())
    ).all()
    data = [
        EventResultWithPlayer(
            id=r.id,
            event_id=r.event_id,
            player_id=r.player_id,
            player_display_name=p.display_name,
            player_slug=p.slug,
            score=r.score,
            final_rank=r.final_rank,
        )
        for r, p in rows
    ]
    return EventResultsWithPlayersPublic(data=data, count=len(data))


@router.post("/{id}/results/parse", response_model=ParseResultsResponse)
def parse_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: ParseResultsRequest,
) -> Any:
    if not session.get(QuizEvent, id):
        raise HTTPException(status_code=404, detail="Event not found")
    results = []
    for row in request.rows:
        scored = crud.search_players(
            session=session, q=row.player_name, country=row.country
        )
        candidates = [
            PlayerSearchResult(player=PlayerPublic.model_validate(p), similarity=s)
            for p, s in scored
        ]
        results.append(ParsedResultWithCandidates(row=row, candidates=candidates))
    return ParseResultsResponse(results=results)


@router.post("/{id}/results", response_model=EventResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: SubmitResultsRequest,
) -> Any:
    event = session.get(QuizEvent, id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if request.mode == SubmitMode.replace:
        existing = session.exec(select(EventResult).where(EventResult.event_id == id)).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[EventResultCreate] = []
    for row in request.results:
        if row.player_id:
            player_id = row.player_id
        elif row.player_create:
            player = crud.create_player(session=session, player_in=row.player_create)
            player_id = player.id
        else:
            raise HTTPException(
                status_code=400,
                detail="Each result row must supply player_id or player_create",
            )
        creates.append(
            EventResultCreate(
                player_id=player_id,
                score=row.score,
            )
        )
    crud.create_event_results(
        session=session, event_id=id, results=creates
    )
    # Fetch all results for this event to return the complete list
    all_results = session.exec(
        select(EventResult).where(EventResult.event_id == id)
    ).all()
    return EventResultsPublic(data=all_results, count=len(all_results))


@router.delete("/{id}/results/{result_id}")
def delete_event_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    result_id: uuid.UUID,
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    result = session.get(EventResult, result_id)
    if not result or result.event_id != id:
        raise HTTPException(status_code=404, detail="Result not found")
    crud.delete_event_result(session=session, db_result=result)
    return {"message": "Result deleted successfully"}


@router.patch("/{event_id}/results/{result_id}", response_model=EventResultPublic)
def update_event_result(
    *,
    event_id: uuid.UUID,
    result_id: uuid.UUID,
    result_in: EventResultUpdate,
    session: SessionDep,
    current_user: CurrentSuperuser,
) -> Any:
    db_result = session.get(EventResult, result_id)
    if not db_result or db_result.event_id != event_id:
        raise HTTPException(status_code=404, detail="Event result not found")
    return crud.update_event_result(session=session, db_result=db_result, result_in=result_in)
