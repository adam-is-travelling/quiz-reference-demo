import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import Organization, OrganizationCreate, QuizResultCreate
from tests.utils.quiz import (
    create_approved_event,
    create_approved_event_in_competition,
    create_random_competition,
    create_random_player,
)


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


# --- Competitions ---


def test_get_competition_by_uuid_and_by_slug(client: TestClient, db: Session) -> None:
    competition = create_random_competition(db)
    org_id = competition.organization_id
    try:
        by_id = client.get(f"{settings.API_V1_STR}/competitions/{competition.id}")
        by_slug = client.get(f"{settings.API_V1_STR}/competitions/{competition.slug}")
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["id"] == by_slug.json()["id"] == str(competition.id)
    finally:
        db.delete(competition)
        db.commit()
        org = db.get(Organization, org_id)
        if org:
            db.delete(org)
            db.commit()


def test_get_competition_by_unknown_slug_returns_404(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/competitions/no-such-competition-slug-xyz")
    assert r.status_code == 404


def test_competition_podium_by_slug_matches_uuid_and_is_nonempty(
    client: TestClient, db: Session
) -> None:
    # This exercises the fix where `Quiz.competition_id == id` would silently
    # match nothing once `id` could be a slug instead of a UUID: the slug
    # response must not just be 200, it must carry the same non-empty podium
    # data as the UUID response.
    competition = create_random_competition(db)
    org_id = competition.organization_id
    quiz = create_approved_event_in_competition(db, competition_id=competition.id)
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=100)],
    )
    try:
        by_id = client.get(f"{settings.API_V1_STR}/competitions/{competition.id}/podium")
        by_slug = client.get(
            f"{settings.API_V1_STR}/competitions/{competition.slug}/podium"
        )
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["events"] != []
        assert by_id.json()["events"][0]["finishers"] != []
        assert by_id.json() == by_slug.json()
    finally:
        db.delete(quiz)
        db.delete(player)
        db.delete(competition)
        db.commit()
        org = db.get(Organization, org_id)
        if org:
            db.delete(org)
            db.commit()


def test_patch_competition_by_slug(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    competition = create_random_competition(db)
    org_id = competition.organization_id
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/competitions/{competition.slug}",
            headers=superuser_token_headers,
            json={"description": "updated via slug"},
        )
        assert r.status_code == 200
        assert r.json()["description"] == "updated via slug"
    finally:
        db.delete(competition)
        db.commit()
        org = db.get(Organization, org_id)
        if org:
            db.delete(org)
            db.commit()


def test_patch_competition_duplicate_slug_returns_409(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    a = create_random_competition(db)
    b = create_random_competition(db)
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/competitions/{b.id}",
            headers=superuser_token_headers,
            json={"slug": a.slug},
        )
        assert r.status_code == 409
    finally:
        db.delete(a)
        db.delete(b)
        db.commit()
        for org_id in {a.organization_id, b.organization_id}:
            org = db.get(Organization, org_id)
            if org:
                db.delete(org)
        db.commit()


# --- Quizzes ---


def test_get_quiz_by_uuid_and_by_slug(client: TestClient, db: Session) -> None:
    quiz = create_approved_event(db)
    try:
        by_id = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}")
        by_slug = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.slug}")
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["id"] == by_slug.json()["id"] == str(quiz.id)
    finally:
        db.delete(quiz)
        db.commit()


def test_get_quiz_by_unknown_slug_returns_404(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/quizzes/no-such-quiz-slug-xyz")
    assert r.status_code == 404


def test_quiz_results_by_slug_matches_uuid_and_is_nonempty(
    client: TestClient, db: Session
) -> None:
    # Exercises the fix where `QuizResult.quiz_id == id` would silently match
    # nothing once `id` could be a slug: the slug response must carry the
    # same non-empty results as the UUID response, not just 200 with [].
    quiz = create_approved_event(db)
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=42.0)],
    )
    try:
        by_id = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.id}/results")
        by_slug = client.get(f"{settings.API_V1_STR}/quizzes/{quiz.slug}/results")
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["data"] != []
        assert by_id.json() == by_slug.json()
    finally:
        db.delete(quiz)
        db.delete(player)
        db.commit()


def test_quiz_results_with_players_by_slug_matches_uuid_and_is_nonempty(
    client: TestClient, db: Session
) -> None:
    quiz = create_approved_event(db)
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=42.0)],
    )
    try:
        by_id = client.get(
            f"{settings.API_V1_STR}/quizzes/{quiz.id}/results/with-players"
        )
        by_slug = client.get(
            f"{settings.API_V1_STR}/quizzes/{quiz.slug}/results/with-players"
        )
        assert by_id.status_code == 200
        assert by_slug.status_code == 200
        assert by_id.json()["data"] != []
        assert by_id.json() == by_slug.json()
    finally:
        db.delete(quiz)
        db.delete(player)
        db.commit()


def test_patch_quiz_by_slug(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    quiz = create_approved_event(db)
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{quiz.slug}",
            headers=superuser_token_headers,
            json={"description": "updated via slug"},
        )
        assert r.status_code == 200
        assert r.json()["description"] == "updated via slug"
    finally:
        db.delete(quiz)
        db.commit()


def test_patch_quiz_duplicate_slug_returns_409(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    a = create_approved_event(db)
    b = create_approved_event(db)
    try:
        r = client.patch(
            f"{settings.API_V1_STR}/quizzes/{b.id}",
            headers=superuser_token_headers,
            json={"slug": a.slug},
        )
        assert r.status_code == 409
    finally:
        db.delete(a)
        db.delete(b)
        db.commit()
