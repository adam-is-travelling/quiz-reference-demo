"""The public country page: who has represented a country, its national team
appearances, and the medals its quizzers have won.

See docs/superpowers/specs/2026-09-22-country-pages-design.md for the rules
this module implements.
"""

import uuid
from dataclasses import dataclass, field

from sqlmodel import Session, and_, col, or_, select

from app import crud
from app.countries import COUNTRY_NAMES
from app.models import (
    CountryPagePublic,
    CountryPlayer,
    CountryStats,
    CountryTeamAppearance,
    MedalCounts,
    Player,
    PlayerCountry,
    Quiz,
    QuizResult,
    QuizResultPlayer,
    QuizStatus,
    TeamType,
)

# Built once: country names are static, and slugify is the same rule every
# other slugged entity uses. The unit tests pin that no two names collide.
COUNTRY_CODE_BY_SLUG: dict[str, str] = {
    crud.slugify(name): code for code, name in COUNTRY_NAMES.items()
}


def country_slug(code: str) -> str:
    return crud.slugify(COUNTRY_NAMES[code])


def _add_medal(counts: MedalCounts, rank: int | None) -> None:
    if rank == 1:
        counts.gold += 1
    elif rank == 2:
        counts.silver += 1
    elif rank == 3:
        counts.bronze += 1


def _competed_country(
    participant: QuizResultPlayer,
    result: QuizResult,
    fallback: dict[uuid.UUID, str | None],
) -> str | None:
    """The country this participant competed under on this result.

    A national team plays for its own country — an international side (no
    team_country) for none — whatever its members' own countries are. Every
    other result uses the participant's recorded country, falling back to
    their primary profile country exactly as build_participants_public does.
    """
    if result.team_type == TeamType.national:
        return result.team_country
    return participant.country or fallback.get(participant.player_id)


@dataclass
class _Tally:
    quiz_ids: set[uuid.UUID] = field(default_factory=set)
    medals: MedalCounts = field(default_factory=MedalCounts)


def _medal_sort_key(player: CountryPlayer) -> tuple[int, int, int]:
    return (-player.gold, -player.silver, -player.bronze)


def _national_teams(*, session: Session, code: str) -> list[CountryTeamAppearance]:
    """Every approved national team result for this country, squad included.

    Queried from the results themselves rather than from their participants:
    a team recorded with no squad is a legal state and still an appearance.
    """
    rows = session.exec(
        select(QuizResult, Quiz)
        .join(Quiz, col(Quiz.id) == col(QuizResult.quiz_id))
        .where(
            Quiz.status == QuizStatus.approved,
            QuizResult.team_type == TeamType.national,
            QuizResult.team_country == code,
        )
    ).all()

    members_by_result = crud.build_participants_public(
        session=session, result_ids=[result.id for result, _quiz in rows]
    )
    member_ids = {
        m.player_id for members in members_by_result.values() for m in members
    }
    published = (
        set(
            session.exec(
                select(Player.id).where(
                    col(Player.id).in_(member_ids), col(Player.is_published).is_(True)
                )
            ).all()
        )
        if member_ids
        else set()
    )

    appearances = [
        CountryTeamAppearance(
            result_id=result.id,
            team_name=result.team_name,
            quiz_id=quiz.id,
            quiz_name=quiz.name,
            quiz_slug=quiz.slug,
            start_date=quiz.start_date,
            end_date=quiz.end_date,
            is_qualifier=quiz.is_qualifier,
            final_rank=result.final_rank,
            members=[
                m
                for m in members_by_result.get(result.id, [])
                if m.player_id in published
            ],
        )
        for result, quiz in rows
    ]
    appearances.sort(
        key=lambda a: (
            -a.start_date.toordinal(),
            a.quiz_name.casefold(),
            a.final_rank if a.final_rank is not None else 1_000_000,
        )
    )
    return appearances


