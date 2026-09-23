# Country Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public splash page per country at `/countries/<slug>` showing headline stats, a medal table, national team appearances and every player who has represented the country.

**Architecture:** One read-only endpoint, `GET /api/v1/countries/{slug}`, backed by a new assembly module `backend/app/country_page.py` (same shape as `app/podium.py`) that resolves each approved-quiz participant row to the country it was competed under and tallies players, quizzes and medals in Python after a handful of set-based queries. The frontend adds one route that renders the response, a `countrySlug` helper that mirrors the backend's slug rule, and `CountryLink`/`TeamAffiliation` components that turn existing country names into links.

**Tech Stack:** FastAPI + SQLModel (Postgres), pytest; React + TanStack Router/Query/Table, shadcn/ui, bun test, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-country-pages-design.md`

## Global Constraints

- Only quizzes with `status = approved` count; only players with `is_published = true` appear or are counted.
- Slug = `crud.slugify(name)` over `backend/app/countries.py` names. No transliteration (`Åland Islands` → `åland-islands`).
- Unknown slug → `404` with detail `"Country not found"`. Known country with no data → `200` with zeros and empty lists.
- National team result (`team_type = national`) → competed under `team_country` (null = international side = no country). Any other result → `quiz_result_player.country`, else the player's primary profile country via `crud._primary_countries` (the same fallback every other read path uses).
- Medal = `final_rank` 1–3 on a quiz with `is_qualifier = false`. Individual medals come only from results with `team_type IS NULL`. National team medals are reported separately and never expanded to members. Club team results earn no medals here.
- Ordering — `players`: gold, silver, bronze, quiz_count (all desc), then `display_name` casefolded; `medal_table`: gold, silver, bronze desc, then name; `national_teams`: `start_date` desc, then quiz name, then final_rank.
- Tests run against the shared dev DB: delete only rows you create (`backend/tests/test_cleanup_safety.py` enforces no bare `delete(Model)`), and assert stats as **deltas from a baseline** fetched before creating fixtures, never as absolute numbers.
- Run backend commands on the host from `backend/` with the repo-root venv (`../.venv/bin/pytest`, `../.venv/bin/ruff`). `docker compose exec backend` runs a stale baked image.
- Never run `docker compose down -v`.

## Review Focus

- A national team recorded with **no squad** — it must still appear in `national_teams` and its quiz must count in `stats.quiz_count` (the spec derives quiz_count from participants; this plan also counts national team appearances so the page cannot show a team appearance alongside "0 quizzes"). Pinned in Task 3.
- A **national team member whose own row country is a different country** — they count for the team's country only. Pinned in Task 3.
- A member of an **international side** (national, `team_country` null) whose profile country is X — must not be credited as competing for X via the fallback. Pinned in Task 3.
- A player who holds X on their profile **and** competed under X in several quizzes — counted once in `quizzer_count`, `quiz_count` counts distinct quizzes. Pinned in Task 2.
- A **non-ASCII slug arriving percent-encoded** (`/countries/%C3%A5land-islands`) — resolves, and the frontend produces byte-identical slugs. Pinned in Tasks 1 and 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models.py` (modify, append) | Response models: `MedalCounts`, `CountryStats`, `CountryPlayer`, `CountryTeamAppearance`, `CountryPagePublic` |
| `backend/app/country_page.py` (create) | Slug map, competed-country rule, page assembly |
| `backend/app/api/routes/countries.py` (create) | Thin route: slug → code → `build_country_page`, 404 |
| `backend/app/api/main.py` (modify) | Register the router |
| `backend/tests/api/routes/test_countries.py` (create) | All backend behaviour tests |
| `frontend/src/client/*` (regenerated) | `CountriesService.readCountry`, new types |
| `frontend/src/lib/countries.ts` (modify) | Fix `Britsh` typo, add `slugifyCountryName`, `countrySlug` |
| `frontend/tests/countries.test.ts` (modify) | Slug + backend-parity tests |
| `frontend/src/components/Common/CountryLink.tsx` (create) | `CountryLink`, `TeamAffiliation` |
| `frontend/src/components/Countries/CountryProfile.tsx` (create) | Page body: tiles, medal table, national teams, players |
| `frontend/src/routes/_public/countries_.$slug.tsx` (create) | Route, query, loading / not-found |
| `PlayerProfile.tsx`, `QuizResultsTable.tsx`, `historyColumns.tsx`, `CompetitionPodium.tsx`, `SquadCell.tsx`, `admin_.quizzes_.$id.tsx` (modify) | Link country names |
| `frontend/tests/countries-public.spec.ts` (create) | E2E |

---

