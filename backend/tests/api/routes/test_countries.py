from collections.abc import Generator
from datetime import date
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app import crud
from app.core.config import settings
from app.countries import COUNTRY_NAMES
from app.country_page import COUNTRY_CODE_BY_SLUG, country_slug
from app.models import Player, PlayerCreate, Quiz, QuizParticipantMode, QuizStatus
from tests.utils.quiz import create_random_quiz
from tests.utils.utils import random_lower_string

API = f"{settings.API_V1_STR}/countries"


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


def _player(
    db: Session,
    countries: list[str],
    *,
    published: bool = True,
    name: str | None = None,
) -> Player:
    player = crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=name or f"Country {random_lower_string()}",
            countries=countries,
        ),
    )
    player.is_published = published
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


def _quiz(
    client: TestClient,
    db: Session,
    headers: dict[str, str],
    results: list[dict[str, Any]],
    *,
    mode: QuizParticipantMode = QuizParticipantMode.individual,
    qualifier: bool = False,
    status: QuizStatus = QuizStatus.approved,
    start: date = date(2024, 1, 1),
) -> Quiz:
    """An approved quiz with these results; `status` is applied afterwards so
    a pending or rejected quiz can still carry results."""
    quiz = create_random_quiz(db)
    quiz.status = QuizStatus.approved
    quiz.participant_mode = mode
    quiz.is_qualifier = qualifier
    quiz.start_date = start
    quiz.end_date = start
    db.add(quiz)
    db.commit()
    response = client.post(
        f"{settings.API_V1_STR}/quizzes/{quiz.id}/results",
        headers=headers,
        json={"results": results, "mode": "append"},
    )
    assert response.status_code == 200, response.text
    if status != QuizStatus.approved:
        quiz.status = status
        db.add(quiz)
        db.commit()
    db.refresh(quiz)
    return quiz


def _row(rank: int, *participants: tuple[Player, str | None]) -> dict[str, Any]:
    return {
        "final_rank": rank,
        "score": 100 - rank,
        "participants": [
            {"player_id": str(player.id), "country": country}
            for player, country in participants
        ],
    }


def _page(client: TestClient, slug: str = "canada") -> dict[str, Any]:
    response = client.get(f"{API}/{slug}")
    assert response.status_code == 200, response.text
    return response.json()


def _entry(page: dict[str, Any], player: Player) -> dict[str, Any] | None:
    return next((p for p in page["players"] if p["player_id"] == str(player.id)), None)


def _ours(entries: list[dict[str, Any]], *players: Player) -> list[str]:
    """Our fixture players' ids, in the order the page lists them."""
    ids = {str(p.id) for p in players}
    return [e["player_id"] for e in entries if e["player_id"] in ids]


def _delta(before: dict[str, Any], after: dict[str, Any], key: str) -> int:
    return after["stats"][key] - before["stats"][key]


def _medal_delta(before: dict[str, Any], after: dict[str, Any]) -> tuple[int, int, int]:
    b, a = before["stats"]["medals"], after["stats"]["medals"]
    return (a["gold"] - b["gold"], a["silver"] - b["silver"], a["bronze"] - b["bronze"])


def test_every_country_has_a_unique_slug_that_round_trips() -> None:
    assert len(COUNTRY_CODE_BY_SLUG) == len(COUNTRY_NAMES)
    for code in COUNTRY_NAMES:
        assert COUNTRY_CODE_BY_SLUG[country_slug(code)] == code


def test_slugs_follow_the_site_slug_rule() -> None:
    # Pinned byte-for-byte in frontend/tests/countries.test.ts as well.
    assert country_slug("CA") == "canada"
    assert country_slug("AE") == "united-arab-emirates"
    assert country_slug("AX") == "åland-islands"
    assert country_slug("CI") == "côte-divoire"
    assert country_slug("VI") == "us-virgin-islands"
    assert country_slug("CD") == "congo-democratic-republic"


