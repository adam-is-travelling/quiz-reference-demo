import uuid
from collections.abc import Generator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app.models import Player, Quiz, QuizResult, QuizResultPlayer
from tests.utils.quiz import create_approved_quiz, create_random_player


@pytest.fixture(autouse=True)
def clean_data(db: Session) -> Generator[None, None, None]:
    pre_quizzes = {r.id for r in db.exec(select(Quiz)).all()}
    pre_players = {r.id for r in db.exec(select(Player)).all()}
    yield
    db.rollback()
    db.expire_all()
    new_quiz_ids = {r.id for r in db.exec(select(Quiz)).all()} - pre_quizzes
    if new_quiz_ids:
        db.execute(delete(Quiz).where(col(Quiz.id).in_(new_quiz_ids)))
    new_player_ids = {r.id for r in db.exec(select(Player)).all()} - pre_players
    if new_player_ids:
        db.execute(delete(Player).where(col(Player.id).in_(new_player_ids)))
    db.commit()


def _result(db: Session, quiz: Quiz, _player: Player) -> QuizResult:
    result = QuizResult(quiz_id=quiz.id, score=10.0, final_rank=1)
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


def test_two_participants_share_one_result(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    result = _result(db, quiz, alice)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=2, quiz_id=quiz.id, player_id=bob.id
        )
    )
    db.commit()

    rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [r.slot for r in rows] == [1, 2]
    assert [r.player_id for r in rows] == [alice.id, bob.id]


def test_country_is_per_participant_and_nullable(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    result = _result(db, quiz, alice)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id,
            slot=1,
            quiz_id=quiz.id,
            player_id=alice.id,
            country="IE",
        )
    )
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=2, quiz_id=quiz.id, player_id=bob.id
        )
    )
    db.commit()
    rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [r.country for r in rows] == ["IE", None]


def test_same_player_cannot_fill_both_slots_of_one_pair(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    result = _result(db, quiz, alice)
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.add(
        QuizResultPlayer(
            quiz_result_id=result.id, slot=2, quiz_id=quiz.id, player_id=alice.id
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_player_cannot_appear_in_two_results_of_one_quiz(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice, bob = create_random_player(db), create_random_player(db)
    first = _result(db, quiz, alice)
    second = _result(db, quiz, bob)
    db.add(
        QuizResultPlayer(
            quiz_result_id=first.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.commit()
    db.add(
        QuizResultPlayer(
            quiz_result_id=second.id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()


def test_participants_are_deleted_with_their_result(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    result = _result(db, quiz, alice)
    result_id = result.id
    db.add(
        QuizResultPlayer(
            quiz_result_id=result_id, slot=1, quiz_id=quiz.id, player_id=alice.id
        )
    )
    db.commit()
    db.delete(result)
    db.commit()
    remaining = db.exec(
        select(QuizResultPlayer).where(
            QuizResultPlayer.quiz_result_id == result_id
        )
    ).all()
    assert remaining == []
