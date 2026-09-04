from collections.abc import Generator

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app import crud
from app.models import (
    Player,
    Quiz,
    QuizParticipantMode,
    QuizResult,
    QuizResultCreate,
    QuizResultPlayer,
    ResultParticipantCreate,
    TeamType,
)
from tests.utils.quiz import create_random_player, create_random_quiz


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


def _teams_quiz(db: Session) -> Quiz:
    quiz = create_random_quiz(db)
    quiz.participant_mode = QuizParticipantMode.teams
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return quiz


def test_creates_a_team_result_with_no_participants(db: Session) -> None:
    quiz = _teams_quiz(db)
    [result] = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=100.0,
                participants=[],
                team_name="England A",
                team_type=TeamType.national,
                team_country="GB",
            )
        ],
    )
    assert result.team_name == "England A"
    assert result.team_type == TeamType.national
    assert result.team_country == "GB"
    rows = db.exec(
        select(QuizResultPlayer).where(QuizResultPlayer.quiz_result_id == result.id)
    ).all()
    assert rows == []


def test_creates_a_team_result_with_a_squad(db: Session) -> None:
    quiz = _teams_quiz(db)
    a, b, c = (create_random_player(db) for _ in range(3))
    [result] = crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=100.0,
                participants=[
                    ResultParticipantCreate(player_id=p.id) for p in (a, b, c)
                ],
                team_name="Quiz Inn",
                team_type=TeamType.club,
                team_country=None,
            )
        ],
    )
    rows = db.exec(
        select(QuizResultPlayer)
        .where(QuizResultPlayer.quiz_result_id == result.id)
        .order_by(col(QuizResultPlayer.slot))
    ).all()
    assert [r.slot for r in rows] == [1, 2, 3]
    assert [r.player_id for r in rows] == [a.id, b.id, c.id]


def test_resubmitting_an_empty_team_updates_it_rather_than_duplicating(
    db: Session,
) -> None:
    quiz = _teams_quiz(db)
    payload = QuizResultCreate(
        final_rank=1,
        score=100.0,
        participants=[],
        team_name="England A",
        team_type=TeamType.national,
        team_country="GB",
    )
    crud.create_quiz_results(session=db, quiz_id=quiz.id, results=[payload])
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[payload.model_copy(update={"score": 120.0})],
    )
    results = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
    assert len(results) == 1
    assert results[0].score == 120.0


def test_team_name_match_is_case_insensitive(db: Session) -> None:
    quiz = _teams_quiz(db)
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=100.0,
                participants=[],
                team_name="England A",
                team_type=TeamType.national,
                team_country="GB",
            )
        ],
    )
    crud.create_quiz_results(
        session=db,
        quiz_id=quiz.id,
        results=[
            QuizResultCreate(
                final_rank=1,
                score=90.0,
                participants=[],
                team_name="england a",
                team_type=TeamType.national,
                team_country="GB",
            )
        ],
    )
    results = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
    assert len(results) == 1
    assert results[0].score == 90.0


def test_the_unique_index_rejects_a_duplicate_team_in_one_quiz(
    db: Session,
) -> None:
    """The crud upsert normally prevents this from ever being attempted, so
    the index is a backstop — exercise it directly rather than through the
    API, which would only ever see the upsert."""
    quiz = _teams_quiz(db)
    db.add(
        QuizResult(
            quiz_id=quiz.id,
            score=100.0,
            final_rank=1,
            team_name="England A",
            team_type=TeamType.national,
            team_country="GB",
        )
    )
    db.commit()
    db.add(
        QuizResult(
            quiz_id=quiz.id,
            score=90.0,
            final_rank=2,
            team_name="england a",
            team_type=TeamType.national,
            team_country="GB",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_the_same_team_name_in_two_quizzes_is_two_results(db: Session) -> None:
    first, second = _teams_quiz(db), _teams_quiz(db)
    for quiz in (first, second):
        crud.create_quiz_results(
            session=db,
            quiz_id=quiz.id,
            results=[
                QuizResultCreate(
                    final_rank=1,
                    score=100.0,
                    participants=[],
                    team_name="England A",
                    team_type=TeamType.national,
                    team_country="GB",
                )
            ],
        )
    for quiz in (first, second):
        rows = db.exec(select(QuizResult).where(QuizResult.quiz_id == quiz.id)).all()
        assert len(rows) == 1