def test_known_slug_returns_the_country(client: TestClient) -> None:
    response = client.get(f"{API}/united-arab-emirates")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"] == "AE"
    assert body["name"] == "United Arab Emirates"
    assert body["slug"] == "united-arab-emirates"
    assert set(body) == {
        "code",
        "name",
        "slug",
        "stats",
        "players",
        "medal_table",
        "national_teams",
        "national_team_medals",
    }
    assert set(body["stats"]) == {
        "quizzer_count",
        "competed_count",
        "quiz_count",
        "medals",
    }
    assert set(body["stats"]["medals"]) == {"gold", "silver", "bronze"}


def test_percent_encoded_non_ascii_slug_resolves(client: TestClient) -> None:
    response = client.get(f"{API}/{quote('åland-islands')}")
    assert response.status_code == 200, response.text
    assert response.json()["code"] == "AX"


def test_unknown_slug_is_404(client: TestClient) -> None:
    response = client.get(f"{API}/atlantis")
    assert response.status_code == 404
    assert response.json()["detail"] == "Country not found"


def test_a_country_code_is_not_a_slug(client: TestClient) -> None:
    assert client.get(f"{API}/ca").status_code == 404
    assert client.get(f"{API}/CA").status_code == 404


def test_profile_only_player_is_listed_but_has_not_competed(
    client: TestClient, db: Session
) -> None:
    before = _page(client)
    player = _player(db, ["CA"])
    after = _page(client)

    entry = _entry(after, player)
    assert entry is not None
    assert entry["quiz_count"] == 0
    assert _delta(before, after, "quizzer_count") == 1
    assert _delta(before, after, "competed_count") == 0


def test_non_primary_profile_country_still_lists_the_player(
    client: TestClient, db: Session
) -> None:
    player = _player(db, ["IE", "CA"])
    assert _entry(_page(client), player) is not None


