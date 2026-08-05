import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import OrganizationCreate


def test_get_organization_by_uuid_and_by_slug(client: TestClient, db: Session) -> None:
    name = f"Resolver Org {uuid.uuid4().hex[:8]}"
    org = crud.create_organization(session=db, org_in=OrganizationCreate(name=name))
    try:
        by_id = client.get(f"{settings.API_V1_STR}/organizations/{org.id}")
        by_slug = client.get(f"{settings.API_V1_STR}/organizations/{org.slug}")
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["id"] == by_slug.json()["id"] == str(org.id)
    finally:
        db.delete(org)
        db.commit()


def test_get_organization_by_unknown_slug_returns_404(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/organizations/no-such-org-slug-xyz")
    assert r.status_code == 404


def test_patch_organization_by_slug(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Patch Org {uuid.uuid4().hex[:8]}")
    )
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{org.slug}",
            headers=superuser_token_headers,
            json={"description": "updated via slug"},
        )
        assert r.status_code == 200
        assert r.json()["description"] == "updated via slug"
    finally:
        db.delete(org)
        db.commit()


def test_patch_duplicate_slug_returns_409(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    a = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Dup A {uuid.uuid4().hex[:8]}")
    )
    b = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Dup B {uuid.uuid4().hex[:8]}")
    )
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{b.id}",
            headers=superuser_token_headers,
            json={"slug": a.slug},
        )
        assert r.status_code == 409
    finally:
        db.delete(a)
        db.delete(b)
        db.commit()


def test_patch_own_slug_is_not_a_conflict(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Self Slug {uuid.uuid4().hex[:8]}")
    )
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{org.id}",
            headers=superuser_token_headers,
            json={"slug": org.slug},
        )
        assert r.status_code == 200
    finally:
        db.delete(org)
        db.commit()


def test_rename_does_not_change_slug(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    org = crud.create_organization(
        session=db, org_in=OrganizationCreate(name=f"Original {uuid.uuid4().hex[:8]}")
    )
    original_slug = org.slug
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/organizations/{org.id}",
            headers=superuser_token_headers,
            json={"name": "Completely Different Name"},
        )
        assert r.status_code == 200
        assert r.json()["slug"] == original_slug
    finally:
        db.delete(org)
        db.commit()
