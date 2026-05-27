from sqlmodel import Session, select
from app.models import Organization, OrganizationCreate
from app import crud


def test_create_organization(db: Session) -> None:
    org = crud.create_organization(
        session=db,
        org_in=OrganizationCreate(name="Test Org"),
    )
    assert org.id is not None
    assert org.name == "Test Org"
