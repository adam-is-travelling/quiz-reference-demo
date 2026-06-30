import uuid

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import CurrentOrganizer, CurrentSuperuser, OptionalCurrentUser, SessionDep
from app.utils import normalize_country
from app.crud import (
    create_player,
    delete_player,
    get_player_by_slug,
    get_player_history,
    search_players,
    update_player,
)
from app.models import (
    QuizResult,
    Player,
    PlayerCreate,
    PlayerHistory,
    PlayerPublic,
    PlayerResultWithQuiz,
    PlayerSearchResult,
    PlayerSearchResults,
    PlayersPublic,
    PlayerUpdate,
)

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/search", response_model=PlayerSearchResults)
def search_players_route(
    session: SessionDep,
    current_user: OptionalCurrentUser,
    q: str,
    country: str | None = None,
    limit: int = 5,
) -> PlayerSearchResults:
    normalized_country = normalize_country(country) if country else None
    published_only = current_user is None
    results = search_players(
        session=session, q=q, country=normalized_country, limit=limit, published_only=published_only
    )
    return PlayerSearchResults(
        data=[
            PlayerSearchResult(player=PlayerPublic.model_validate(p), similarity=score)
            for p, score in results
        ]
    )


@router.get("/by-slug/{slug}", response_model=PlayerPublic)
def get_player_by_slug_route(
    slug: str, session: SessionDep, current_user: OptionalCurrentUser
) -> PlayerPublic:
    player = get_player_by_slug(session=session, slug=slug)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.get("/{player_id}/history", response_model=PlayerHistory)
def get_player_history_route(
    player_id: uuid.UUID, session: SessionDep, current_user: OptionalCurrentUser
) -> PlayerHistory:
    player = session.get(Player, player_id)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    rows = get_player_history(session=session, player_id=player_id)
    return PlayerHistory(
        data=[
            PlayerResultWithQuiz(
                result_id=result.id,
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                score=result.score,
                final_rank=result.final_rank,
            )
            for result, quiz in rows
        ]
    )


@router.get("/{player_id}", response_model=PlayerPublic)
def get_player(
    player_id: uuid.UUID, session: SessionDep, current_user: OptionalCurrentUser
) -> PlayerPublic:
    player = session.get(Player, player_id)
    is_superuser = current_user is not None and current_user.is_superuser
    if not player or (not player.is_published and not is_superuser):
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.get("/", response_model=PlayersPublic)
def list_players(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
) -> PlayersPublic:
    count_stmt = select(func.count()).select_from(Player).where(Player.is_published == True)  # noqa: E712
    list_stmt = select(Player).where(Player.is_published == True)  # noqa: E712
    count = session.exec(count_stmt).one()
    players = session.exec(list_stmt.offset(skip).limit(limit)).all()
    return PlayersPublic(data=list(players), count=count)


@router.post("/", response_model=PlayerPublic)
def create_player_route(
    player_in: PlayerCreate,
    session: SessionDep,
    _current_user: CurrentOrganizer,
) -> PlayerPublic:
    return create_player(session=session, player_in=player_in)


@router.patch("/{player_id}", response_model=PlayerPublic)
def update_player_route(
    player_id: uuid.UUID,
    player_in: PlayerUpdate,
    session: SessionDep,
    _current_user: CurrentSuperuser,
) -> PlayerPublic:
    player = session.get(Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    try:
        return update_player(session=session, db_player=player, player_in=player_in)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/{player_id}")
def delete_player_route(
    player_id: uuid.UUID,
    session: SessionDep,
    _current_user: CurrentSuperuser,
) -> dict[str, str]:
    player = session.get(Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    has_results = session.exec(
        select(QuizResult).where(col(QuizResult.player_id) == player_id).limit(1)
    ).first()
    if has_results:
        raise HTTPException(status_code=400, detail="Cannot delete a player with quiz results")
    delete_player(session=session, db_player=player)
    return {"message": "Player deleted successfully"}