def test_result_country_counts_as_competed_even_without_it_on_profile(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    player = _player(db, ["IE"])
    _quiz(client, db, organizer_token_headers, [_row(5, (player, "CA"))])
    after = _page(client)

    entry = _entry(after, player)
    assert entry is not None and entry["quiz_count"] == 1
    assert _delta(before, after, "quizzer_count") == 1
    assert _delta(before, after, "competed_count") == 1
    assert _delta(before, after, "quiz_count") == 1
    # Listed on Ireland by profile, but that quiz was played for Canada.
    ireland = _entry(_page(client, "ireland"), player)
    assert ireland is not None and ireland["quiz_count"] == 0


def test_null_result_country_falls_back_to_primary_profile_country(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    player = _player(db, ["CA", "IE"])  # CA is primary
    _quiz(client, db, organizer_token_headers, [_row(5, (player, None))])

    canada = _entry(_page(client), player)
    assert canada is not None and canada["quiz_count"] == 1
    ireland = _entry(_page(client, "ireland"), player)
    assert ireland is not None and ireland["quiz_count"] == 0


def test_a_player_is_counted_once_however_often_they_competed(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    player = _player(db, ["CA"])
    for _ in range(2):
        _quiz(client, db, organizer_token_headers, [_row(5, (player, "CA"))])
    after = _page(client)

    assert [p["player_id"] for p in after["players"]].count(str(player.id)) == 1
    assert _entry(after, player)["quiz_count"] == 2  # type: ignore[index]
    assert _delta(before, after, "quizzer_count") == 1
    assert _delta(before, after, "competed_count") == 1
    assert _delta(before, after, "quiz_count") == 2


def test_unpublished_players_are_excluded(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    hidden = _player(db, ["CA"], published=False)
    _quiz(client, db, organizer_token_headers, [_row(1, (hidden, "CA"))])
    after = _page(client)

    assert _entry(after, hidden) is None
    assert _delta(before, after, "quizzer_count") == 0
    assert _medal_delta(before, after) == (0, 0, 0)


def test_pending_and_rejected_quizzes_are_excluded(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    player = _player(db, ["IE"])
    for status in (QuizStatus.pending, QuizStatus.rejected):
        _quiz(
            client,
            db,
            organizer_token_headers,
            [_row(1, (player, "CA"))],
            status=status,
        )
    assert _entry(_page(client), player) is None


def test_individual_medals_skip_qualifiers_and_drive_ordering(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    gold, silver, fourth = (_player(db, ["CA"]) for _ in range(3))
    _quiz(
        client,
        db,
        organizer_token_headers,
        [_row(1, (gold, "CA")), _row(2, (silver, "CA")), _row(4, (fourth, "CA"))],
    )
    _quiz(
        client, db, organizer_token_headers, [_row(1, (fourth, "CA"))], qualifier=True
    )
    after = _page(client)

    assert _medal_delta(before, after) == (1, 1, 0)
    fourth_entry = _entry(after, fourth)
    assert fourth_entry is not None
    assert (fourth_entry["gold"], fourth_entry["quiz_count"]) == (0, 2)
    assert _ours(after["medal_table"], gold, silver, fourth) == [
        str(gold.id),
        str(silver.id),
    ]
    assert _ours(after["players"], gold, silver, fourth) == [
        str(gold.id),
        str(silver.id),
        str(fourth.id),
    ]


def test_pairs_credit_each_partner_to_their_own_country(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    a, b, c = (_player(db, ["CA"]) for _ in range(3))
    d = _player(db, ["IE"])
    _quiz(
        client,
        db,
        organizer_token_headers,
        [_row(1, (a, "CA"), (b, "CA")), _row(2, (c, "CA"), (d, "AE"))],
        mode=QuizParticipantMode.pairs,
    )

    canada = _page(client)
    assert _entry(canada, a)["gold"] == 1  # type: ignore[index]
    assert _entry(canada, b)["gold"] == 1  # type: ignore[index]
    assert _entry(canada, c)["silver"] == 1  # type: ignore[index]
    assert _entry(canada, d) is None
    uae = _entry(_page(client, "united-arab-emirates"), d)
    assert uae is not None and uae["silver"] == 1


def test_players_without_medals_sort_by_quizzes_then_name_ignoring_case(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    suffix = random_lower_string()
    busy = _player(db, ["CA"], name=f"{suffix} zulu")
    beta = _player(db, ["CA"], name=f"{suffix} Beta")
    alpha = _player(db, ["CA"], name=f"{suffix} alpha")
    for _ in range(2):
        _quiz(client, db, organizer_token_headers, [_row(9, (busy, "CA"))])
    _quiz(client, db, organizer_token_headers, [_row(9, (beta, "CA"))])
    _quiz(client, db, organizer_token_headers, [_row(9, (alpha, "CA"))])

    assert _ours(_page(client)["players"], busy, beta, alpha) == [
        str(busy.id),
        str(alpha.id),
        str(beta.id),
    ]


def _team(
    rank: int,
    participants: list[tuple[Player, str | None]],
    *,
    country: str | None,
    team_type: str = "national",
    name: str | None = None,
) -> dict[str, Any]:
    return {
        **_row(rank, *participants),
        "team_name": name or f"Team {random_lower_string()}",
        "team_type": team_type,
        "team_country": country,
    }


def _appearance(page: dict[str, Any], quiz: Quiz) -> dict[str, Any] | None:
    return next(
        (t for t in page["national_teams"] if t["quiz_id"] == str(quiz.id)), None
    )


def _team_medal_delta(
    before: dict[str, Any], after: dict[str, Any]
) -> tuple[int, int, int]:
    b, a = before["national_team_medals"], after["national_team_medals"]
    return (a["gold"] - b["gold"], a["silver"] - b["silver"], a["bronze"] - b["bronze"])


TEAMS = QuizParticipantMode.teams


def test_national_team_appearance_lists_squad_and_earns_a_team_medal(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    irish_profile = _player(db, ["IE"])
    canadian = _player(db, ["CA"])
    quiz = _quiz(
        client,
        db,
        organizer_token_headers,
        [
            _team(
                1,
                [(irish_profile, None), (canadian, None)],
                country="CA",
                name="Canada A",
            )
        ],
        mode=TEAMS,
    )
    after = _page(client)

    appearance = _appearance(after, quiz)
    assert appearance is not None
    assert appearance["team_name"] == "Canada A"
    assert appearance["final_rank"] == 1
    assert appearance["is_qualifier"] is False
    assert {m["player_id"] for m in appearance["members"]} == {
        str(irish_profile.id),
        str(canadian.id),
    }
    assert _team_medal_delta(before, after) == (1, 0, 0)
    # A team gold is not a gold for each member.
    assert _medal_delta(before, after) == (0, 0, 0)
    member = _entry(after, irish_profile)
    assert member is not None
    assert (member["quiz_count"], member["gold"]) == (1, 0)
    # Playing for Canada's national team is not playing for Ireland.
    ireland = _entry(_page(client, "ireland"), irish_profile)
    assert ireland is not None and ireland["quiz_count"] == 0


def test_member_row_country_is_overridden_by_the_national_team(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    member = _player(db, ["IE"])
    _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(5, [(member, "AE")], country="CA")],
        mode=TEAMS,
    )
    assert _entry(_page(client), member)["quiz_count"] == 1  # type: ignore[index]
    assert _entry(_page(client, "united-arab-emirates"), member) is None


def test_international_side_credits_no_country(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    member = _player(db, ["CA"])
    _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(1, [(member, None)], country=None)],
        mode=TEAMS,
    )
    entry = _entry(_page(client), member)
    assert entry is not None
    assert (entry["quiz_count"], entry["gold"]) == (0, 0)


def test_club_team_counts_as_competed_but_earns_nothing_and_is_not_listed(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    member = _player(db, ["CA"])
    quiz = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(1, [(member, None)], country="CA", team_type="club")],
        mode=TEAMS,
    )
    after = _page(client)

    entry = _entry(after, member)
    assert entry is not None
    assert (entry["quiz_count"], entry["gold"]) == (1, 0)
    assert _appearance(after, quiz) is None
    assert _team_medal_delta(before, after) == (0, 0, 0)


def test_squadless_national_team_still_appears_and_counts_its_quiz(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    quiz = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(2, [], country="CA")],
        mode=TEAMS,
    )
    after = _page(client)

    appearance = _appearance(after, quiz)
    assert appearance is not None and appearance["members"] == []
    assert _delta(before, after, "quiz_count") == 1
    assert _team_medal_delta(before, after) == (0, 1, 0)


def test_qualifier_national_team_podium_earns_no_team_medal(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    before = _page(client)
    quiz = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(1, [], country="CA")],
        mode=TEAMS,
        qualifier=True,
    )
    after = _page(client)

    appearance = _appearance(after, quiz)
    assert appearance is not None and appearance["is_qualifier"] is True
    assert _team_medal_delta(before, after) == (0, 0, 0)


def test_unpublished_member_is_hidden_from_the_squad(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    shown = _player(db, ["CA"])
    hidden = _player(db, ["CA"], published=False)
    quiz = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(4, [(shown, None), (hidden, None)], country="CA")],
        mode=TEAMS,
    )
    appearance = _appearance(_page(client), quiz)
    assert appearance is not None
    assert [m["player_id"] for m in appearance["members"]] == [str(shown.id)]


def test_national_teams_are_listed_newest_first(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    older = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(4, [], country="CA")],
        mode=TEAMS,
        start=date(2023, 5, 1),
    )
    newer = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(4, [], country="CA")],
        mode=TEAMS,
        start=date(2025, 5, 1),
    )
    ours = [
        t["quiz_id"]
        for t in _page(client)["national_teams"]
        if t["quiz_id"] in {str(older.id), str(newer.id)}
    ]
    assert ours == [str(newer.id), str(older.id)]


def test_pending_quiz_national_team_is_excluded(
    client: TestClient, db: Session, organizer_token_headers: dict[str, str]
) -> None:
    quiz = _quiz(
        client,
        db,
        organizer_token_headers,
        [_team(1, [], country="CA")],
        mode=TEAMS,
        status=QuizStatus.pending,
    )
    assert _appearance(_page(client), quiz) is None
