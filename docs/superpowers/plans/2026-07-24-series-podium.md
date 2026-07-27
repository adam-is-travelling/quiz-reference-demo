# Series Podium Finishers & Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each event's top-3 podium finishers on the public series detail page (`/series/$id`), plus a series-wide podium standings table.

**Architecture:** A new public backend endpoint `GET /series/{id}/podium` aggregates approved events' top-3 finishers and series-wide gold/silver/bronze standings in one response. The frontend regenerates its typed client and renders the data as medal columns in the events table plus a standings table.

**Tech Stack:** FastAPI + SQLModel (backend), pytest (backend tests), React + TanStack Router/Query + TanStack Table + shadcn/ui (frontend), Playwright (E2E), `@hey-api/openapi-ts` (client generation).

## Global Constraints

- Only **approved** quizzes count toward podiums (public visibility rule).
- Aggregate standings by `player_id` (canonical — merged players count once).
- Standings sort order: **gold desc, silver desc, bronze desc, then `player_display_name` case-insensitive asc**.
- No new DB tables or migrations.
- Backend response models live in `backend/app/models.py`; the endpoint lives in `backend/app/api/routes/series.py`.

---

### Task 1: Backend podium endpoint

**Files:**
- Modify: `backend/app/models.py` (add response models near the QuizResult section, ~line 550)
- Modify: `backend/app/api/routes/series.py` (add endpoint + imports)
- Test: `backend/tests/api/routes/test_series.py` (append tests + a local helper)

**Interfaces:**
- Produces (models): `PodiumFinisher`, `SeriesEventPodium`, `PodiumStanding`, `SeriesPodiumPublic`.
- Produces (route): `GET /api/v1/series/{id}/podium` → `SeriesPodiumPublic`, operation id `read_series_podium` (client method `readSeriesPodium`).
- Consumes: existing `QuizSeries`, `Quiz`, `QuizStatus`, `QuizResult`, `Player`, `crud.create_quiz_results`, `QuizResultCreate`, and test helpers `create_random_series`, `create_random_event`, `create_random_player`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/routes/test_series.py`. Add `from datetime import date` and `import uuid` if not already imported at the top (the file already imports `uuid`), and ensure these imports exist:

```python
from datetime import date

from app import crud
from app.models import QuizResultCreate, QuizStatus
from tests.utils.quiz import (
    create_random_event,
    create_random_player,
    create_random_series,
)
```

Then append the helper and tests:

```python
def _approved_event_in_series(
    db: Session, series_id: uuid.UUID, name: str, start: date
) -> Quiz:
    event = create_random_event(db)
    event.name = name
    event.series_id = series_id
    event.start_date = start
    event.end_date = start
    event.status = QuizStatus.approved
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def test_series_podium_returns_top_three(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    event = _approved_event_in_series(db, series.id, "Event A", date(2026, 1, 1))
    players = [create_random_player(db) for _ in range(4)]
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[
            QuizResultCreate(player_id=players[0].id, final_rank=1, score=100),
            QuizResultCreate(player_id=players[1].id, final_rank=2, score=90),
            QuizResultCreate(player_id=players[2].id, final_rank=3, score=80),
            QuizResultCreate(player_id=players[3].id, final_rank=4, score=70),
        ],
    )
    response = client.get(f"{settings.API_V1_STR}/series/{series.id}/podium")
    assert response.status_code == 200
    body = response.json()
    assert len(body["events"]) == 1
    finishers = body["events"][0]["finishers"]
    assert [f["place"] for f in finishers] == [1, 2, 3]
    assert finishers[0]["player_id"] == str(players[0].id)