### Task 1: Country endpoint skeleton — models, slugs, 404

**Files:**
- Modify: `backend/app/models.py` (append at end of file)
- Create: `backend/app/country_page.py`
- Create: `backend/app/api/routes/countries.py`
- Modify: `backend/app/api/main.py`
- Test: `backend/tests/api/routes/test_countries.py`

**Interfaces:**
- Produces:
  - `app.country_page.COUNTRY_CODE_BY_SLUG: dict[str, str]`
  - `app.country_page.country_slug(code: str) -> str`
  - `app.country_page.build_country_page(*, session: Session, code: str) -> CountryPagePublic`
  - Models listed below, with exactly these field names (the frontend and later tasks rely on them).
  - Route operation id `countries-read_country` → generated client `CountriesService.readCountry({ slug })`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/routes/test_countries.py`:

```python
from urllib.parse import quote

from fastapi.testclient import TestClient

from app.core.config import settings
from app.countries import COUNTRY_NAMES
from app.country_page import COUNTRY_CODE_BY_SLUG, country_slug

API = f"{settings.API_V1_STR}/countries"


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ../.venv/bin/pytest tests/api/routes/test_countries.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'app.country_page'`.

- [ ] **Step 3: Add the response models**

Append to the end of `backend/app/models.py`:

```python
# ---------------------------------------------------------------------------
# Country page
# ---------------------------------------------------------------------------


class MedalCounts(SQLModel):
    gold: int = 0
    silver: int = 0
    bronze: int = 0


class CountryStats(SQLModel):
    quizzer_count: int = 0
    competed_count: int = 0
    quiz_count: int = 0
    # Individual (and pairs) medals only; national team medals are reported
    # separately on CountryPagePublic.national_team_medals.
    medals: MedalCounts = Field(default_factory=MedalCounts)


class CountryPlayer(SQLModel):
    player_id: uuid.UUID
    display_name: str
    slug: str | None = None
    quiz_count: int = 0
    gold: int = 0
    silver: int = 0
    bronze: int = 0


class CountryTeamAppearance(SQLModel):
    result_id: uuid.UUID
    team_name: str | None = None
    quiz_id: uuid.UUID
    quiz_name: str
    quiz_slug: str | None = None
    start_date: date
    end_date: date
    is_qualifier: bool = False
    final_rank: int | None = None
    members: list[ResultParticipantPublic] = Field(default_factory=list)


class CountryPagePublic(SQLModel):
    code: str
    name: str
    slug: str
    stats: CountryStats = Field(default_factory=CountryStats)
    players: list[CountryPlayer] = Field(default_factory=list)
    medal_table: list[CountryPlayer] = Field(default_factory=list)
    national_teams: list[CountryTeamAppearance] = Field(default_factory=list)
    national_team_medals: MedalCounts = Field(default_factory=MedalCounts)
```

- [ ] **Step 4: Create the assembly module (skeleton)**

Create `backend/app/country_page.py`:

```python
"""The public country page: who has represented a country, its national team
appearances, and the medals its quizzers have won.

See docs/superpowers/specs/2026-09-22-country-pages-design.md for the rules
this module implements.
"""

from sqlmodel import Session

from app import crud
from app.countries import COUNTRY_NAMES
from app.models import CountryPagePublic

# Built once: country names are static, and slugify is the same rule every
# other slugged entity uses. The unit tests pin that no two names collide.
COUNTRY_CODE_BY_SLUG: dict[str, str] = {
    crud.slugify(name): code for code, name in COUNTRY_NAMES.items()
}


def country_slug(code: str) -> str:
    return crud.slugify(COUNTRY_NAMES[code])


def build_country_page(*, session: Session, code: str) -> CountryPagePublic:  # noqa: ARG001
    return CountryPagePublic(
        code=code, name=COUNTRY_NAMES[code], slug=country_slug(code)
    )
```

- [ ] **Step 5: Create the route and register it**

Create `backend/app/api/routes/countries.py`:

```python
from fastapi import APIRouter, HTTPException

from app.api.deps import SessionDep
from app.country_page import COUNTRY_CODE_BY_SLUG, build_country_page
from app.models import CountryPagePublic

router = APIRouter(prefix="/countries", tags=["countries"])


@router.get("/{slug}", response_model=CountryPagePublic)
def read_country(slug: str, session: SessionDep) -> CountryPagePublic:
    code = COUNTRY_CODE_BY_SLUG.get(slug)
    if code is None:
        raise HTTPException(status_code=404, detail="Country not found")
    return build_country_page(session=session, code=code)
