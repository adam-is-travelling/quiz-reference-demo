import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Organization,
    OrganizationCreate,
    OrganizationPublic,
    OrganizationsPublic,
    OrganizationUpdate,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("/", response_model=OrganizationsPublic)
def read_organizations(
    session: SessionDep, skip: int = 0, limit: int = 100
) -> Any:
    count = session.exec(select(func.count()).select_from(Organization)).one()
    orgs = session.exec(select(Organization).offset(skip).limit(limit)).all()
    return OrganizationsPublic(data=orgs, count=count)


@router.get("/{id}", response_model=OrganizationPublic)
def read_organization(session: SessionDep, id: uuid.UUID) -> Any:
    org = session.get(Organization, id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


@router.post("/", response_model=OrganizationPublic)
def create_organization(
    *, session: SessionDep, current_user: CurrentUser, org_in: OrganizationCreate
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return crud.create_organization(session=session, org_in=org_in)


@router.patch("/{id}", response_model=OrganizationPublic)
def update_organization(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    org_in: OrganizationUpdate,
) -> Any:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    org = session.get(Organization, id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return crud.update_organization(session=session, db_org=org, org_in=org_in)


@router.delete("/{id}")
def delete_organization(
    *, session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> dict[str, bool]:
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    org = session.get(Organization, id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    session.delete(org)
    session.commit()
    return {"ok": True}