def test_series_podium_gold_outranks_silver(
    client: TestClient, db: Session
) -> None:
    series = create_random_series(db)
    p_gold = create_random_player(db)
    p_gold.display_name = "Zeta Twogold"
    p_silver = create_random_player(db)
    p_silver.display_name = "Alpha Twosilver"
    db.add(p_gold)
    db.add(p_silver)
    db.commit()
    e1 = _approved_event_in_series(db, series.id, "E1", date(2026, 1, 1))
    e2 = _approved_event_in_series(db, series.id, "E2", date(2026, 2, 1))
    for event in (e1, e2):
        crud.create_quiz_results(
            session=db,
            event_id=event.id,
            results=[
                QuizResultCreate(player_id=p_gold.id, final_rank=1, score=10),
                QuizResultCreate(player_id=p_silver.id, final_rank=2, score=9),
            ],
        )
    body = client.get(f"{settings.API_V1_STR}/series/{series.id}/podium").json()
    names = [s["player_display_name"] for s in body["standings"]]
    # 2 golds beats 2 silvers even though "Alpha" is alphabetically first
    assert names == ["Zeta Twogold", "Alpha Twosilver"]


def test_series_podium_alpha_tiebreak(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    p_b = create_random_player(db)
    p_b.display_name = "Bravo"
    p_a = create_random_player(db)
    p_a.display_name = "Alpha"
    db.add(p_a)
    db.add(p_b)
    db.commit()
    e1 = _approved_event_in_series(db, series.id, "E1", date(2026, 1, 1))
    e2 = _approved_event_in_series(db, series.id, "E2", date(2026, 2, 1))
    crud.create_quiz_results(
        session=db,
        event_id=e1.id,
        results=[QuizResultCreate(player_id=p_b.id, final_rank=1, score=10)],
    )
    crud.create_quiz_results(
        session=db,
        event_id=e2.id,
        results=[QuizResultCreate(player_id=p_a.id, final_rank=1, score=10)],
    )
    body = client.get(f"{settings.API_V1_STR}/series/{series.id}/podium").json()
    names = [s["player_display_name"] for s in body["standings"]]
    assert names == ["Alpha", "Bravo"]  # equal gold count -> alphabetical


def test_series_podium_excludes_unapproved(
    client: TestClient, db: Session
) -> None:
    series = create_random_series(db)
    event = create_random_event(db)  # pending by default
    event.series_id = series.id
    db.add(event)
    db.commit()
    db.refresh(event)
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=50)],
    )
    body = client.get(f"{settings.API_V1_STR}/series/{series.id}/podium").json()
    assert body["events"] == []
    assert body["standings"] == []


