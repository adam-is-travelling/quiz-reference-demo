import uuid
from collections.abc import Generator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app import crud
from app.models import (
    Player,
    PlayerCountry,
    PlayerCreate,
    Quiz,
    QuizResult,
    QuizResultCreate,
    QuizResultPlayer,
    QuizResultUpdate,
    ResultParticipantCreate,
)
from tests.utils.quiz import create_approved_quiz, create_random_player
from tests.utils.utils import random_lower_string


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


# --- A participant's country joins that player's own country list ---


def _player_countries(db: Session, player_id: uuid.UUID) -> list[tuple[str, bool]]:
    """(code, is_primary) for a player, ordered by code."""
    rows = db.exec(
        select(PlayerCountry)
        .where(PlayerCountry.player_id == player_id)
        .order_by(col(PlayerCountry.code))
    ).all()
    return [(r.code, r.is_primary) for r in rows]


def _submit(
    db: Session,
    quiz: Quiz,
    participants: list[ResultParticipantCreate],
) -> QuizResult:
    results = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(final_rank=1, score=10.0, participants=participants)
        ],
    )
    return results[0]


def test_submitting_a_new_country_adds_it_to_the_player(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)  # starts with IE, primary
    _submit(db, quiz, [ResultParticipantCreate(player_id=alice.id, country="GB")])

    assert _player_countries(db, alice.id) == [("GB", False), ("IE", True)]


def test_a_players_first_country_from_a_result_becomes_primary(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name=random_lower_string(), countries=[]),
    )
    _submit(db, quiz, [ResultParticipantCreate(player_id=alice.id, country="GB")])

    assert _player_countries(db, alice.id) == [("GB", True)]


def test_a_country_the_player_already_has_is_left_alone(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)  # starts with IE, primary
    _submit(db, quiz, [ResultParticipantCreate(player_id=alice.id, country="IE")])

    assert _player_countries(db, alice.id) == [("IE", True)]


def test_a_participant_without_a_country_adds_nothing(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    _submit(db, quiz, [ResultParticipantCreate(player_id=alice.id, country=None)])

    assert _player_countries(db, alice.id) == [("IE", True)]


def test_editing_a_results_country_keeps_the_previous_one(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    result = _submit(
        db, quiz, [ResultParticipantCreate(player_id=alice.id, country="GB")]
    )

    crud.update_quiz_result(
        session=db,
        db_result=result,
        result_in=QuizResultUpdate(
            participants=[ResultParticipantCreate(player_id=alice.id, country="FR")]
        ),
    )

    assert _player_countries(db, alice.id) == [
        ("FR", False),
        ("GB", False),
        ("IE", True),
    ]


def test_resubmitting_the_same_result_adds_no_duplicate(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = create_random_player(db)
    participants = [ResultParticipantCreate(player_id=alice.id, country="GB")]
    _submit(db, quiz, participants)
    _submit(db, quiz, participants)

    assert _player_countries(db, alice.id) == [("GB", False), ("IE", True)]


def test_two_new_countries_in_one_submit_yield_one_primary(db: Session) -> None:
    quiz = create_approved_quiz(db)
    alice = crud.create_player(
        session=db,
        player_in=PlayerCreate(display_name=random_lower_string(), countries=[]),
    )
    bob = create_random_player(db)
    _submit(
        db,
        quiz,
        [
            ResultParticipantCreate(player_id=alice.id, country="GB"),
            ResultParticipantCreate(player_id=bob.id, country="FR"),
        ],
    )

    assert _player_countries(db, alice.id) == [("GB", True)]
    assert _player_countries(db, bob.id) == [("FR", False), ("IE", True)]
