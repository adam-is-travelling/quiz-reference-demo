import uuid

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Quiz,
    QuizFormat,
    QuizFormatCreate,
    QuizFormatPublic,
    QuizFormatsPublic,
    QuizFormatUpdate,
)

router = APIRouter(prefix="/formats", tags=["formats"])


@router.get("/", response_model=QuizFormatsPublic)
def read_formats(session: SessionDep, skip: int = 0, limit: int = 100) -> QuizFormatsPublic:
    formats, count = crud.get_formats(session=session, skip=skip, limit=limit)
    return QuizFormatsPublic(data=formats, count=count)


@router.get("/{id}", response_model=QuizFormatPublic)
def read_format(session: SessionDep, id: uuid.UUID) -> QuizFormatPublic:
    db_format = crud.get_format(session=session, format_id=id)
    if not db_format:
        raise HTTPException(status_code=404, detail="Format not found")
    return db_format


@router.post("/", response_model=QuizFormatPublic)
def create_format(
    *, session: SessionDep, current_user: CurrentUser, format_in: QuizFormatCreate
) -> QuizFormatPublic:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return crud.create_format(session=session, format_in=format_in)


@router.patch("/{id}", response_model=QuizFormatPublic)
def update_format(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    format_in: QuizFormatUpdate,
) -> QuizFormatPublic:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    db_format = crud.get_format(session=session, format_id=id)
    if not db_format:
        raise HTTPException(status_code=404, detail="Format not found")
    return crud.update_format(session=session, db_format=db_format, format_in=format_in)


@router.delete("/{id}")
def delete_format(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    db_format = crud.get_format(session=session, format_id=id)
    if not db_format:
        raise HTTPException(status_code=404, detail="Format not found")
    # Block deletion if any quiz references this format
    referencing = session.exec(
        select(Quiz).where(Quiz.format_id == id).limit(1)
    ).first()
    if referencing:
        raise HTTPException(
            status_code=409,
            detail="Format is in use by one or more events",
        )
    session.delete(db_format)
    session.commit()
    return {"ok": True}