```

In `backend/app/api/main.py`, add `countries` to the `from app.api.routes import (...)` list (alphabetical, after `competitions`) and register it after `players`:

```python
api_router.include_router(players.router)
api_router.include_router(countries.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && ../.venv/bin/pytest tests/api/routes/test_countries.py -v`
Expected: 7 passed.

- [ ] **Step 7: Lint and commit**

```bash
cd backend && ../.venv/bin/ruff check app tests && ../.venv/bin/ruff format app tests
cd .. && git add backend/app/models.py backend/app/country_page.py backend/app/api/routes/countries.py backend/app/api/main.py backend/tests/api/routes/test_countries.py
git commit -m "feat(backend): add country page endpoint skeleton with slug lookup"
```

---

### Task 2: Players, stats and individual medals

**Files:**
- Modify: `backend/app/country_page.py`
- Test: `backend/tests/api/routes/test_countries.py`

**Interfaces:**
- Consumes: Task 1 models and `build_country_page` signature; `crud._primary_countries(*, session, player_ids) -> dict[uuid.UUID, str | None]`.
- Produces (used by Task 3):
  - `_add_medal(counts: MedalCounts, rank: int | None) -> None`
  - `_competed_country(participant: QuizResultPlayer, result: QuizResult, fallback: dict[uuid.UUID, str | None]) -> str | None`
  - `build_country_page` fills `players`, `medal_table`, `stats`.

- [ ] **Step 1: Add fixtures and helpers to the test file**

Replace the import block at the top of `backend/tests/api/routes/test_countries.py` with the following, and add the fixture and helpers directly beneath `API = ...`:

```python
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
    return next(
        (p for p in page["players"] if p["player_id"] == str(player.id)), None
    )


def _ours(entries: list[dict[str, Any]], *players: Player) -> list[str]:
    """Our fixture players' ids, in the order the page lists them."""
    ids = {str(p.id) for p in players}
    return [e["player_id"] for e in entries if e["player_id"] in ids]


def _delta(before: dict[str, Any], after: dict[str, Any], key: str) -> int:
    return after["stats"][key] - before["stats"][key]


def _medal_delta(before: dict[str, Any], after: dict[str, Any]) -> tuple[int, int, int]:
    b, a = before["stats"]["medals"], after["stats"]["medals"]
    return (a["gold"] - b["gold"], a["silver"] - b["silver"], a["bronze"] - b["bronze"])
```

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/api/routes/test_countries.py`:

```python
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
            client, db, organizer_token_headers, [_row(1, (player, "CA"))], status=status
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && ../.venv/bin/pytest tests/api/routes/test_countries.py -v`
Expected: the 7 Task 1 tests pass; the new tests FAIL (e.g. `assert entry is not None` — `players` is always empty).

- [ ] **Step 4: Implement players, stats and medals**

Replace `backend/app/country_page.py` with:

```python
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
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && ../.venv/bin/pytest tests/api/routes/test_countries.py tests/test_cleanup_safety.py -v`
Expected: all pass.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && ../.venv/bin/ruff check app tests && ../.venv/bin/ruff format app tests
cd .. && git add backend/app/country_page.py backend/tests/api/routes/test_countries.py
git commit -m "feat(backend): country page players, stats and individual medals"
```

---

### Task 3: National team appearances and team medals

**Files:**
- Modify: `backend/app/country_page.py`
- Test: `backend/tests/api/routes/test_countries.py`

**Interfaces:**
- Consumes: `_add_medal`, `_competed_country` (Task 2); `crud.build_participants_public(*, session, result_ids) -> dict[uuid.UUID, list[ResultParticipantPublic]]`.
- Produces: `_national_teams(*, session: Session, code: str) -> list[CountryTeamAppearance]`; `build_country_page` fills `national_teams`, `national_team_medals`, and folds team quizzes into `stats.quiz_count`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/routes/test_countries.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ../.venv/bin/pytest tests/api/routes/test_countries.py -v`
Expected: the new appearance tests FAIL (`assert appearance is not None`); `test_member_row_country_is_overridden_by_the_national_team`, `test_international_side_credits_no_country`, `test_club_team_counts_as_competed...` and `test_pending_quiz_national_team_is_excluded` may already pass — that is fine, they pin Task 2's rule.

- [ ] **Step 3: Implement national teams**

In `backend/app/country_page.py`, add `CountryTeamAppearance` to the `app.models` import list, then add this function above `build_country_page`:

```python
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
                m for m in members_by_result.get(result.id, []) if m.player_id in published
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
```

Then in `build_country_page`, just before `return CountryPagePublic(`, add:

```python
    national_teams = _national_teams(session=session, code=code)
    national_team_medals = MedalCounts()
    for appearance in national_teams:
        # A squadless appearance is still the country taking part in a quiz.
        quiz_ids.add(appearance.quiz_id)
        if not appearance.is_qualifier:
            _add_medal(national_team_medals, appearance.final_rank)
```

and pass the two new fields in the return value:

```python
        players=country_players,
        medal_table=medal_table,
        national_teams=national_teams,
        national_team_medals=national_team_medals,
    )
```

Note `stats=CountryStats(... quiz_count=len(quiz_ids) ...)` is built inside the `return`, after this loop, so it already includes team quizzes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ../.venv/bin/pytest tests/api/routes/test_countries.py tests/test_cleanup_safety.py tests/test_podium.py -v`
Expected: all pass.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && ../.venv/bin/pytest -q`
Expected: all pass (no regressions from the models/router change).

- [ ] **Step 6: Lint and commit**

```bash
cd backend && ../.venv/bin/ruff check app tests && ../.venv/bin/ruff format app tests
cd .. && git add backend/app/country_page.py backend/tests/api/routes/test_countries.py
git commit -m "feat(backend): national team appearances and medals on country page"
```

---

### Task 4: Frontend client and country slug helper

**Files:**
- Regenerate: `frontend/openapi.json`, `frontend/src/client/*`
- Modify: `frontend/src/lib/countries.ts` (the `VG` entry; add helpers after `countryName`)
- Test: `frontend/tests/countries.test.ts`

**Interfaces:**
- Consumes: the Task 1–3 endpoint.
- Produces:
  - `CountriesService.readCountry({ slug }: { slug: string }): Promise<CountryPagePublic>` and types `CountryPagePublic`, `CountryPlayer`, `CountryTeamAppearance`, `MedalCounts` from `@/client`.
  - `slugifyCountryName(name: string): string`
  - `countrySlug(code: string | null | undefined): string | null` — `null` for missing/unknown codes.

- [ ] **Step 1: Regenerate the client**

Run from the repo root: `bash ./scripts/generate-client.sh`
Expected: `frontend/src/client/sdk.gen.ts` contains `class CountriesService` with `readCountry`; `types.gen.ts` contains `CountryPagePublic`.

Check: `grep -n "readCountry\|export type CountryPagePublic" frontend/src/client/*.ts`

- [ ] **Step 2: Write the failing tests**

In `frontend/tests/countries.test.ts`, add `countrySlug` and `slugifyCountryName` to the import from `../src/lib/countries`, add `import { readFileSync } from "node:fs"` at the top, and append:

```ts
describe("countrySlug", () => {
  test("matches the backend slugs byte for byte", () => {
    // Pinned identically in backend/tests/api/routes/test_countries.py.
    expect(countrySlug("CA")).toBe("canada")
    expect(countrySlug("AE")).toBe("united-arab-emirates")
    expect(countrySlug("AX")).toBe("åland-islands")
    expect(countrySlug("CI")).toBe("côte-divoire")
    expect(countrySlug("VI")).toBe("us-virgin-islands")
    expect(countrySlug("CD")).toBe("congo-democratic-republic")
  })

  test("is null for a missing or unknown code", () => {
    expect(countrySlug(null)).toBeNull()
    expect(countrySlug(undefined)).toBeNull()
    expect(countrySlug("")).toBeNull()
    expect(countrySlug("XX")).toBeNull()
  })

  test("every country has a distinct slug", () => {
    const slugs = COUNTRIES.map((c) => slugifyCountryName(c.name))
    expect(new Set(slugs).size).toBe(COUNTRIES.length)
  })
})

describe("frontend country list", () => {
  test("matches backend/app/countries.py code for code and name for name", () => {
    const source = readFileSync(
      new URL("../../backend/app/countries.py", import.meta.url),
      "utf8",
    )
    const backend = [...source.matchAll(/"([A-Z]{2,3})": "([^"]+)"/g)]
      .map(([, code, name]) => `${code} ${name}`)
      .sort()
    const frontend = COUNTRIES.map((c) => `${c.code} ${c.name}`).sort()
    expect(frontend).toEqual(backend)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && bun test tests/countries.test.ts`
Expected: FAIL — `countrySlug` is not exported; the parity test fails on `VG Britsh Virgin Islands`.

- [ ] **Step 4: Implement**

In `frontend/src/lib/countries.ts`, fix the typo:

```ts
  { code: "VG", name: "British Virgin Islands" },
```

and add after `countryName`:

```ts
/**
 * The same rule as the backend's `slugify`: lowercase, drop anything that is
 * not a letter, digit, underscore, space or hyphen, then hyphenate runs of
 * spaces/underscores. Python's `\w` is Unicode-aware, so letters here are
 * `\p{L}` rather than JS's ASCII-only `\w` — "Åland Islands" keeps its Å.
 */
export function slugifyCountryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** The slug of a country's page, or null for a missing or unknown code. */
export function countrySlug(code: string | null | undefined): string | null {
  if (!code) return null
  const entry = COUNTRIES.find((c) => c.code === code)
  return entry ? slugifyCountryName(entry.name) : null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && bun test tests/countries.test.ts`
Expected: all pass.

- [ ] **Step 6: Lint and commit**

```bash
cd frontend && bun run lint
cd .. && git add frontend/openapi.json frontend/src/client frontend/src/lib/countries.ts frontend/tests/countries.test.ts
git commit -m "feat(frontend): country page client and countrySlug helper"
```

---

### Task 5: Country page route

**Files:**
- Create: `frontend/src/components/Countries/CountryProfile.tsx`
- Create: `frontend/src/routes/_public/countries_.$slug.tsx`
- Regenerated: `frontend/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `CountriesService.readCountry`, `CountryPagePublic`, `CountryPlayer`, `CountryTeamAppearance`, `MedalCounts` (Task 4); `DataTable`, `PlayerLinks`, `QualifierSuffix`, `formatDateRange`.
- Produces: route `/countries/$slug`; `data-testid`s used by Task 7: `country-stat-quizzers`, `country-stat-competed`, `country-stat-quizzes`, `country-stat-medals`, `country-medal-table`, `country-national-teams`, `country-players`.

- [ ] **Step 1: Create the page body component**

Create `frontend/src/components/Countries/CountryProfile.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import type { ReactNode } from "react"

import type {
  CountryPagePublic,
  CountryPlayer,
  CountryTeamAppearance,
  MedalCounts,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { QualifierSuffix } from "@/components/Quizzes/QualifierSuffix"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateRange } from "@/lib/dates"

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

function MedalLine({ medals }: { medals: MedalCounts }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      🥇 {medals.gold} · 🥈 {medals.silver} · 🥉 {medals.bronze}
    </span>
  )
}

