import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, col, func, select

from app import crud
from app.api.deps import (
    CurrentOrganizer,
    CurrentSuperuser,
    CurrentUser,
    OptionalCurrentUser,
    SessionDep,
)
from app.models import (
    Event,
    ParsedResultWithCandidates,
    ParseResultsRequest,
    ParseResultsResponse,
    PlayerSearchResult,
    Quiz,
    QuizCreate,
    QuizFormat,
    QuizFormatPublic,
    QuizParticipantMode,
    QuizPublic,
    QuizResult,
    QuizResultCreate,
    QuizResultPlayer,
    QuizResultPublic,
    QuizResultsPublic,
    QuizResultsWithPlayersPublic,
    QuizResultUpdate,
    QuizResultWithPlayer,
    QuizStatus,
    QuizUpdate,
    QuizzesPublic,
    ResolvedResultRow,
    ResultParticipant,
    ResultParticipantCreate,
    SubmitMode,
    SubmitResultsRequest,
    validate_team_fields,
)

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


def _get_round_scores(result: QuizResult, num_rounds: int) -> list[float | None] | None:
    if num_rounds == 0:
        return None
    return [getattr(result, f"round_{i}") for i in range(1, num_rounds + 1)]


def _max_participants(mode: QuizParticipantMode) -> int | None:
    """Upper bound on a result's participants, or None for no bound.

    Teams have no bound and no lower bound either: a team recorded from an
    upload that listed no squad is a supported state, filled in later from
    the results page.
    """
    if mode == QuizParticipantMode.pairs:
        return 2
    if mode == QuizParticipantMode.teams:
        return None
    return 1


def _results_public(
    *, session: Session, results: Sequence[QuizResult]
) -> list[QuizResultPublic]:
    """Build QuizResultPublic rows with participants populated.

    Shared by the plain results list/create/update routes so they all name
    who achieved each result, the same way read_quiz_results_with_players
    does — one query for the whole list via crud.build_participants_public,
    not one per result.
    """
    by_result = crud.build_participants_public(
        session=session, result_ids=[r.id for r in results]
    )
    return [
        QuizResultPublic(
            id=r.id,
            quiz_id=r.quiz_id,
            score=r.score,
            final_rank=r.final_rank,
            participants=by_result.get(r.id, []),
            team_name=r.team_name,
            team_type=r.team_type,
            team_country=r.team_country,
        )
        for r in results
    ]


def _quiz_public(quiz: Quiz, session: Session) -> QuizPublic:
    fmt = session.get(QuizFormat, quiz.format_id) if quiz.format_id else None
    event = session.get(Event, quiz.event_id) if quiz.event_id else None
    return QuizPublic(
        **quiz.model_dump(exclude={"format"}),
        format=QuizFormatPublic.model_validate(fmt) if fmt else None,
        event_name=event.name if event else None,
        event_slug=event.slug if event else None,
    )


