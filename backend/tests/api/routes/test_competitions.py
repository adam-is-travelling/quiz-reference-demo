import uuid
from collections.abc import Generator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import Competition, Organization, Quiz, QuizResultCreate, QuizStatus
from tests.utils.quiz import (
    create_random_competition,
    create_random_organization,
    create_random_player,
    create_random_quiz,
)


@pytest.fixture(autouse=True)
def clean_competition_data(db: Session) -> Generator[None, None, None]:
    pre_competitions = {r.id for r in db.exec(select(Competition)).all()}
    pre_orgs = {r.id for r in db.exec(select(Organization)).all()}
    yield
    db.expire_all()
    new_competition_ids = {
        r.id for r in db.exec(select(Competition)).all()
    } - pre_competitions
    if new_competition_ids:
        db.execute(
            delete(Competition).where(col(Competition.id).in_(new_competition_ids))
        )
    new_org_ids = {r.id for r in db.exec(select(Organization)).all()} - pre_orgs
    if new_org_ids:
        db.execute(delete(Organization).where(col(Organization.id).in_(new_org_ids)))
    db.commit()


def test_read_competitions_public(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/competitions/")
    assert response.status_code == 200
    content = response.json()
    assert "data" in content
    assert "count" in content


def test_create_competition_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    data = {"name": "World Quizzing Championships", "organization_id": str(org.id)}
    response = client.post(
        f"{settings.API_V1_STR}/competitions/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "World Quizzing Championships"
    assert content["organization_id"] == str(org.id)


def test_create_competition_with_organization(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    response = client.post(
        f"{settings.API_V1_STR}/competitions/",
        headers=superuser_token_headers,
        json={"name": "IQA League", "organization_id": str(org.id)},
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(org.id)


def test_create_competition_forbidden_for_organizer(
    client: TestClient, organizer_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/competitions/",
        headers=organizer_token_headers,
        json={"name": "Should Fail", "organization_id": str(uuid.uuid4())},
    )
    assert response.status_code == 403


def test_read_competition_by_id(client: TestClient, db: Session) -> None:
    competition = create_random_competition(db)
    response = client.get(f"{settings.API_V1_STR}/competitions/{competition.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(competition.id)


def test_read_competition_not_found(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/competitions/{uuid.uuid4()}")
    assert response.status_code == 404


def test_update_competition(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    competition = create_random_competition(db)
    response = client.patch(
        f"{settings.API_V1_STR}/competitions/{competition.id}",
        headers=superuser_token_headers,
        json={"name": "Updated Competition"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Competition"


def test_delete_competition_as_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    competition = create_random_competition(db)
    response = client.delete(
        f"{settings.API_V1_STR}/competitions/{competition.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    get_response = client.get(f"{settings.API_V1_STR}/competitions/{competition.id}")
    assert get_response.status_code == 404


def test_delete_competition_forbidden_for_organizer(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    competition = create_random_competition(db)
    response = client.delete(
        f"{settings.API_V1_STR}/competitions/{competition.id}",
        headers=organizer_token_headers,
    )
    assert response.status_code == 403


def test_delete_competition_not_found(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/competitions/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404


def test_delete_competition_nullifies_quiz_competition_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    competition = create_random_competition(db)
    quiz = create_random_quiz(db)
    quiz.competition_id = competition.id
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    quiz_id = quiz.id

    try:
        response = client.delete(
            f"{settings.API_V1_STR}/competitions/{competition.id}",
            headers=superuser_token_headers,
        )
        assert response.status_code == 200

        db.expire_all()
        refreshed_quiz = db.get(Quiz, quiz_id)
        assert refreshed_quiz is not None
        assert refreshed_quiz.competition_id is None
    finally:
        db.expire_all()
        leftover = db.get(Quiz, quiz_id)
        if leftover:
            db.delete(leftover)
            db.commit()


def test_read_competitions_includes_organization_name(
    client: TestClient,
    db: Session,
) -> None:
    org = create_random_organization(db)
    competition = create_random_competition(db, organization_id=org.id)
    response = client.get(f"{settings.API_V1_STR}/competitions/")
    assert response.status_code == 200
    data = response.json()["data"]
    match = next((s for s in data if s["id"] == str(competition.id)), None)
    assert match is not None
    assert match["organization_name"] == org.name


def test_read_competition_item_includes_organization_name(
    client: TestClient,
    db: Session,
) -> None:
    org = create_random_organization(db)
    competition = create_random_competition(db, organization_id=org.id)
    response = client.get(f"{settings.API_V1_STR}/competitions/{competition.id}")
    assert response.status_code == 200
    assert response.json()["organization_name"] == org.name


def test_create_competition_without_organization_fails(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/competitions/",
        headers=superuser_token_headers,
        json={"name": "No Org Competition"},
    )
    assert response.status_code == 422


def test_create_competition_with_missing_organization_returns_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/competitions/",
        headers=superuser_token_headers,
        json={"name": "Ghost Org Competition", "organization_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Organization not found"


def test_update_competition_with_null_organization_keeps_org(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    competition = create_random_competition(db, organization_id=org.id)
    response = client.patch(
        f"{settings.API_V1_STR}/competitions/{competition.id}",
        headers=superuser_token_headers,
        json={"organization_id": None},
    )
    assert response.status_code == 200
    assert response.json()["organization_id"] == str(org.id)


def test_update_competition_with_null_slug_keeps_slug(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    competition = create_random_competition(db)
    original_slug = competition.slug
    response = client.patch(
        f"{settings.API_V1_STR}/competitions/{competition.id}",
        headers=superuser_token_headers,
        json={"slug": None},
    )
    assert response.status_code == 200
    assert response.json()["slug"] == original_slug


def test_update_competition_with_missing_organization_returns_404(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    competition = create_random_competition(db)
    response = client.patch(
        f"{settings.API_V1_STR}/competitions/{competition.id}",
        headers=superuser_token_headers,
        json={"organization_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Organization not found"


def test_delete_organization_cascades_to_competition(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    org = create_random_organization(db)
    competition = create_random_competition(db, organization_id=org.id)
    competition_id = competition.id
    response = client.delete(
        f"{settings.API_V1_STR}/organizations/{org.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    db.expire_all()
    assert db.get(Competition, competition_id) is None


def _approved_quiz_in_competition(
    db: Session, competition_id: uuid.UUID, name: str, start: date
) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.name = name
    quiz.competition_id = competition_id
    quiz.start_date = start
    quiz.end_date = start
    quiz.status = QuizStatus.approved
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_competition_podium_returns_top_three(client: TestClient, db: Session) -> None:
    competition = create_random_competition(db)
    quiz = _approved_quiz_in_competition(db, competition.id, "Quiz A", date(2026, 1, 1))
    players = [create_random_player(db) for _ in range(4)]
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(player_id=players[0].id, final_rank=1, score=100),
            QuizResultCreate(player_id=players[1].id, final_rank=2, score=90),
            QuizResultCreate(player_id=players[2].id, final_rank=3, score=80),
            QuizResultCreate(player_id=players[3].id, final_rank=4, score=70),
        ],
    )
    response = client.get(f"{settings.API_V1_STR}/competitions/{competition.id}/podium")
    assert response.status_code == 200
    body = response.json()
    assert len(body["quizzes"]) == 1
    finishers = body["quizzes"][0]["finishers"]
    assert [f["place"] for f in finishers] == [1, 2, 3]
    assert finishers[0]["player_id"] == str(players[0].id)


def test_competition_podium_gold_outranks_silver(
    client: TestClient, db: Session
) -> None:
    competition = create_random_competition(db)
    p_gold = create_random_player(db)
    p_gold.display_name = "Zeta Twogold"
    p_silver = create_random_player(db)
    p_silver.display_name = "Alpha Twosilver"
    db.add(p_gold)
    db.add(p_silver)
    db.commit()
    e1 = _approved_quiz_in_competition(db, competition.id, "E1", date(2026, 1, 1))
    e2 = _approved_quiz_in_competition(db, competition.id, "E2", date(2026, 2, 1))
    for quiz in (e1, e2):
        crud.create_quiz_results(
            session=db,
            quiz_id=quiz.id,
            results=[
                QuizResultCreate(player_id=p_gold.id, final_rank=1, score=10),
                QuizResultCreate(player_id=p_silver.id, final_rank=2, score=9),
            ],
        )
    body = client.get(
        f"{settings.API_V1_STR}/competitions/{competition.id}/podium"
    ).json()
    names = [s["player_display_name"] for s in body["standings"]]
    # 2 golds beats 2 silvers even though "Alpha" is alphabetically first
    assert names == ["Zeta Twogold", "Alpha Twosilver"]


def test_competition_podium_alpha_tiebreak(client: TestClient, db: Session) -> None:
    competition = create_random_competition(db)
    p_b = create_random_player(db)
    p_b.display_name = "Bravo"
    p_a = create_random_player(db)
    p_a.display_name = "Alpha"
    db.add(p_a)
    db.add(p_b)
    db.commit()
    e1 = _approved_quiz_in_competition(db, competition.id, "E1", date(2026, 1, 1))
    e2 = _approved_quiz_in_competition(db, competition.id, "E2", date(2026, 2, 1))
    crud.create_quiz_results(
        session=db,
        quiz_id=e1.id,
        results=[QuizResultCreate(player_id=p_b.id, final_rank=1, score=10)],
    )
    crud.create_quiz_results(
        session=db,
        quiz_id=e2.id,
        results=[QuizResultCreate(player_id=p_a.id, final_rank=1, score=10)],
    )
    body = client.get(
        f"{settings.API_V1_STR}/competitions/{competition.id}/podium"
    ).json()
    names = [s["player_display_name"] for s in body["standings"]]
    assert names == ["Alpha", "Bravo"]  # equal gold count -> alphabetical


def test_competition_podium_excludes_unapproved(
    client: TestClient, db: Session
) -> None:
    competition = create_random_competition(db)
    quiz = create_random_quiz(db)  # pending by default
    quiz.competition_id = competition.id
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=50)],
    )
    body = client.get(
        f"{settings.API_V1_STR}/competitions/{competition.id}/podium"
    ).json()
    assert body["quizzes"] == []
    assert body["standings"] == []


def test_competition_podium_partial_podium(client: TestClient, db: Session) -> None:
    competition = create_random_competition(db)
    quiz = _approved_quiz_in_competition(db, competition.id, "Solo", date(2026, 1, 1))
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=50)],
    )
    body = client.get(
        f"{settings.API_V1_STR}/competitions/{competition.id}/podium"
    ).json()
    assert len(body["quizzes"][0]["finishers"]) == 1
    assert len(body["standings"]) == 1
    assert body["standings"][0]["gold"] == 1


def test_competition_podium_unknown_competition_404(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/competitions/{uuid.uuid4()}/podium")
    assert response.status_code == 404


def test_competition_podium_empty_competition(client: TestClient, db: Session) -> None:
    competition = create_random_competition(db)
    body = client.get(
        f"{settings.API_V1_STR}/competitions/{competition.id}/podium"
    ).json()
    assert body == {"quizzes": [], "standings": []}