function PlayerName({ player }: { player: CountryPlayer }) {
  if (!player.slug) return <span>{player.display_name}</span>
  return (
    <Link
      to={"/players/$slug" as any}
      params={{ slug: player.slug } as any}
      className="hover:underline"
    >
      {player.display_name}
    </Link>
  )
}

const nameColumn: ColumnDef<CountryPlayer> = {
  accessorKey: "display_name",
  header: "Player",
  cell: ({ row }) => <PlayerName player={row.original} />,
}

function countColumn(
  key: "gold" | "silver" | "bronze" | "quiz_count",
  header: string,
): ColumnDef<CountryPlayer> {
  return {
    accessorKey: key,
    header,
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original[key]}</span>
    ),
  }
}

const medalTableColumns: ColumnDef<CountryPlayer>[] = [
  nameColumn,
  countColumn("gold", "🥇"),
  countColumn("silver", "🥈"),
  countColumn("bronze", "🥉"),
]

const playerColumns: ColumnDef<CountryPlayer>[] = [
  nameColumn,
  countColumn("quiz_count", "Quizzes"),
  {
    id: "medals",
    header: "Medals",
    // Sortable as a single number with the same precedence as the server's
    // ordering: golds outrank any number of silvers, and so on.
    accessorFn: (p) => p.gold * 1_000_000 + p.silver * 1_000 + p.bronze,
    cell: ({ row }) => <MedalLine medals={row.original} />,
  },
]

