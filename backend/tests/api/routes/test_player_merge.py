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
    QuizResultPlayer,
    ResultParticipantCreate,
)
from tests.utils.quiz import (
    create_approved_quiz,
    create_published_player,
    create_random_player,
)


@pytest.fixture(autouse=True)
def clean_merge_data(db: Session) -> Generator[None, None, None]:
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_audits = {r.id for r in db.exec(select(PlayerMergeAudit)).all()}
    yield
    db.expire_all()
    new_audit_ids = {r.id for r in db.exec(select(PlayerMergeAudit)).all()} - pre_audits
    if new_audit_ids:
        db.execute(
            delete(PlayerMergeAudit).where(col(PlayerMergeAudit.id).in_(new_audit_ids))
        )
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
    quiz = create_approved_quiz(db)
    source_id = source.id
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=2, score=50.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    assert r.json()["id"] == str(target.id)
    db.expire_all()
    target_result_ids = {
        p.quiz_result_id
        for p in db.exec(
            select(QuizResultPlayer).where(QuizResultPlayer.player_id == target.id)
        ).all()
    }
    moved = db.exec(
        select(QuizResult).where(col(QuizResult.id).in_(target_result_ids))
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
    conflict_quiz = create_approved_quiz(db)
    other_quiz = create_approved_quiz(db)
    source_id = source.id
    crud.create_quiz_results(
        session=db,
        quiz_id=conflict_quiz.id,
        results=[
            QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=5, score=10.0),
            QuizResultCreate(participants=[ResultParticipantCreate(player_id=target.id)], final_rank=1, score=99.0),
        ],
    )
    crud.create_quiz_results(
        session=db,
        quiz_id=other_quiz.id,
        results=[QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=3, score=42.0)],
    )
    r = client.post(
        f"{settings.API_V1_STR}/players/merge",
        json=_payload(source, target),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    db.expire_all()
    target_result_ids = {
        p.quiz_result_id
        for p in db.exec(
            select(QuizResultPlayer).where(QuizResultPlayer.player_id == target.id)
        ).all()
    }
    target_results = db.exec(
        select(QuizResult).where(col(QuizResult.id).in_(target_result_ids))
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
    conflict_quiz = create_approved_quiz(db)
    other_quiz = create_approved_quiz(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=conflict_quiz.id,
        results=[
            QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=2, score=20.0),
            QuizResultCreate(participants=[ResultParticipantCreate(player_id=target.id)], final_rank=1, score=80.0),
        ],
    )
    crud.create_quiz_results(
        session=db,
        quiz_id=other_quiz.id,
        results=[QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=1, score=70.0)],
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
                select(QuizResultPlayer).where(
                    QuizResultPlayer.player_id == source.id
                )
            ).all()
        )
        == 2
    )
    assert (
        db.exec(
            select(PlayerMergeAudit).where(
                PlayerMergeAudit.source_player_id == source.id
            )
        ).first()
        is None
    )


def test_merge_writes_audit_row(
    client: TestClient, db: Session, superuser_token_headers: dict
) -> None:
    source = create_published_player(db)
    target = create_published_player(db)
    quiz = create_approved_quiz(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=1, score=1.0)],
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
    audits = db.exec(
        select(PlayerMergeAudit).where(PlayerMergeAudit.source_player_id == source_id)
    ).all()
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
    pre_count = len(db.exec(select(PlayerMergeAudit)).all())
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
    assert body["count"] == pre_count + 2
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


def test_merge_detects_partners_in_the_same_result(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        QuizResultPlayer,
        ResultParticipantCreate,
    )

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    alice, bob = create_random_player(db), create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=alice.id),
                    ResultParticipantCreate(player_id=bob.id),
                ],
            )
        ],
    )

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    ).json()
    assert [c["kind"] for c in preview["conflicts"]] == ["same_result"]

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    )
    assert merged.status_code == 200

    # The shared result is gone, and no participant row survives it.
    assert (
        db.exec(
            select(QuizResultPlayer).where(QuizResultPlayer.quiz_id == quiz.id)
        ).all()
        == []
    )


def test_merge_within_a_squad_keeps_the_team_result_for_the_rest(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """Two members of a three-strong squad are the same person.

    Merging them is a "same_result" conflict — both hold a participant row
    on the one team result — but that result is no longer only theirs: it
    carries the team's score, rank, name, type and country, plus a third
    squad member. Deleting it would wipe the team out of the quiz.
    """
    from app.models import QuizParticipantMode, TeamType

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    db.add(quiz)
    db.commit()
    alice = create_random_player(db)
    bob = create_random_player(db)
    carol = create_random_player(db)
    carol_id = carol.id
    [result] = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=50.0,
                team_name="England A",
                team_type=TeamType.national,
                team_country="GB",
                participants=[
                    ResultParticipantCreate(player_id=alice.id),
                    ResultParticipantCreate(player_id=bob.id),
                    ResultParticipantCreate(player_id=carol.id),
                ],
            )
        ],
    )
    result_id = result.id

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    ).json()
    assert [c["kind"] for c in preview["conflicts"]] == ["same_result"]
    # Carol is neither source nor target and keeps her place — the preview
    # must say so rather than reassuring the admin there is no bystander.
    assert preview["conflicts"][0]["bystander_count"] == 1

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    )
    assert merged.status_code == 200

    db.expire_all()
    surviving = db.get(QuizResult, result_id)
    assert surviving is not None
    assert surviving.team_name == "England A"
    assert surviving.score == 50.0
    rows = db.exec(
        select(QuizResultPlayer).where(QuizResultPlayer.quiz_result_id == result_id)
    ).all()
    assert {r.player_id for r in rows} == {bob.id, carol_id}


