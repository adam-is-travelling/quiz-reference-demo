import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.models import (
    Player,
    PlayerCountry,
    PlayerCreate,
    PlayerMergeAudit,
    Quiz,
    QuizResult,
    QuizResultCreate,
)
from tests.utils.quiz import create_approved_event, create_published_player


@pytest.fixture(autouse=True)
def clean_merge_data(db: Session) -> Generator[None, None, None]:
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    yield
    db.expire_all()
    db.execute(delete(PlayerMergeAudit))
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _payload(source: Player, target: Player) -> dict:
    return {
        "source_player_id": str(source.id),
        "target_player_id": str(target.id),
    }


def _make_player(db: Session, *, countries: list[str], **fields) -> Player:
    return crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=fields.pop("display_name", f"P {uuid.uuid4().hex[:8]}"),
            countries=countries,
            **fields,
        ),
    )


def test_merge_moves_results_and_deletes_source(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    quiz = create_approved_event(db)
    source_id = source.id
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=2, score=50.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == str(target.id)
    db.expire_all()
    moved = db.exec(
        select(QuizResult).where(col(QuizResult.player_id) == target.id)
    ).all()
    assert len(moved) == 1
    assert moved[0].quiz_id == quiz.id
    # source_id captured before expire_all(): accessing the expired `source`
    # instance's attributes after its row is deleted by a different session
    # (the API request's own session) raises ObjectDeletedError instead of
    # letting the assertion evaluate to None — see task-1-report.md.
    assert db.get(Player, source_id) is None


def test_merge_conflict_keeps_target_result(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    conflict_quiz = create_approved_event(db)
    other_quiz = create_approved_event(db)
    source_id = source.id
    crud.create_quiz_results(
        session=db,
        event_id=conflict_quiz.id,
        results=[
            QuizResultCreate(player_id=source.id, final_rank=5, score=10.0),
            QuizResultCreate(player_id=target.id, final_rank=1, score=99.0),
        ],
    )
    crud.create_quiz_results(
        session=db,
        event_id=other_quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=3, score=42.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    db.expire_all()
    target_results = db.exec(
        select(QuizResult).where(col(QuizResult.player_id) == target.id)
    ).all()
    by_quiz = {res.quiz_id: res for res in target_results}
    assert set(by_quiz) == {conflict_quiz.id, other_quiz.id}
    assert by_quiz[conflict_quiz.id].score == 99.0  # target's kept
    assert by_quiz[other_quiz.id].score == 42.0  # source's moved
    # source_id captured before expire_all(): accessing the expired `source`
    # instance's attributes after its row is deleted by a different session
    # (the API request's own session) raises ObjectDeletedError instead of
    # letting the assertion evaluate to None — see task-1-report.md.
    assert db.get(Player, source_id) is None


def test_merge_unions_countries_and_fills_blanks(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = _make_player(
        db, countries=["IE", "DE"], city="Dublin", club="Quiz Club", bio="A bio"
    )
    target = _make_player(db, countries=["FR"], club="Existing Club")
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["city"] == "Dublin"  # blank -> filled
    assert body["club"] == "Existing Club"  # non-blank -> untouched
    assert body["bio"] == "A bio"
    db.expire_all()
    links = db.exec(
        select(PlayerCountry).where(col(PlayerCountry.player_id) == target.id)
    ).all()
    by_code = {pc.code: pc for pc in links}
    assert set(by_code) == {"FR", "IE", "DE"}
    assert by_code["FR"].is_primary is True  # target primary unchanged
    assert by_code["IE"].is_primary is False
    assert by_code["DE"].is_primary is False


def test_merge_never_changes_name_slug_published(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = _make_player(db, countries=[], display_name="Keep Me")
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Keep Me"
    assert body["is_published"] is False  # target's own value, source was published


def test_preview_reports_and_changes_nothing(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = _make_player(db, countries=["IE"], bio="Source bio")
    target = _make_player(db, countries=["FR"])
    conflict_quiz = create_approved_event(db)
    other_quiz = create_approved_event(db)
    crud.create_quiz_results(
        session=db,
        event_id=conflict_quiz.id,
        results=[
            QuizResultCreate(player_id=source.id, final_rank=2, score=20.0),
            QuizResultCreate(player_id=target.id, final_rank=1, score=80.0),
        ],
    )
    crud.create_quiz_results(
        session=db,
        event_id=other_quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=1, score=70.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["moved_results_count"] == 1
    assert len(body["conflicts"]) == 1
    conflict = body["conflicts"][0]
    assert conflict["quiz_id"] == str(conflict_quiz.id)
    assert conflict["quiz_name"] == conflict_quiz.name
    assert conflict["source_score"] == 20.0
    assert conflict["target_score"] == 80.0
    assert body["filled_fields"] == ["bio"]
    assert body["added_countries"] == ["IE"]
    # read-only: nothing changed
    db.expire_all()
    assert db.get(Player, source.id) is not None
    assert (
        len(
            db.exec(
                select(QuizResult).where(col(QuizResult.player_id) == source.id)
            ).all()
        )
        == 2
    )
    assert db.exec(select(PlayerMergeAudit)).first() is None


def test_merge_writes_audit_row(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    quiz = create_approved_event(db)
    crud.create_quiz_results(
        session=db,
        event_id=quiz.id,
        results=[QuizResultCreate(player_id=source.id, final_rank=1, score=1.0)],
    )
    source_name, source_slug, source_id = (
        source.display_name,
        source.slug,
        source.id,
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    db.expire_all()
    audits = db.exec(select(PlayerMergeAudit)).all()
    assert len(audits) == 1
    audit = audits[0]
    assert audit.source_player_id == source_id
    assert audit.source_display_name == source_name
    assert audit.source_slug == source_slug
    assert audit.target_player_id == target.id
    assert audit.target_display_name == target.display_name
    assert audit.moved_results_count == 1
    assert audit.deleted_conflicts_count == 0
    assert audit.performed_by_email == settings.FIRST_SUPERUSER


def test_list_merges_newest_first_superuser_only(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict,
    normal_user_token_headers: dict,
) -> None:
    a = create_published_player(db)
    b = create_published_player(db)
    c = create_published_player(db)
    client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(a, c),
        headers=superuser_token_headers,
    )
    client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(b, c),
        headers=superuser_token_headers,
    )
    r = client.get(
        f"{settings.API_V1_STR}/players/merges", headers=superuser_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert body["data"][0]["source_player_id"] == str(b.id)  # newest first
    assert body["data"][1]["source_player_id"] == str(a.id)
    r403 = client.get(
        f"{settings.API_V1_STR}/players/merges", headers=normal_user_token_headers
    )
    assert r403.status_code == 403


def test_merge_requires_superuser(
    client: TestClient, db: Session, normal_user_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    for path in ("/players/merge", "/players/merge/preview"):
        r = client.post(
            f"{settings.API_V1_STR}{path}",
            json=_payload(source, target),
            headers=normal_user_token_headers,
        )
        assert r.status_code == 403


def test_merge_validation_errors(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    player = create_published_player(db)
    r_same = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(player, player),
        headers=superuser_token_headers,
    )
    assert r_same.status_code == 400
    r_missing = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json={
            "source_player_id": str(uuid.uuid4()),
            "target_player_id": str(player.id),
        },
        headers=superuser_token_headers,
    )
    assert r_missing.status_code == 404