function StatTile({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  return (
    <Card data-testid={`country-stat-${id}`}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{children}</p>
      </CardContent>
    </Card>
  )
}

function Place({ team }: { team: CountryTeamAppearance }) {
  const rank = team.final_rank
  if (rank == null) return <span className="text-muted-foreground">—</span>
  if (!team.is_qualifier && MEDALS[rank]) {
    return (
      <span>
        {MEDALS[rank]} {rank}
      </span>
    )
  }
  return <span className="tabular-nums">{rank}</span>
}

function NationalTeams({
  teams,
  medals,
}: {
  teams: CountryTeamAppearance[]
  medals: MedalCounts
}) {
  return (
    <section
      className="flex flex-col gap-3"
      data-testid="country-national-teams"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">National teams</h2>
        <MedalLine medals={medals} />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Quiz</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Place</TableHead>
              <TableHead>Squad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => (
              <TableRow key={team.result_id}>
                <TableCell className="font-medium">
                  {team.team_name ?? "—"}
                </TableCell>
                <TableCell>
                  {team.quiz_slug ? (
                    <Link
                      to={"/quizzes/$slug" as any}
                      params={{ slug: team.quiz_slug } as any}
                      className="hover:underline"
                    >
                      {team.quiz_name}
                    </Link>
                  ) : (
                    team.quiz_name
                  )}
                  {team.is_qualifier && <QualifierSuffix className="text-xs" />}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateRange(team.start_date, team.end_date)}
                </TableCell>
                <TableCell>
                  <Place team={team} />
                </TableCell>
                <TableCell>
                  <PlayerLinks players={team.members ?? []} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function CountryProfile({ country }: { country: CountryPagePublic }) {
  const { stats } = country
  const players = country.players ?? []
  const medalTable = country.medal_table ?? []
  const teams = country.national_teams ?? []
  const isEmpty = players.length === 0 && teams.length === 0

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">{country.name}</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile id="quizzers" label="Quizzers">
          {stats.quizzer_count}
        </StatTile>
        <StatTile id="competed" label="Competed">
          {stats.competed_count}
        </StatTile>
        <StatTile id="quizzes" label="Quizzes">
          {stats.quiz_count}
        </StatTile>
        <StatTile id="medals" label="Medals">
          <MedalLine medals={stats.medals} />
        </StatTile>
      </div>

      {isEmpty ? (
        <p className="text-muted-foreground">
          No quizzers have represented {country.name} yet.
        </p>
      ) : (
        <>
          {medalTable.length > 0 && (
            <section
              className="flex flex-col gap-3"
              data-testid="country-medal-table"
            >
              <h2 className="text-lg font-semibold">Medal table</h2>
              <DataTable columns={medalTableColumns} data={medalTable} />
            </section>
          )}

          {teams.length > 0 && (
            <NationalTeams
              teams={teams}
              medals={country.national_team_medals}
            />
          )}

          {players.length > 0 && (
            <section
              className="flex flex-col gap-3"
              data-testid="country-players"
            >
              <h2 className="text-lg font-semibold">Players</h2>
              <DataTable columns={playerColumns} data={players} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the route**

Create `frontend/src/routes/_public/countries_.$slug.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"

import { CountriesService } from "@/client"
import { CountryProfile } from "@/components/Countries/CountryProfile"

export const Route = createFileRoute("/_public/countries_/$slug")({
  component: CountryPage,
  head: () => ({ meta: [{ title: "Country" }] }),
})

function CountryPage() {
  const { slug } = Route.useParams()
  const query = useQuery({
    queryKey: ["countries", slug],
    queryFn: () => CountriesService.readCountry({ slug }),
    retry: false,
  })

  if (query.isPending) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">Country not found.</p>
        <Link
          to="/players"
          search={{ page: 1 }}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to players
        </Link>
      </div>
    )
  }

  return <CountryProfile country={query.data} />
}
```

- [ ] **Step 3: Build (regenerates the route tree and type-checks)**

Run: `cd frontend && bun run build`
Expected: succeeds; `git status` shows `src/routeTree.gen.ts` modified with a `/_public/countries_/$slug` entry.

- [ ] **Step 4: Check it in the browser**

With the backend running on the host (`cd backend && ../.venv/bin/fastapi dev app/main.py`) and `cd frontend && bun run dev`, open `http://localhost:5173/countries/canada`, `/countries/tuvalu` (expect the empty-state line or data) and `/countries/atlantis` (expect "Country not found."). At a narrow width (375px), check that the stat tiles wrap to two columns and the national teams table scrolls horizontally, not the page.

- [ ] **Step 5: Lint and commit**

```bash
cd frontend && bun run lint
cd .. && git add frontend/src/components/Countries frontend/src/routes/_public/countries_.\$slug.tsx frontend/src/routeTree.gen.ts
git commit -m "feat(frontend): public country page"
```

---

### Task 6: Link country names to their pages

**Files:**
- Create: `frontend/src/components/Common/CountryLink.tsx`
- Modify: `frontend/src/components/Players/PlayerProfile.tsx:38-46`
- Modify: `frontend/src/components/Quizzes/QuizResultsTable.tsx:56-67` (team column), `:96-107` (country column)
- Modify: `frontend/src/components/Players/historyColumns.tsx:29-36`
- Modify: `frontend/src/components/Competitions/CompetitionPodium.tsx:59-61`
- Modify: `frontend/src/components/Quizzes/SquadCell.tsx:102-104`
- Modify: `frontend/src/routes/_layout/admin_.quizzes_.$id.tsx:115`

**Interfaces:**
- Consumes: `countrySlug`, `countryName`, `teamLabel` (`@/lib/countries`); route `/countries/$slug` (Task 5).
- Produces: `CountryLink({ code, className?, children? })`, `TeamAffiliation({ result })`.

- [ ] **Step 1: Create the link components**

Create `frontend/src/components/Common/CountryLink.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { countryName, countrySlug, teamLabel } from "@/lib/countries"

/**
 * A country's name, linked to its page. An unknown or missing code renders
 * as plain text — the same text countryName would have shown.
 */
export function CountryLink({
  code,
  className = "hover:underline",
  children,
}: {
  code: string | null | undefined
  className?: string
  children?: ReactNode
}) {
  const slug = countrySlug(code)
  const label = children ?? countryName(code)
  if (!slug) return <>{label}</>
  return (
    <Link to="/countries/$slug" params={{ slug }} className={className}>
      {label}
    </Link>
  )
}

/**
 * teamLabel, with a national team's country linked to its page. Club teams
 * and international sides keep their plain label: only national teams
 * represent a country.
 */
export function TeamAffiliation({
  result,
}: {
  result: { team_type?: string | null; team_country?: string | null }
}) {
  if (result.team_type === "national" && result.team_country) {
    return <CountryLink code={result.team_country} />
  }
  return <>{teamLabel(result)}</>
}
```

- [ ] **Step 2: Player profile chips**

In `frontend/src/components/Players/PlayerProfile.tsx`, import `CountryLink` from `@/components/Common/CountryLink` and replace the chip map:

```tsx
              {player.countries.map((code, i) => (
                <CountryLink key={code} code={code} className="">
                  <Badge variant={i === 0 ? "default" : "secondary"}>
                    {countryName(code)}
                  </Badge>
                </CountryLink>
              ))}
```

- [ ] **Step 3: Results table**

In `frontend/src/components/Quizzes/QuizResultsTable.tsx`, add `import { Fragment } from "react"` and import `CountryLink, TeamAffiliation` from `@/components/Common/CountryLink`. Remove `teamLabel` from the `@/lib/countries` import if it is no longer used (keep `countryName` — the accessor doesn't use it but check with lint). In the team column replace `{teamLabel(row.original)}` with `<TeamAffiliation result={row.original} />`. Replace the country column's `cell`:

```tsx
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {(row.original.participants ?? []).map((p, i) => (
          <Fragment key={p.player_id}>
            {i > 0 && " / "}
            {p.country ? <CountryLink code={p.country} /> : "—"}
          </Fragment>
        ))}
      </span>
    ),
```

- [ ] **Step 4: Player history, podium, squad dialog, admin review**

In each of these files, import `TeamAffiliation` from `@/components/Common/CountryLink` and replace the `teamLabel(...)` expression, then drop `teamLabel` from that file's `@/lib/countries` import if it becomes unused:

`frontend/src/components/Players/historyColumns.tsx`:

```tsx
              for {result.team_name}
              {result.team_country || result.team_type === "national" ? (
                <>
                  {" ("}
                  <TeamAffiliation result={result} />
                  {")"}
                </>
              ) : null}
```

`frontend/src/components/Competitions/CompetitionPodium.tsx`: `{teamLabel(finisher)}` → `<TeamAffiliation result={finisher} />`

`frontend/src/components/Quizzes/SquadCell.tsx`: `{teamLabel(result)}` → `<TeamAffiliation result={result} />`

`frontend/src/routes/_layout/admin_.quizzes_.$id.tsx`: `{teamLabel(result)}` → `<TeamAffiliation result={result} />`

- [ ] **Step 5: Type-check, lint, unit tests**

Run: `cd frontend && bun run build && bun run lint && bun run test:unit`
Expected: build succeeds, lint clean, unit tests pass.

- [ ] **Step 6: Check in the browser**

On a player profile with a country, click the country chip → lands on `/countries/<slug>`. On a teams quiz page with a national team, click the country under the team name → lands on the country page. A club team's country is not a link.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components frontend/src/routes/_layout/admin_.quizzes_.\$id.tsx
git commit -m "feat(frontend): link country names to country pages"
```

---

### Task 7: End-to-end spec

**Files:**
- Create: `frontend/tests/countries-public.spec.ts`

**Interfaces:**
- Consumes: `data-testid`s from Task 5; the generated client (`PlayersService.createPlayerRoute`, `QuizzesService.createQuiz`, `QuizzesService.submitResults`, `QuizzesService.approveQuiz`, `QuizzesService.deleteQuiz`, `PlayersService.deletePlayerRoute`).

**Before running:** E2E hits the Docker stack. Rebuild the backend image so it serves the new endpoint (`docker compose up -d --build backend`), stop the Docker frontend container (`docker compose stop frontend`) so Playwright's dev server owns port 5173, make sure `mailcatcher` is up, and never run two Playwright suites at once. Don't pipe Playwright through `| tail` — it masks the exit code.

- [ ] **Step 1: Write the spec**

Create `frontend/tests/countries-public.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { OpenAPI, PlayersService, QuizzesService } from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function authenticate(): Promise<string> {
  const loginRes = await fetch(
    `${process.env.VITE_API_URL}/api/v1/login/access-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: firstSuperuser,
        password: firstSuperuserPassword,
      }),
    },
  )
  const { access_token } = await loginRes.json()
  return access_token
}

test.describe("Public country page", () => {
  // Each worker runs beforeAll; Date.now() alone collides across workers.
  const runId = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const playerName = `Tuvalu Quizzer ${runId}`
  const teamName = `Tuvalu E2E ${runId}`
  const quizIds: string[] = []
  let playerId: string
  let playerSlug: string

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const player = await PlayersService.createPlayerRoute({
      requestBody: { display_name: playerName, countries: ["TV"] },
    })
    playerId = player.id
    playerSlug = player.slug!

    const individual = await QuizzesService.createQuiz({
      requestBody: {
        name: `Tuvalu Open ${runId}`,
        start_date: "2026-03-01",
        end_date: "2026-03-01",
      },
    })
    quizIds.push(individual.id)
    await QuizzesService.submitResults({
      id: individual.id,
      requestBody: {
        results: [
          {
            participants: [{ player_id: playerId, country: "TV" }],
            final_rank: 1,
            score: 90,
          },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: individual.id })

    const teams = await QuizzesService.createQuiz({
      requestBody: {
        name: `Tuvalu Nations Cup ${runId}`,
        start_date: "2026-04-01",
        end_date: "2026-04-01",
        participant_mode: "teams",
      },
    })
    quizIds.push(teams.id)
    await QuizzesService.submitResults({
      id: teams.id,
      requestBody: {
        results: [
          {
            participants: [{ player_id: playerId }],
            final_rank: 2,
            score: 80,
            team_name: teamName,
            team_type: "national",
            team_country: "TV",
          },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: teams.id })
  })

  test.afterAll(async () => {
    for (const id of quizIds) {
      await QuizzesService.deleteQuiz({ id }).catch(() => {})
    }
    if (playerId)
      await PlayersService.deletePlayerRoute({ playerId }).catch(() => {})
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("shows stats, medal table, national team and players", async ({
    page,
  }) => {
    await page.goto("/countries/tuvalu")
    await expect(page.getByRole("heading", { name: "Tuvalu" })).toBeVisible()
    for (const id of ["quizzers", "competed", "quizzes", "medals"]) {
      await expect(page.getByTestId(`country-stat-${id}`)).toBeVisible()
    }
    await expect(
      page.getByTestId("country-medal-table").getByText(playerName),
    ).toBeVisible()
    const teams = page.getByTestId("country-national-teams")
    await expect(teams.getByText(teamName)).toBeVisible()
    await expect(teams.getByText(playerName)).toBeVisible()
    await expect(
      page.getByTestId("country-players").getByText(playerName),
    ).toBeVisible()
  })

  test("a player's country chip links to the country page", async ({
    page,
  }) => {
    await page.goto(`/players/${playerSlug}`)
    await page.getByRole("link", { name: "Tuvalu" }).first().click()
    await expect(page).toHaveURL("/countries/tuvalu")
    await expect(page.getByRole("heading", { name: "Tuvalu" })).toBeVisible()
  })

  test("an unknown country shows not found", async ({ page }) => {
    await page.goto("/countries/atlantis")
    await expect(page.getByText("Country not found.")).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `cd frontend && bunx playwright test tests/countries-public.spec.ts`
Expected: 3 passed (plus the auth setup project).

If `createQuiz` rejects `participant_mode` in the request body, check `QuizCreate` in `frontend/src/client/types.gen.ts`. `QuizBase` includes `participant_mode`, so it should be accepted.

- [ ] **Step 3: Run the full E2E suite once**

Run: `cd frontend && bunx playwright test`
Expected: no new failures compared with `main`, especially in specs that touch the edited components (`players.spec.ts`, `teams-upload.spec.ts`, `qualifier-quizzes.spec.ts`, `competitions-public.spec.ts`).

- [ ] **Step 4: Lint and commit**

```bash
cd frontend && bun run lint
cd .. && git add frontend/tests/countries-public.spec.ts
git commit -m "test(e2e): public country page"
```
