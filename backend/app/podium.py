import uuid
from collections.abc import Sequence

from sqlmodel import Session, col, select

from app import crud
from app.models import (
    PodiumFinisher,
    PodiumPublic,
    PodiumStanding,
    Quiz,
    QuizPodium,
    QuizResult,
)


def build_podium(*, session: Session, quizzes: Sequence[Quiz]) -> PodiumPublic:
    """Per-quiz podiums plus aggregated gold/silver/bronze standings.

    `quizzes` is supplied by the caller already filtered and ordered — the
    competition route passes a competition's approved quizzes, the event
    route passes an event's. Quizzes appear in the response in the order
    given.
    """
    quiz_podiums: list[QuizPodium] = []
    tally: dict[uuid.UUID, PodiumStanding] = {}

    for quiz in quizzes:
        rows = session.exec(
            select(QuizResult)
            .where(
                QuizResult.quiz_id == quiz.id,
                col(QuizResult.final_rank).in_([1, 2, 3]),
            )
            .order_by(col(QuizResult.final_rank).asc())
        ).all()

        participants_by_result = crud.build_participants_public(
            session=session, result_ids=[result.id for result in rows]
        )

        quiz_podiums.append(
            QuizPodium(
                quiz_id=quiz.id,
                quiz_name=quiz.name,
                quiz_slug=quiz.slug,
                start_date=quiz.start_date,
                end_date=quiz.end_date,
                finishers=[
                    PodiumFinisher(
                        place=result.final_rank,  # non-null: filtered to 1/2/3
                        score=result.score,
                        participants=participants_by_result.get(result.id, []),
                    )
                    for result in rows
                ],
            )
        )

        for result in rows:
            for participant in participants_by_result.get(result.id, []):
                standing = tally.get(participant.player_id)
                if standing is None:
                    standing = PodiumStanding(
                        player_id=participant.player_id,
                        player_display_name=participant.player_display_name,
                        player_slug=participant.player_slug,
                        gold=0,
                        silver=0,
                        bronze=0,
                    )
                    tally[participant.player_id] = standing
                if result.final_rank == 1:
                    standing.gold += 1
                elif result.final_rank == 2:
                    standing.silver += 1
                elif result.final_rank == 3:
                    standing.bronze += 1

    standings = sorted(
        tally.values(),
        key=lambda s: (
            -s.gold,
            -s.silver,
            -s.bronze,
            s.player_display_name.lower(),
        ),
    )
    return PodiumPublic(quizzes=quiz_podiums, standings=standings)
