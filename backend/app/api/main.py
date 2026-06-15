from fastapi import APIRouter

from app.api.routes import quizzes, formats, login, organizations, players, private, series, users, utils
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(organizations.router)
api_router.include_router(series.router)
api_router.include_router(players.router)
api_router.include_router(formats.router)
api_router.include_router(quizzes.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
