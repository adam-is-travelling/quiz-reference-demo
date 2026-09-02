from sqlmodel import Session

from app.models import Quiz, QuizResult, QuizResultPlayer
from app.podium import build_podium
from tests.utils.quiz import create_approved_quiz, create_random_player


def _add_result(
    db: Session, quiz: Quiz, player_id, rank: int, score: float
) -> QuizResult:
    result = QuizResult(
        quiz_id=quiz.id, player_id=player_id, score=score, final_rank=rank
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    # Every result has at least a slot-1 participant row (see the
    # quiz_result_player backfill migration) — mirror that invariant here so
    # standings tallies, which iterate participants, see this result's player.
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id,
            slot=1,
            quiz_id=quiz.id,
            player_id=player_id,
        )
    )
    db.commit()
    return result


def test_build_podium_with_no_quizzes(db: Session) -> None:
    podium = build_podium(session=db, quizzes=[])
    assert podium.quizzes == []
    assert podium.standings == []


def test_build_podium_tallies_medals_across_quizzes(db: Session) -> None:
    quiz_a = create_approved_quiz(db)
    quiz_b = create_approved_quiz(db)
    winner = create_random_player(db)
    runner_up = create_random_player(db)

    created = [
        _add_result(db, quiz_a, winner.id, 1, 100.0),
        _add_result(db, quiz_a, runner_up.id, 2, 90.0),
        _add_result(db, quiz_b, winner.id, 1, 80.0),
        _add_result(db, quiz_b, runner_up.id, 3, 60.0),
    ]
    try:
        podium = build_podium(session=db, quizzes=[quiz_a, quiz_b])

        assert len(podium.quizzes) == 2
        assert podium.standings[0].player_id == winner.id
        assert podium.standings[0].gold == 2
        assert podium.standings[0].silver == 0
        assert podium.standings[1].player_id == runner_up.id
        assert podium.standings[1].silver == 1
        assert podium.standings[1].bronze == 1
    finally:
        for result in created:
            db.delete(result)
        db.commit()


def test_build_podium_excludes_ranks_below_three(db: Session) -> None:
    quiz = create_approved_quiz(db)
    player = create_random_player(db)
    result = _add_result(db, quiz, player.id, 4, 10.0)
    try:
        podium = build_podium(session=db, quizzes=[quiz])
        assert podium.quizzes[0].finishers == []
        assert podium.standings == []
    finally:
        db.delete(result)
        db.commit()


def test_build_podium_breaks_standings_ties_by_name(db: Session) -> None:
    quiz = create_approved_quiz(db)
    zoe = create_random_player(db)
    zoe.display_name = "Zoe Adams"
    amy = create_random_player(db)
    amy.display_name = "Amy Baker"
    db.add(zoe)
    db.add(amy)
    db.commit()

    created = [
        _add_result(db, quiz, zoe.id, 1, 50.0),
        _add_result(db, quiz, amy.id, 2, 40.0),
    ]
    try:
        podium = build_podium(session=db, quizzes=[quiz])
        # Zoe has gold, Amy silver — gold outranks the name tiebreak
        assert [s.player_display_name for s in podium.standings] == [
            "Zoe Adams",
            "Amy Baker",
        ]
    finally:
        for result in created:
            db.delete(result)
        db.commit()


def test_pairs_podium_names_both_winners_and_credits_both(db: Session) -> None:
    from app import crud
    from app.models import (
        QuizParticipantMode,
        QuizResultCreate,
        ResultParticipantCreate,
    )
    from app.podium import build_podium

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
                player_id=alice.id,
                final_rank=1,
                score=50.0,
                participants=[
                    ResultParticipantCreate(player_id=alice.id),
                    ResultParticipantCreate(player_id=bob.id),
                ],
            )
        ],
    )

    podium = build_podium(session=db, quizzes=[quiz])

    finisher = podium.quizzes[0].finishers[0]
    assert {p.player_id for p in finisher.participants} == {alice.id, bob.id}
    golds = {s.player_id: s.gold for s in podium.standings}
    assert golds[alice.id] == 1
    assert golds[bob.id] == 1