@router.get("/", response_model=QuizzesPublic)
def read_quizzes(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: QuizStatus | None = None,
    competition_id: uuid.UUID | None = None,
    q: str | None = None,
) -> Any:
    is_superuser = current_user is not None and current_user.is_superuser
    effective_status = status if (is_superuser and status) else QuizStatus.approved

    filters = [Quiz.status == effective_status]
    if competition_id:
        filters.append(Quiz.competition_id == competition_id)
    name_query = (q or "").strip()
    if name_query:
        filters.append(col(Quiz.name).ilike(f"%{name_query}%"))

    count = session.exec(
        select(func.count()).select_from(Quiz).where(*filters)
    ).one()
    quizzes = session.exec(
        select(Quiz)
        .where(*filters)
        .order_by(col(Quiz.start_date).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return QuizzesPublic(data=[_quiz_public(q, session) for q in quizzes], count=count)


@router.get("/{id}", response_model=QuizPublic)
def read_quiz(
    session: SessionDep, current_user: OptionalCurrentUser, id: str
) -> Any:
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if quiz.status != QuizStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return _quiz_public(quiz, session)


@router.post("/", response_model=QuizPublic)
def create_quiz(
    *, session: SessionDep, current_user: CurrentOrganizer, quiz_in: QuizCreate
) -> Any:
    if quiz_in.event_id is not None and not session.get(Event, quiz_in.event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    quiz = crud.create_quiz(
        session=session, quiz_in=quiz_in, submitted_by_id=current_user.id
    )
    return _quiz_public(quiz, session)


@router.patch("/{id}", response_model=QuizPublic)
def update_quiz(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: str,
    quiz_in: QuizUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if quiz_in.event_id is not None and not session.get(Event, quiz_in.event_id):
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        updated = crud.update_quiz(session=session, db_quiz=quiz, quiz_in=quiz_in)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _quiz_public(updated, session)


@router.post("/{id}/approve", response_model=QuizPublic)
def approve_quiz(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if quiz.status != QuizStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending quizzes can be approved")
    approved = crud.approve_quiz(session=session, db_quiz=quiz)
    return _quiz_public(approved, session)


@router.post("/{id}/reject", response_model=QuizPublic)
def reject_quiz(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if quiz.status != QuizStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending quizzes can be rejected")
    rejected = crud.reject_quiz(session=session, db_quiz=quiz)
    return _quiz_public(rejected, session)


@router.post("/{id}/set-pending", response_model=QuizPublic)
def set_quiz_pending(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if quiz.status != QuizStatus.rejected:
        raise HTTPException(status_code=400, detail="Only rejected quizzes can be returned to pending")
    pending = crud.set_quiz_pending(session=session, db_quiz=quiz)
    return _quiz_public(pending, session)


@router.delete("/{id}")
def delete_quiz(
    *, session: SessionDep, current_user: CurrentUser, id: str
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    crud.delete_quiz(session=session, db_quiz=quiz)
    return {"message": "Quiz deleted successfully"}


@router.get("/{id}/results", response_model=QuizResultsPublic)
def read_quiz_results(
    session: SessionDep, current_user: OptionalCurrentUser, id: str
) -> Any:
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if quiz.status != QuizStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Quiz not found")
    results = session.exec(
        select(QuizResult)
        .where(QuizResult.quiz_id == quiz.id)
        .order_by(QuizResult.final_rank.asc(), QuizResult.score.desc())
    ).all()
    data = _results_public(session=session, results=results)
    return QuizResultsPublic(data=data, count=len(data))


@router.get("/{id}/results/with-players", response_model=QuizResultsWithPlayersPublic)
def read_quiz_results_with_players(
    session: SessionDep, current_user: OptionalCurrentUser, id: str
) -> Any:
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    is_superuser = current_user is not None and current_user.is_superuser
    if quiz.status != QuizStatus.approved and not is_superuser:
        raise HTTPException(status_code=404, detail="Quiz not found")
    fmt = session.get(QuizFormat, quiz.format_id) if quiz.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0
    rows = session.exec(
        select(QuizResult)
        .where(QuizResult.quiz_id == quiz.id)
        .order_by(QuizResult.final_rank.asc(), QuizResult.score.desc())
    ).all()
    by_result = crud.build_participants_public(
        session=session, result_ids=[r.id for r in rows]
    )
    data = [
        QuizResultWithPlayer(
            id=r.id,
            quiz_id=r.quiz_id,
            score=r.score,
            final_rank=r.final_rank,
            round_scores=_get_round_scores(r, num_rounds),
            participants=by_result.get(r.id, []),
            team_name=r.team_name,
            team_type=r.team_type,
            team_country=r.team_country,
        )
        for r in rows
    ]
    return QuizResultsWithPlayersPublic(data=data, count=len(data))


@router.post("/{id}/results/parse", response_model=ParseResultsResponse)
def parse_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: str,
    request: ParseResultsRequest,
) -> Any:
    if not crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id):
        raise HTTPException(status_code=404, detail="Quiz not found")
    results = []
    for row in request.rows:
        scored = crud.search_players(
            session=session, q=row.player_name, country=row.country
        )
        players_public = crud.build_players_public(
            session=session, players=[p for p, _ in scored]
        )
        candidates = [
            PlayerSearchResult(player=pub, similarity=score)
            for pub, (_, score) in zip(players_public, scored, strict=True)
        ]
        results.append(ParsedResultWithCandidates(row=row, candidates=candidates))
    return ParseResultsResponse(results=results)


@router.post("/{id}/results", response_model=QuizResultsPublic)
def submit_results(
    *,
    session: SessionDep,
    current_user: CurrentOrganizer,  # noqa: ARG001
    id: str,
    request: SubmitResultsRequest,
) -> Any:
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    fmt = session.get(QuizFormat, quiz.format_id) if quiz.format_id else None
    num_rounds = len(fmt.rounds) if fmt else 0

    # In append mode, a submitted participant may legitimately collide with an
    # existing result: create_quiz_results upserts by matching the row's
    # headline (slot-1) participant — that's how re-submitting the same
    # headline player with an updated score, or a new partner, overwrites
    # their own existing result instead of erroring. Any other collision (a
    # non-headline participant, or a headline that doesn't match an existing
    # result's recorded slot-1 player — e.g. someone who was previously only
    # a partner) would hit the UNIQUE (quiz_id, player_id) constraint on
    # QuizResultPlayer, so it must be rejected here with a clean 422 instead
    # of surfacing as a 500.
    existing_result_player_ids: set[uuid.UUID] = set()
    existing_participant_ids: set[uuid.UUID] = set()
    if request.mode == SubmitMode.append:
        existing_result_player_ids = set(
            session.exec(
                select(QuizResultPlayer.player_id)
                .where(QuizResultPlayer.quiz_id == quiz.id)
                .where(QuizResultPlayer.slot == 1)
            ).all()
        )
        existing_participant_ids = set(
            session.exec(
                select(QuizResultPlayer.player_id).where(
                    QuizResultPlayer.quiz_id == quiz.id
                )
            ).all()
        )

    errors: list[str] = []
    resolved_rows: list[tuple[ResolvedResultRow, list[ResultParticipant]]] = []
    seen_player_rows: dict[uuid.UUID, int] = {}
    for i, row in enumerate(request.results):
        if row.round_scores is not None:
            if fmt is None:
                errors.append(
                    f"Row {i + 1}: quiz has no format; round_scores are not accepted"
                )
            elif len(row.round_scores) > num_rounds:
                errors.append(
                    f"Row {i + 1}: round_scores length exceeds format round count"
                )
        if row.score is None:
            errors.append(f"Row {i + 1}: score is required")
        participants = row.participants
        try:
            validate_team_fields(
                participant_mode=quiz.participant_mode,
                team_name=row.team_name,
                team_type=row.team_type,
                team_country=row.team_country,
            )
        except ValueError as exc:
            errors.append(f"Row {i + 1}: {exc}")
        max_participants = _max_participants(quiz.participant_mode)
        if max_participants is None:
            pass  # teams: any number, including none
        elif not participants:
            errors.append(f"Row {i + 1}: at least one participant is required")
        elif len(participants) > max_participants:
            if max_participants == 1:
                errors.append(
                    f"Row {i + 1}: this quiz is individual; "
                    f"got {len(participants)} participants"
                )
            else:
                errors.append(
                    f"Row {i + 1}: a pairs result takes at most 2 participants; "
                    f"got {len(participants)}"
                )
        known_ids = [p.player_id for p in participants if p.player_id]
        if len(known_ids) != len(set(known_ids)):
            errors.append(
                f"Row {i + 1}: the same player cannot appear twice in one result"
            )
        for slot_idx, p in enumerate(participants):
            if not p.player_id and not p.player_create:
                errors.append(
                    f"Row {i + 1}: each participant needs player_id or player_create"
                )
            if p.player_id:
                first_row = seen_player_rows.get(p.player_id)
                if first_row is None:
                    seen_player_rows[p.player_id] = i + 1
                elif first_row != i + 1:
                    errors.append(
                        f"Row {i + 1}: player already appears in row {first_row}"
                    )
                is_upsert_target = (
                    slot_idx == 0 and p.player_id in existing_result_player_ids
                )
                if p.player_id in existing_participant_ids and not is_upsert_target:
                    errors.append(
                        f"Row {i + 1}: player already has a result in this quiz"
                    )
        resolved_rows.append((row, participants))

    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    if request.mode == SubmitMode.replace:
        existing = session.exec(
            select(QuizResult).where(QuizResult.quiz_id == quiz.id)
        ).all()
        for r in existing:
            session.delete(r)
        session.flush()

    creates: list[QuizResultCreate] = []
    for row, participants in resolved_rows:
        assert row.score is not None  # validated above
        participant_creates: list[ResultParticipantCreate] = []
        for p in participants:
            if p.player_id:
                player_id = p.player_id
            else:
                assert p.player_create is not None  # validated above
                player = crud.create_player(
                    session=session, player_in=p.player_create, commit=False
                )
                player_id = player.id
            participant_creates.append(
                ResultParticipantCreate(player_id=player_id, country=p.country)
            )
        creates.append(
            QuizResultCreate(
                final_rank=row.final_rank,
                score=row.score,
                round_scores=row.round_scores,
                participants=participant_creates,
                team_name=row.team_name,
                team_type=row.team_type,
                team_country=row.team_country,
            )
        )
    crud.create_quiz_results(
        session=session, quiz_id=quiz.id, results=creates, commit=False
    )
    session.commit()

    # Fetch all results for this quiz to return the complete list
    all_results = session.exec(
        select(QuizResult).where(QuizResult.quiz_id == quiz.id)
    ).all()
    data = _results_public(session=session, results=all_results)
    return QuizResultsPublic(data=data, count=len(data))


@router.delete("/{id}/results/{result_id}")
def delete_quiz_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: str,
    result_id: uuid.UUID,
) -> dict[str, str]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=id)
    result = session.get(QuizResult, result_id)
    if not quiz or not result or result.quiz_id != quiz.id:
        raise HTTPException(status_code=404, detail="Result not found")
    crud.delete_quiz_result(session=session, db_result=result)
    return {"message": "Result deleted successfully"}


@router.patch("/{quiz_id}/results/{result_id}", response_model=QuizResultPublic)
def update_quiz_result(
    *,
    quiz_id: str,
    result_id: uuid.UUID,
    result_in: QuizResultUpdate,
    session: SessionDep,
    current_user: CurrentSuperuser,  # noqa: ARG001
) -> Any:
    quiz = crud.resolve_by_id_or_slug(session=session, model=Quiz, value=quiz_id)
    db_result = session.get(QuizResult, result_id)
    if not quiz or not db_result or db_result.quiz_id != quiz.id:
        raise HTTPException(status_code=404, detail="Quiz result not found")
    if result_in.participants is not None:
        max_participants = _max_participants(quiz.participant_mode)
        player_ids = [p.player_id for p in result_in.participants]
        if max_participants is not None:
            if not player_ids:
                raise HTTPException(
                    status_code=422, detail="At least one participant is required"
                )
            if len(player_ids) > max_participants:
                raise HTTPException(
                    status_code=422,
                    detail=f"This quiz takes at most {max_participants} participants per result",
                )
        if len(player_ids) != len(set(player_ids)):
            raise HTTPException(
                status_code=422,
                detail="The same player cannot appear twice in one result",
            )
        # A submitted participant may already hold a DIFFERENT result in this
        # quiz. crud.update_quiz_result deletes and re-inserts this result's
        # join rows, so an unguarded collision here violates
        # UNIQUE (quiz_id, player_id) and — there is no IntegrityError
        # handler in app/ — surfaces as a 500. Mirror submit_results'
        # existing_participant_ids guard, excluding the result being edited:
        # a participant already on THIS result must still be allowed.
        other_holders = session.exec(
            select(QuizResultPlayer.player_id)
            .where(QuizResultPlayer.quiz_id == quiz.id)
            .where(col(QuizResultPlayer.player_id).in_(player_ids))
            .where(col(QuizResultPlayer.quiz_result_id) != db_result.id)
        ).all()
        if other_holders:
            raise HTTPException(
                status_code=422,
                detail="Player already has a result in this quiz",
            )
    patch = result_in.model_dump(exclude_unset=True)
    try:
        validate_team_fields(
            participant_mode=quiz.participant_mode,
            team_name=patch.get("team_name", db_result.team_name),
            team_type=patch.get("team_type", db_result.team_type),
            team_country=patch.get("team_country", db_result.team_country),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    updated = crud.update_quiz_result(
        session=session, db_result=db_result, result_in=result_in
    )
    return _results_public(session=session, results=[updated])[0]
