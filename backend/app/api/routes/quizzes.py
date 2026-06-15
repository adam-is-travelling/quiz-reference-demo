import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import CurrentOrganizer, CurrentSuperuser, CurrentUser, OptionalCurrentUser, SessionDep
from app.models import (
    QuizResult,
    QuizResultCreate,
    QuizResultPublic,
    QuizResultsPublic,
    QuizResultUpdate,
    QuizResultWithPlayer,
    QuizResultsWithPlayersPublic,
    QuizStatus,
    ParsedResultWithCandidates,
    ParseResultsRequest,
    ParseResultsResponse,
    Player,
    PlayerPublic,
    PlayerSearchResult,
    Quiz,
    QuizCreate,
    QuizPublic,
    QuizzesPublic,
    QuizUpdate,
    QuizFormat,
    QuizFormatPublic,
    SubmitMode,
    SubmitResultsRequest,
)

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


def _get_round_scores(result: QuizResult, num_rounds: int) -> list[float | None] | None:
    if num_rounds == 0:
        return None
    return [getattr(result, f"round_{i}") for i in range(1, num_rounds + 1)]


def _quiz_public(event: Quiz, session: Session) -> QuizPublic:
    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    return QuizPublic(
        **event.model_dump(exclude={"format"}),
        format=QuizFormatPublic.model_validate(fmt) if fmt else None,
    )


@router.get("/", response_model=QuizzesPublic)
def read_quizzes(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: QuizStatus | None = None,
    series_id: uuid.UUID | None = None,
) -> Any:
    is_superuser = current_user is not None and current_user.is_superuser
    effective_status = status if (is_superuser and status) else QuizStatus.approved

    filters = [Quiz.status == effective_status]
    if series_id:
        filters.append(Quiz.series_id == series_id)

    count = session.exec(
        select(func.count()).select_from(Quiz).where(*filters)
    ).one()
    events = session.exec(
        select(Quiz)
        .where(*filters)
        .order_by(col(Quiz.start_date).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return QuizzesPublic(data=[_quiz_public(e, session) for e in events], count=count)


@router.get("/{id}", response_model=QuizPublic)
def read_quiz(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != QuizStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return _quiz_public(event, session)


@router.post("/", response_model=QuizPublic)
def create_quiz(
    *, session: SessionDep, current_user: CurrentOrganizer, event_in: QuizCreate
) -> Any:
    event = crud.create_quiz(
        session=session, event_in=event_in, submitted_by_id=current_user.id
    )
    return _quiz_public(event, session)


@router.patch("/{id}", response_model=QuizPublic)
def update_quiz(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    event_in: QuizUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    updated = crud.update_quiz(session=session, db_event=event, event_in=event_in)
    return _quiz_public(updated, session)


@router.post("/{id}/approve", response_model=QuizPublic)
def approve_quiz(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if event.status != QuizStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending quizzes can be approved")
    approved = crud.approve_quiz(session=session, db_event=event)
    return _quiz_public(approved, session)


@router.post("/{id}/reject", response_model=QuizPublic)
def reject_quiz(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if event.status != QuizStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending quizzes can be rejected")
    rejected = crud.reject_quiz(session=session, db_event=event)
    return _quiz_public(rejected, session)


@router.post("/{id}/set-pending", response_model=QuizPublic)
def set_quiz_pending(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if event.status != QuizStatus.rejected:
        raise HTTPException(status_code=400, detail="Only rejected quizzes can be returned to pending")
    pending = crud.set_quiz_pending(session=session, db_event=event)
    return _quiz_public(pending, session)


@router.delete("/{id}")
def delete_quiz(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    crud.delete_quiz(session=session, db_event=event)
    return {"message": "Quiz deleted successfully"}


@router.get("/{id}/results", response_model=QuizResultsPublic)
def read_quiz_results(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != QuizStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Quiz not found")
    results = session.exec(
        select(QuizResult)
        .where(QuizResult.quiz_id == id)
        .order_by(QuizResult.final_rank.asc(), QuizResult.score.desc())
    ).all()
    return QuizResultsPublic(data=results, count=len(results))


@router.get("/{id}/results/with-players", response_model=QuizResultsWithPlayersPublic)
def read_quiz_results_with_players(
    session: SessionDep, current_user: OptionalCurrentUser, id: uuid.UUID
) -> Any:
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if event.status != QuizStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Quiz not found")
    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0
    rows = session.exec(
        select(QuizResult, Player)
        .join(Player, QuizResult.player_id == Player.id)
        .where(QuizResult.quiz_id == id)
        .order_by(QuizResult.final_rank.asc(), QuizResult.score.desc())
    ).all()
    data = [
        QuizResultWithPlayer(
            id=r.id,
            quiz_id=r.quiz_id,
            player_id=r.player_id,
            player_display_name=p.display_name,
            player_slug=p.slug,
            score=r.score,
            final_rank=r.final_rank,
            round_scores=_get_round_scores(r, num_rounds),
        )
        for r, p in rows
    ]
    return QuizResultsWithPlayersPublic(data=data, count=len(data))


@router.post("/{id}/results/parse", response_model=ParseResultsResponse)
def parse_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: ParseResultsRequest,
) -> Any:
    if not session.get(Quiz, id):
        raise HTTPException(status_code=404, detail="Quiz not found")
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


@router.post("/{id}/results", response_model=QuizResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: uuid.UUID,
    request: SubmitResultsRequest,
) -> Any:
    event = session.get(Quiz, id)
    if not event:
        raise HTTPException(status_code=404, detail="Quiz not found")

    fmt = session.get(QuizFormat, event.format_id) if event.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0

    if request.mode == SubmitMode.replace:
        existing = session.exec(select(QuizResult).where(QuizResult.quiz_id == id)).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[QuizResultCreate] = []
    for row in request.results:
        if row.round_scores is not None:
            if fmt is None:
                raise HTTPException(
                    status_code=422,
                    detail="Quiz has no format; round_scores are not accepted",
                )
            if len(row.round_scores) > num_rounds:
                raise HTTPException(
                    status_code=422,
                    detail="round_scores length exceeds format round count",
                )
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
            QuizResultCreate(
                player_id=player_id,
                score=row.score,
                round_scores=row.round_scores,
            )
        )
    crud.create_quiz_results(
        session=session, event_id=id, results=creates
    )
    # Fetch all results for this quiz to return the complete list
    all_results = session.exec(
        select(QuizResult).where(QuizResult.quiz_id == id)
    ).all()
    return QuizResultsPublic(data=all_results, count=len(all_results))


@router.delete("/{id}/results/{result_id}")
def delete_quiz_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    result_id: uuid.UUID,
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    result = session.get(QuizResult, result_id)
    if not result or result.quiz_id != id:
        raise HTTPException(status_code=404, detail="Result not found")
    crud.delete_quiz_result(session=session, db_result=result)
    return {"message": "Result deleted successfully"}


@router.patch("/{quiz_id}/results/{result_id}", response_model=QuizResultPublic)
def update_quiz_result(
    *,
    quiz_id: uuid.UUID,
    result_id: uuid.UUID,
    result_in: QuizResultUpdate,
    session: SessionDep,
    current_user: CurrentSuperuser,
) -> Any:
    db_result = session.get(QuizResult, result_id)
    if not db_result or db_result.quiz_id != quiz_id:
        raise HTTPException(status_code=404, detail="Quiz result not found")
    return crud.update_quiz_result(session=session, db_result=db_result, result_in=result_in)
