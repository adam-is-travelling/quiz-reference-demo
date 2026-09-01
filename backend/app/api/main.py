from fastapi import APIRouter

from app.api.routes import (
    competitions,
    events,
    formats,
    login,
    organizations,
    players,
    private,
    quizzes,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(organizations.router)
api_router.include_router(competitions.router)
api_router.include_router(events.router)
api_router.include_router(players.router)
api_router.include_router(formats.router)
api_router.include_router(quizzes.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