def test_series_podium_partial_podium(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    event = _approved_event_in_series(db, series.id, "Solo", date(2026, 1, 1))
    player = create_random_player(db)
    crud.create_quiz_results(
        session=db,
        event_id=event.id,
        results=[QuizResultCreate(player_id=player.id, final_rank=1, score=50)],
    )
    body = client.get(f"{settings.API_V1_STR}/series/{series.id}/podium").json()
    assert len(body["events"][0]["finishers"]) == 1
    assert len(body["standings"]) == 1
    assert body["standings"][0]["gold"] == 1


def test_series_podium_unknown_series_404(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/series/{uuid.uuid4()}/podium")
    assert response.status_code == 404


def test_series_podium_empty_series(client: TestClient, db: Session) -> None:
    series = create_random_series(db)
    body = client.get(f"{settings.API_V1_STR}/series/{series.id}/podium").json()
    assert body == {"events": [], "standings": []}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec backend pytest tests/api/routes/test_series.py -k podium -v`
Expected: FAIL — the endpoint returns 404/405 (route missing) and the model imports may not yet exist. (If running locally instead: `cd backend && source .venv/bin/activate && pytest tests/api/routes/test_series.py -k podium -v`.)

- [ ] **Step 3: Add the response models**

In `backend/app/models.py`, immediately after the `QuizResultsWithPlayersPublic` class (around line 550, end of the QuizResult section), add:

```python
class PodiumFinisher(SQLModel):
    place: int
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    country: str | None = None


class SeriesEventPodium(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    end_date: date
    finishers: list[PodiumFinisher]


class PodiumStanding(SQLModel):
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    gold: int
    silver: int
    bronze: int


class SeriesPodiumPublic(SQLModel):
    events: list[SeriesEventPodium]
    standings: list[PodiumStanding]
```

(`date` is already imported at the top of `models.py`.)

- [ ] **Step 4: Add the endpoint**

In `backend/app/api/routes/series.py`, update the imports. Change the sqlmodel import line to include `col`:

```python
from sqlmodel import Session, col, func, select
```

Add these to the `from app.models import (...)` block:

```python
    Player,
    PodiumFinisher,
    PodiumStanding,
    Quiz,
    QuizResult,
    QuizStatus,
    SeriesEventPodium,
    SeriesPodiumPublic,
```

Then add this endpoint after `read_series_item` (after line 46):

```python
@router.get("/{id}/podium", response_model=SeriesPodiumPublic)
def read_series_podium(session: SessionDep, id: uuid.UUID) -> Any:
    series = session.get(QuizSeries, id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    events = session.exec(
        select(Quiz)
        .where(Quiz.series_id == id, Quiz.status == QuizStatus.approved)
        .order_by(col(Quiz.start_date).desc())
    ).all()

    event_podiums: list[SeriesEventPodium] = []
    tally: dict[uuid.UUID, PodiumStanding] = {}

    for event in events:
        rows = session.exec(
            select(QuizResult, Player)
            .join(Player, QuizResult.player_id == Player.id)
            .where(
                QuizResult.quiz_id == event.id,
                col(QuizResult.final_rank).in_([1, 2, 3]),
            )
            .order_by(col(QuizResult.final_rank).asc())
        ).all()

        finishers = [
            PodiumFinisher(
                place=result.final_rank,  # non-null: filtered to 1/2/3
                player_id=result.player_id,
                player_display_name=player.display_name,
                player_slug=player.slug,
                score=result.score,
                country=result.country,
            )
            for result, player in rows
        ]
        event_podiums.append(
            SeriesEventPodium(
                quiz_id=event.id,
                quiz_name=event.name,
                start_date=event.start_date,
                end_date=event.end_date,
                finishers=finishers,
            )
        )

        for result, player in rows:
            standing = tally.get(result.player_id)
            if standing is None:
                standing = PodiumStanding(
                    player_id=result.player_id,
                    player_display_name=player.display_name,
                    player_slug=player.slug,
                    gold=0,
                    silver=0,
                    bronze=0,
                )
                tally[result.player_id] = standing
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
    return SeriesPodiumPublic(events=event_podiums, standings=standings)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose exec backend pytest tests/api/routes/test_series.py -k podium -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/models.py backend/app/api/routes/series.py backend/tests/api/routes/test_series.py
git commit -m "feat(backend): series podium endpoint with top-3 finishers and standings"
```

---

### Task 2: Frontend podium UI + E2E

**Files:**
- Modify (generated): `frontend/src/client/*` via `scripts/generate-client.sh`
- Create: `frontend/src/components/Series/SeriesPodium.tsx`
- Modify: `frontend/src/routes/_public/series_.$id.tsx`
- Test: `frontend/tests/series-public.spec.ts` (append a describe block)

**Interfaces:**
- Consumes: `SeriesService.readSeriesPodium({ id })` and types `SeriesPodiumPublic`, `SeriesEventPodium`, `PodiumFinisher`, `PodiumStanding` from `@/client` (generated in Step 1).
- Consumes: `DataTable` from `@/components/Common/DataTable`; `Table*` primitives from `@/components/ui/table`.
- Produces: `SeriesPodium` React component (`export function SeriesPodium({ podium }: { podium: SeriesPodiumPublic })`).

- [ ] **Step 1: Regenerate the typed client**

The backend stack must be running (Task 1 merged/available). From the project root:

Run: `bash ./scripts/generate-client.sh`
Expected: `frontend/openapi.json` and `frontend/src/client/` update; a `SeriesService.readSeriesPodium` method and `SeriesPodiumPublic` type now exist. Verify:

Run: `grep -n "readSeriesPodium" frontend/src/client/sdk.gen.ts`
Expected: one match.

- [ ] **Step 2: Write the failing E2E test**

Append to `frontend/tests/series-public.spec.ts`. First extend the top import to add the services used for seeding:

```typescript
import {
  OpenAPI,
  OrganizationsService,
  PlayersService,
  QuizzesService,
  SeriesService,
} from "../src/client"
```

Then append this describe block at the end of the file:

```typescript
test.describe("Series detail podium", () => {
  const runId = Date.now()
  const seriesName = `Podium Series ${runId}`
  const winnerName = `Podium Winner ${runId}`
  const secondName = `Podium Second ${runId}`
  const thirdName = `Podium Third ${runId}`
  let orgId: string
  let seriesId: string
  let quizId: string
  const playerIds: string[] = []

  test.beforeAll(async () => {
    OpenAPI.BASE = process.env.VITE_API_URL!
    OpenAPI.TOKEN = await authenticate()

    const org = await OrganizationsService.createOrganization({
      requestBody: { name: `Podium Org ${runId}` },
    })
    orgId = org.id
    const series = await SeriesService.createSeries({
      requestBody: { name: seriesName, organization_id: orgId },
    })
    seriesId = series.id

    for (const name of [winnerName, secondName, thirdName]) {
      const p = await PlayersService.createPlayerRoute({
        requestBody: { display_name: name },
      })
      playerIds.push(p.id)
    }

    const quiz = await QuizzesService.createQuiz({
      requestBody: {
        name: `Podium Event ${runId}`,
        start_date: "2026-03-01",
        end_date: "2026-03-01",
        series_id: seriesId,
      },
    })
    quizId = quiz.id
    await QuizzesService.submitResults({
      id: quizId,
      requestBody: {
        results: [
          { player_id: playerIds[0], final_rank: 1, score: 90 },
          { player_id: playerIds[1], final_rank: 2, score: 80 },
          { player_id: playerIds[2], final_rank: 3, score: 70 },
        ],
      },
    })
    await QuizzesService.approveQuiz({ id: quizId })
  })

  test.afterAll(async () => {
    if (quizId) await QuizzesService.deleteQuiz({ id: quizId }).catch(() => {})
    for (const id of playerIds) {
      await PlayersService.deletePlayerRoute({ playerId: id }).catch(() => {})
    }
    if (seriesId)
      await SeriesService.deleteSeries({ id: seriesId }).catch(() => {})
    if (orgId)
      await OrganizationsService.deleteOrganization({ id: orgId }).catch(
        () => {},
      )
  })

  test.use({ storageState: { cookies: [], origins: [] } })

  test("shows podium finishers and standings", async ({ page }) => {
    await page.goto(`/series/${seriesId}`)
    await page.waitForLoadState("networkidle")

    await expect(
      page.getByRole("heading", { name: "Events" }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Podium standings" }),
    ).toBeVisible()

    // Finishers appear in the events table
    await expect(page.getByText(winnerName).first()).toBeVisible()
    await expect(page.getByText(thirdName).first()).toBeVisible()
  })
})
```

- [ ] **Step 3: Run the E2E test to verify it fails**

First stop the Docker frontend container so local Playwright doesn't hit a stale build on port 5173 (see project memory), then run just this test:

Run: `cd frontend && bunx playwright test series-public.spec.ts -g "podium finishers"`
Expected: FAIL — no "Podium standings" heading exists yet.

- [ ] **Step 4: Create the SeriesPodium component**

Create `frontend/src/components/Series/SeriesPodium.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type {
  PodiumFinisher,
  PodiumStanding,
  SeriesEventPodium,
  SeriesPodiumPublic,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

function PlayerName({
  slug,
  name,
}: {
  slug: string | null | undefined
  name: string
}) {
  return slug ? (
    <Link
      to={"/players/$slug" as any}
      params={{ slug } as any}
      className="hover:underline"
    >
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  )
}

function FinisherCell({ finisher }: { finisher: PodiumFinisher | undefined }) {
  if (!finisher) return <span className="text-muted-foreground">—</span>
  return (
    <span className="whitespace-nowrap">
      {MEDALS[finisher.place]}{" "}
      <PlayerName
        slug={finisher.player_slug}
        name={finisher.player_display_name}
      />
    </span>
  )
}

function placeColumn(
  place: number,
  header: string,
): ColumnDef<SeriesEventPodium> {
  return {
    id: `place_${place}`,
    header,
    enableSorting: false,
    cell: ({ row }) => (
      <FinisherCell
        finisher={row.original.finishers.find((f) => f.place === place)}
      />
    ),
  }
}

const podiumEventColumns: ColumnDef<SeriesEventPodium>[] = [
  {
    accessorKey: "quiz_name",
    header: "Quiz",
    cell: ({ row }) => (
      <Link
        to="/quizzes/$id"
        params={{ id: row.original.quiz_id }}
        className="font-medium hover:underline"
      >
        {row.original.quiz_name}
      </Link>
    ),
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => {
      const { start_date, end_date } = row.original
      return start_date === end_date
        ? start_date
        : `${start_date} – ${end_date}`
    },
  },
  placeColumn(1, "1st"),
  placeColumn(2, "2nd"),
  placeColumn(3, "3rd"),
]

function PodiumStandingsTable({
  standings,
}: {
  standings: PodiumStanding[]
}) {
  if (standings.length === 0) {
    return <p className="text-muted-foreground">No podium results yet.</p>
  }
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Player</TableHead>
            <TableHead className="text-right">🥇</TableHead>
            <TableHead className="text-right">🥈</TableHead>
            <TableHead className="text-right">🥉</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((s) => (
            <TableRow key={s.player_id}>
              <TableCell className="font-medium">
                <PlayerName
                  slug={s.player_slug}
                  name={s.player_display_name}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.gold}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.silver}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {s.bronze}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function SeriesPodium({ podium }: { podium: SeriesPodiumPublic }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">Events</h2>
        {podium.events.length === 0 ? (
          <p className="text-muted-foreground">No events published yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <DataTable columns={podiumEventColumns} data={podium.events} />
          </div>
        )}
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Podium standings</h2>
        <PodiumStandingsTable standings={podium.standings} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the component into the series detail route**

Replace the contents of `frontend/src/routes/_public/series_.$id.tsx` with:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { SeriesService } from "@/client"
import { SeriesPodium } from "@/components/Series/SeriesPodium"

function getSeriesQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesItem({ id }),
    queryKey: ["series", id],
  }
}

function getSeriesPodiumQueryOptions(id: string) {
  return {
    queryFn: () => SeriesService.readSeriesPodium({ id }),
    queryKey: ["series", id, "podium"],
  }
}

export const Route = createFileRoute("/_public/series_/$id")({
  component: SeriesDetailPage,
})

function SeriesDetail({ id }: { id: string }) {
  const { data: series } = useSuspenseQuery(getSeriesQueryOptions(id))
  const { data: podium } = useSuspenseQuery(getSeriesPodiumQueryOptions(id))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
        {series.description && (
          <p className="text-muted-foreground">{series.description}</p>
        )}
        {series.organization_id && series.organization_name && (
          <p className="text-sm text-muted-foreground mt-1">
            Organised by{" "}
            <Link
              to="/organizations/$id"
              params={{ id: series.organization_id }}
              className="hover:underline text-foreground"
            >
              {series.organization_name}
            </Link>
          </p>
        )}
      </div>
      <SeriesPodium podium={podium} />
    </div>
  )
}

function SeriesDetailPage() {
  const { id } = Route.useParams()
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <SeriesDetail id={id} />
    </Suspense>
  )
}
```

- [ ] **Step 6: Type-check, lint, and run the E2E test**

Run: `cd frontend && bun run build`
Expected: type-check + build succeed (no unused-import or type errors).

Run: `cd frontend && bun run lint`
Expected: biome passes (auto-fixes formatting if needed).

Run: `cd frontend && bunx playwright test series-public.spec.ts`
Expected: PASS — the existing series tests plus the new podium test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/client frontend/openapi.json frontend/src/components/Series/SeriesPodium.tsx frontend/src/routes/_public/series_.\$id.tsx frontend/tests/series-public.spec.ts
git commit -m "feat(frontend): series detail podium finishers and standings"
```

---

## Notes for the implementer

- The `to={"/players/$slug" as any}` cast mirrors the existing pattern in `frontend/src/components/Events/EventResultsTable.tsx` (the players route params aren't in the generated route tree types the same way).
- `create_quiz_results` upserts by `(quiz_id, player_id)` and requires `score`; `round_scores` may be omitted.
- The `clean_series_data` autouse fixture in the test file removes series and organizations created during a test; players/results left behind are harmless because each test uses its own fresh series.
- If running the backend tests locally instead of via Docker, activate the venv first: `cd backend && source .venv/bin/activate`.
