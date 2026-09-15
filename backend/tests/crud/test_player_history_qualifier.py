from collections.abc import Generator

import pytest
from sqlmodel import Session, col, delete, select

from app import crud
from app.models import (
    Player,
    Quiz,
    QuizResultCreate,
    ResultParticipantCreate,
)
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


def _win(db: Session, player: Player, *, is_qualifier: bool) -> Quiz:
    quiz = create_approved_quiz(db)
    quiz.is_qualifier = is_qualifier
    db.add(quiz)
    db.commit()
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=50.0,
                participants=[ResultParticipantCreate(player_id=player.id)],
            )
        ],
    )
    return quiz


def test_winning_a_qualifier_is_a_quiz_played_but_not_a_win(db: Session) -> None:
    player = create_random_player(db)
    _win(db, player, is_qualifier=False)
    _win(db, player, is_qualifier=True)

    history = crud.get_player_history_grouped(session=db, player_id=player.id)

    assert history.total_quizzes == 2
    assert history.wins == 1
    assert history.podiums == 1


def test_history_rows_report_whether_the_quiz_was_a_qualifier(db: Session) -> None:
    player = create_random_player(db)
    championship = _win(db, player, is_qualifier=False)
    qualifier = _win(db, player, is_qualifier=True)

    history = crud.get_player_history_grouped(session=db, player_id=player.id)

    rows = {row.quiz_id: row for group in history.data for row in group.results}
    assert rows[qualifier.id].is_qualifier is True
    assert rows[championship.id].is_qualifier is False
