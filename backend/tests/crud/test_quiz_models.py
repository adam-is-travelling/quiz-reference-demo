from collections.abc import Generator

import pytest
from sqlmodel import Session, col, delete, select

from app import crud
from app.models import Organization, OrganizationCreate


@pytest.fixture(autouse=True)
def clean_org_data(db: Session) -> Generator[None, None, None]:
    pre_orgs = {r.id for r in db.exec(select(Organization)).all()}
    yield
    db.expire_all()
    new_org_ids = {r.id for r in db.exec(select(Organization)).all()} - pre_orgs
    if new_org_ids:
        db.execute(delete(Organization).where(col(Organization.id).in_(new_org_ids)))
    db.commit()


def test_create_organization(db: Session) -> None:
    org = crud.create_organization(
        session=db,
        org_in=OrganizationCreate(name="Test Org"),
    )
    assert org.id is not None
    assert org.name == "Test Org"