def test_merge_of_a_two_member_squad_keeps_the_team_result(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """Both members of a two-strong squad turn out to be the same person.

    Nobody else is left on the result, so the count-based rule would treat
    it like a pair of one and delete it — taking the team's name, score,
    rank and its place in the standings with it. But a team's squad is just
    its participant rows, and a one-member squad is a legal, supported
    state: the team still competed and still scored. A team result is
    therefore never deleted by a merge; only source's own row goes.
    """
    from app.models import QuizParticipantMode, TeamType

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    db.add(quiz)
    db.commit()
    alice = create_random_player(db)
    bob = create_random_player(db)
    bob_id = bob.id
    [result] = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=3,
                score=42.0,
                team_name="Wales B",
                team_type=TeamType.national,
                team_country="GB",
                participants=[
                    ResultParticipantCreate(player_id=alice.id),
                    ResultParticipantCreate(player_id=bob.id),
                ],
            )
        ],
    )
    result_id = result.id

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    ).json()
    assert [c["kind"] for c in preview["conflicts"]] == ["same_result"]
    # bystander_count counts third parties on the result, and there are
    # none here. It is not a signal for whether the result survives — for a
    # team it always does.
    assert preview["conflicts"][0]["bystander_count"] == 0

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(alice.id), "target_player_id": str(bob.id)},
    )
    assert merged.status_code == 200

    db.expire_all()
    surviving = db.get(QuizResult, result_id)
    assert surviving is not None
    assert surviving.team_name == "Wales B"
    assert surviving.score == 42.0
    assert surviving.final_rank == 3
    rows = db.exec(
        select(QuizResultPlayer).where(QuizResultPlayer.quiz_result_id == result_id)
    ).all()
    assert [r.player_id for r in rows] == [bob_id]


def test_merge_detects_conflict_when_source_only_partnered_in_quiz(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """Source never headlines a result in the quiz — only partnered with a
    third player — while target holds a wholly separate result there. This
    used to slip past conflict detection entirely (it only scanned headline
    results) and blow up with an IntegrityError on merge."""
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        QuizResultPlayer,
        ResultParticipantCreate,
    )

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    carol = create_random_player(db)
    source = create_random_player(db)
    target = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=carol.id),
                    ResultParticipantCreate(player_id=source.id),
                ],
            ),
            QuizResultCreate(participants=[ResultParticipantCreate(player_id=target.id)], final_rank=2, score=30.0),
        ],
    )

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(source.id), "target_player_id": str(target.id)},
    ).json()
    assert [c["kind"] for c in preview["conflicts"]] == ["separate_results"]
    # Honest preview: carol is a bystander on source's result and will keep
    # it, not lose it — this must be visible before confirming, not just
    # "a conflicting result will be permanently deleted".
    assert preview["conflicts"][0]["bystander_count"] == 1

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(source.id), "target_player_id": str(target.id)},
    )
    assert merged.status_code == 200

    target_rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_id == quiz.id)
        .where(QuizResultPlayer.player_id == target.id)
    ).all()
    assert len(target_rows) == 1

    # The real regression: carol partnered source in that same result. She
    # is neither source nor target, and merging them must not silently
    # delete the whole result out from under her — she keeps the quiz.
    db.expire_all()
    carol_rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_id == quiz.id)
        .where(QuizResultPlayer.player_id == carol.id)
    ).all()
    assert len(carol_rows) == 1
    assert db.get(QuizResult, carol_rows[0].quiz_result_id) is not None


def test_merge_detects_conflict_when_target_only_partnered_in_quiz(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """Mirror of the above: target is the one who only partnered with a
    third player in the quiz, and source holds the separate headline
    result there."""
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        QuizResultPlayer,
        ResultParticipantCreate,
    )

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    carol = create_random_player(db)
    source = create_random_player(db)
    target = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=carol.id),
                    ResultParticipantCreate(player_id=target.id),
                ],
            ),
            QuizResultCreate(participants=[ResultParticipantCreate(player_id=source.id)], final_rank=2, score=30.0),
        ],
    )

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(source.id), "target_player_id": str(target.id)},
    ).json()
    assert [c["kind"] for c in preview["conflicts"]] == ["separate_results"]

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(source.id), "target_player_id": str(target.id)},
    )
    assert merged.status_code == 200

    target_rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_id == quiz.id)
        .where(QuizResultPlayer.player_id == target.id)
    ).all()
    assert len(target_rows) == 1


def test_merge_moves_partner_participation_with_no_target_stake(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    """Source partnered with a third player in a quiz the target has
    nothing to do with — no conflict, the participant row simply moves."""
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        QuizResultPlayer,
        ResultParticipantCreate,
    )

    quiz = create_approved_quiz(db)
    quiz.participant_mode = QuizParticipantMode.pairs
    db.add(quiz)
    db.commit()
    carol = create_random_player(db)
    source = create_random_player(db)
    target = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=carol.id),
                    ResultParticipantCreate(player_id=source.id),
                ],
            ),
        ],
    )

    preview = client.post(
        f"{settings.API_V1_STR}/players/merge/preview",
        headers=superuser_token_headers,
        json={"source_player_id": str(source.id), "target_player_id": str(target.id)},
    ).json()
    assert preview["conflicts"] == []
    assert preview["moved_results_count"] == 1

    merged = client.post(
        f"{settings.API_V1_STR}/players/merge",
        headers=superuser_token_headers,
        json={"source_player_id": str(source.id), "target_player_id": str(target.id)},
    )
    assert merged.status_code == 200

    rows = db.exec(
        select(QuizResultPlayer).where(QuizResultPlayer.quiz_id == quiz.id)
    ).all()
    assert {r.player_id for r in rows} == {carol.id, target.id}