def build_country_page(*, session: Session, code: str) -> CountryPagePublic:
    profile_ids = set(
        session.exec(
            select(PlayerCountry.player_id)
            .join(Player, col(Player.id) == col(PlayerCountry.player_id))
            .where(PlayerCountry.code == code, col(Player.is_published).is_(True))
        ).all()
    )

    # Every approved-quiz participant row that could resolve to this country.
    # A null row country can only fall back to it for a player who holds it on
    # their profile, so the subquery keeps this from scanning every null row.
    rows = session.exec(
        select(QuizResultPlayer, QuizResult, Quiz)
        .join(QuizResult, col(QuizResult.id) == col(QuizResultPlayer.quiz_result_id))
        .join(Quiz, col(Quiz.id) == col(QuizResultPlayer.quiz_id))
        .join(Player, col(Player.id) == col(QuizResultPlayer.player_id))
        .where(
            Quiz.status == QuizStatus.approved,
            col(Player.is_published).is_(True),
            or_(
                QuizResultPlayer.country == code,
                and_(
                    QuizResult.team_type == TeamType.national,
                    QuizResult.team_country == code,
                ),
                and_(
                    col(QuizResultPlayer.country).is_(None),
                    col(QuizResultPlayer.player_id).in_(
                        select(PlayerCountry.player_id).where(
                            PlayerCountry.code == code
                        )
                    ),
                ),
            ),
        )
    ).all()

    fallback = crud._primary_countries(
        session=session,
        player_ids=[p.player_id for p, _result, _quiz in rows if p.country is None],
    )

    tallies: dict[uuid.UUID, _Tally] = {}
    quiz_ids: set[uuid.UUID] = set()
    for participant, result, quiz in rows:
        if _competed_country(participant, result, fallback) != code:
            continue
        tally = tallies.setdefault(participant.player_id, _Tally())
        tally.quiz_ids.add(quiz.id)
        quiz_ids.add(quiz.id)
        # Team results (national or club) never become individual medals.
        if result.team_type is None and not quiz.is_qualifier:
            _add_medal(tally.medals, result.final_rank)

    player_ids = profile_ids | tallies.keys()
    players = (
        session.exec(select(Player).where(col(Player.id).in_(player_ids))).all()
        if player_ids
        else []
    )

    country_players: list[CountryPlayer] = []
    for player in players:
        tally = tallies.get(player.id, _Tally())
        country_players.append(
            CountryPlayer(
                player_id=player.id,
                display_name=player.display_name,
                slug=player.slug,
                quiz_count=len(tally.quiz_ids),
                gold=tally.medals.gold,
                silver=tally.medals.silver,
                bronze=tally.medals.bronze,
            )
        )
    country_players.sort(
        key=lambda p: (*_medal_sort_key(p), -p.quiz_count, p.display_name.casefold())
    )
    medal_table = sorted(
        (p for p in country_players if p.gold or p.silver or p.bronze),
        key=lambda p: (*_medal_sort_key(p), p.display_name.casefold()),
    )

    national_teams = _national_teams(session=session, code=code)
    national_team_medals = MedalCounts()
    for appearance in national_teams:
        # A squadless appearance is still the country taking part in a quiz.
        quiz_ids.add(appearance.quiz_id)
        if not appearance.is_qualifier:
            _add_medal(national_team_medals, appearance.final_rank)

    return CountryPagePublic(
        code=code,
        name=COUNTRY_NAMES[code],
        slug=country_slug(code),
        stats=CountryStats(
            quizzer_count=len(country_players),
            competed_count=len(tallies),
            quiz_count=len(quiz_ids),
            medals=MedalCounts(
                gold=sum(p.gold for p in country_players),
                silver=sum(p.silver for p in country_players),
                bronze=sum(p.bronze for p in country_players),
            ),
        ),
        players=country_players,
        medal_table=medal_table,
        national_teams=national_teams,
        national_team_medals=national_team_medals,
    )
