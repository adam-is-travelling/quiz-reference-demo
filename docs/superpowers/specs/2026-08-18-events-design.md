# Events

**Date:** 2026-08-18
**Status:** Design approved
**Depends on:** [`event` → `quiz` rename](2026-08-18-event-quiz-rename-design.md) — merged first

## Problem

Some quizzes happen together at a single gathering: Trivia Nationals, the International
Quizzing Championships. One trip, one venue, one weekend, several distinct quizzes. Today
there is no way to express that. A visitor looking at "Trivia Nationals 2026" has to find
its five quizzes one at a time and has no way to see who did best across the whole thing.

An `Event` models that gathering: a name, a date range, a location, the organization that
runs it, and the quizzes held there.

## Relationship to Competition

`Competition` already groups quizzes, but along a different axis. A competition is a
*recurring series* — the World Quizzing Championship across every year it has run. An event
is a *single gathering* at one place and time.

The two are independent. A quiz can belong to both: the WQC main quiz held at Trivia
Nationals 2026 is in the `World Quizzing Championship` competition and at the
`Trivia Nationals 2026` event.

```
Organization
 ├── Competition (series) ──┐
 └── Event (gathering)  ────┤
      date, location        │
                            ▼
                          Quiz
          quiz.competition_id (nullable)
          quiz.event_id      (nullable)
```

Neither foreign key constrains the other. A quiz's organization need not match its event's
organization — a venue can host a quiz run by a visiting organizer.

## Data model

New table `event`, mirroring `Competition`'s structure plus date and location:

```python
class EventBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)
    start_date: date
    end_date: date
    is_online: bool = False
    venue: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=3)


class EventCreate(EventBase):
    organization_id: uuid.UUID


class EventUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_online: bool | None = None
    venue: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=3)
    organization_id: uuid.UUID | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        return _validate_slug_shape(v)


class Event(EventBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True, max_length=255)
    organization_id: uuid.UUID = Field(
        foreign_key="organization.id", ondelete="CASCADE"
    )


class EventPublic(EventBase):
    id: uuid.UUID
    slug: str
    organization_id: uuid.UUID
    organization_name: str | None = None
    organization_slug: str | None = None
    quiz_count: int = 0
```

`Quiz` gains one column:

```python
    event_id: uuid.UUID | None = Field(
        default=None, foreign_key="event.id", ondelete="SET NULL"
    )
```

`QuizCreate` and `QuizUpdate` gain a nullable `event_id`. `QuizPublic` gains `event_id`,
`event_name` and `event_slug`, denormalized the same way `PlayerResultWithQuiz` carries
`competition_name`, so the quiz detail page can link up to its event without a second fetch.

### Validation

Enforced by a Pydantic model validator shared by `EventCreate` and `EventUpdate`, so the
create and update paths cannot diverge:

| Rule | Failure |
| --- | --- |
| `is_online=True` → `venue`, `city`, `country` must all be null | 422 |
| `is_online=False` → `country` required and in `VALID_COUNTRY_CODES` | 422 |
| `end_date >= start_date` | 422 |

An online event with a venue is **rejected**, not silently cleared. This follows the
precedent set in PR #41, where a slug update that would silently clear a value was made an
error instead.

Because `EventUpdate` allows partial updates, the validator runs against the *merged*
result of the stored row and the patch, not the patch alone. Patching `is_online=True` on an
event that has a venue is a 422 — the caller must null the venue in the same request.

### Slug

Generated with the existing `slugify` / `clamp_slug_base` / `generate_unique_slug` helpers
in `crud.py`, from the name plus the start-date year:

```
"Trivia Nationals" + 2026  →  trivia-nationals-2026
```

If the slugified name is empty (a name of only non-slugifiable characters), fall back to
`uuid.uuid4().hex[:12]`, matching `create_organization` and `create_competition`. Slug
updates that collide return 409.

Per the [slug transliteration follow-up](2026-08-04-entity-slugs-design.md), `slugify`
deliberately preserves non-ASCII characters. Do not add diacritic stripping here.

### Migration

One Alembic revision, autogenerated then reviewed:

- `CREATE TABLE event` with the unique index on `slug`
- `ALTER TABLE quiz ADD COLUMN event_id UUID NULL REFERENCES event(id) ON DELETE SET NULL`

No backfill — every existing quiz starts with `event_id = NULL`.

## Podium module

The medal-table logic currently sits inline in `read_competition_podium`
(`backend/app/api/routes/competitions.py:58-134`), about 70 lines that build per-quiz
podiums and tally gold/silver/bronze standings. The event splash page needs exactly the same
computation over a different set of quizzes.

Extract it to a new module `backend/app/podium.py`, sibling to `crud.py` and `countries.py`:

```python
def build_podium(*, session: Session, quizzes: Sequence[Quiz]) -> PodiumPublic:
    """Per-quiz podiums plus aggregated gold/silver/bronze standings."""
```

It depends only on `Quiz`, `QuizResult`, `Player` and the podium response models, so there
is no circular import with `crud`. Each route queries its own quizzes and passes them in.

`crud.py` is already 899 lines; this belongs in its own file rather than growing it further.

The response models generalize. `QuizPodium` already carries no competition-specific
meaning after the rename spec, so only the container changes:
`CompetitionPodiumPublic` becomes `PodiumPublic`.

```python
class PodiumPublic(SQLModel):
    quizzes: list[QuizPodium]
    standings: list[PodiumStanding]
```

Both `/competitions/{id}/podium` and `/events/{id}/podium` return `PodiumPublic`, so the
existing frontend podium component is reused unchanged rather than copied.

Sorting is unchanged from today: standings by gold desc, silver desc, bronze desc, then
display name ascending; quizzes by `start_date` descending.

The alternative — duplicating the loop into `events.py` — was rejected. Two copies of a
medal tally will drift the first time tiebreak rules change.

## API

`backend/app/api/routes/events.py`, registered in `app/api/main.py`, mirroring
`competitions.py`:

| Method | Path | Auth | Behaviour |
| --- | --- | --- | --- |
| `GET` | `/events/` | public | Paginated `skip`/`limit`, ordered by `start_date` desc. Returns `EventListPublic`. |
| `GET` | `/events/{id}` | public | `id` resolves as UUID **or** slug via `crud.resolve_by_id_or_slug`. 404 if unknown. |
| `GET` | `/events/{id}/podium` | public | Approved quizzes at the event, plus medal table. Returns `PodiumPublic`. |
| `POST` | `/events/` | superuser | 403 for non-superuser. 404 if `organization_id` unknown. |
| `PATCH` | `/events/{id}` | superuser | 403 / 404 / 409 on slug collision / 422 on validation. |
| `DELETE` | `/events/{id}` | superuser | Quizzes survive; their `event_id` becomes null. |

The podium endpoint filters to `status == QuizStatus.approved`, matching the competition
podium, so pending and rejected quizzes never reach a public page.

`quiz_count` on `EventPublic` counts approved quizzes only, for the same reason.

The quiz routes validate `event_id` on create and update, returning 404 if the event does
not exist.

After the backend changes, regenerate the client from project root:

```bash
bash ./scripts/generate-client.sh
```

## Frontend

### Routes

| File | Purpose |
| --- | --- |
| `_public/events.tsx` | Index. One row per event: name, date range, location, organization, quiz count. |
| `_public/events_.$slug.tsx` | Splash page. |
| `_layout/admin_.events.tsx` | Superuser CRUD table, modelled on `admin_.competitions.tsx`. |

Plus `components/Admin/EventDialog.tsx`, modelled on `CompetitionDialog.tsx`.

The `_` suffix on `events_.$slug.tsx` follows the existing convention for detail pages that
do not nest under the index route — see `competitions_.$slug.tsx`.

### Splash page

```
Trivia Nationals 2026
Divani Caravel Hotel, Athens, Greece · 12–14 Jun 2026
Organised by World Quizzing HQ

── Medal table ───────────────────
Player            🥇   🥈   🥉
...

── Quizzes ───────────────────────
Main Quiz     12 Jun   1st · 2nd · 3rd
Team Quiz     13 Jun   1st · 2nd · 3rd
```

Header, then medal table, then quizzes with their podiums. The medal table and quiz list
come from `GET /events/{slug}/podium` and render through the existing podium component,
which already handles both sections.

An event with no approved quizzes shows the header and "No quizzes published yet."

### Location rendering

One shared component, `components/Events/EventLocation.tsx`, used by the index, the splash
page and the admin table, so the format cannot drift:

| State | Renders |
| --- | --- |
| `is_online` | `Online` |
| otherwise | `Divani Caravel Hotel, Athens, Greece` |

`venue` and `city` are each omitted when null; the country name comes from `countryName()`
in `@/lib/countries`. Countries render as plain names, matching every other country display
in the app (`players.tsx`, `PlayerProfile.tsx`, `historyColumns.tsx`). Flag emoji are not
used anywhere in the app today and are out of scope here.

### Admin dialog

Fields: name, description, organization (required), start date, end date, an "Online"
checkbox, venue, city, country.

Ticking "Online" clears and disables venue, city and country, so the client cannot construct
a payload the server will reject. The country field uses the existing
`components/ui/CountrySelect.tsx`. Dates reuse the date inputs from the quiz metadata form.

### Attaching quizzes to events

A shared `EventSelect` component used in two places:

1. **Upload wizard Step 1** (`Step1QuizMeta.tsx` after the rename) — an Event dropdown
   below the existing Competition dropdown.
2. **Admin quiz metadata dialog** (`components/Quizzes/MetadataEditDialog.tsx`) — the same
   field.

It mirrors the existing competition dropdown exactly: options filtered to the selected
organization, a `__none__` sentinel for "no event", and clearing the organization clears the
event selection.

### Navigation

"Events" is added to `components/Common/PublicNav.tsx` next to Competitions, and to the
admin sidebar next to Competitions.

## Testing

| File | Coverage |
| --- | --- |
| `test_podium.py` (new) | `build_podium` directly: empty quiz list; a single quiz; a player medalling across several quizzes; standings sort order including the display-name tiebreak; quizzes with fewer than three finishers |
| `test_events.py` (new) | Create, read, update, delete. Resolution by both UUID and slug. Non-superuser gets 403 on write. Unknown organization 404. Slug collision 409. Slug generated from name + year. |
| `test_events.py` validation | Online event with a venue → 422. In-person event without a country → 422. Invalid country code → 422. `end_date < start_date` → 422. Patching `is_online=True` over a stored venue → 422. |
| `test_quizzes.py` | Quiz create and update with `event_id`. Unknown `event_id` → 404. Deleting an event nulls `event_id` on its quizzes and leaves the quizzes intact. |
| `test_competitions.py` | Existing podium tests still pass against the extracted builder, with the response field renamed `events` → `quizzes`. |
| Playwright | Superuser creates an event, attaches a quiz to it, and the splash page shows that quiz in both the quiz list and the medal table. |

Backend tests run on the host through the repo-root venv — the backend container serves a
stale baked image and will not see new code. Tests follow the non-destructive cleanup rule:
delete only rows the test created, never table-wide deletes.

Before the Playwright run, stop the Docker frontend container so it does not shadow port
5173 with a stale build.

## Out of scope

- Ordering quizzes within an event by anything other than date. Explicit user-defined
  ordering is planned as separate work covering competitions and events together; treat
  date ordering here as interim.
- Filtering or searching events by country or date.
- Showing on the event page which competitions its quizzes belong to.
- Bulk-attaching existing quizzes from the event page.
- Flag emoji for event countries.

## Success criteria

- A superuser can create an event with a date range, an organization, and either a physical
  location or the online flag.
- Quizzes can be attached to an event from both the upload wizard and the admin quiz dialog.
- `/events` lists events; `/events/{slug}` shows the header, a medal table across the whole
  event, and every approved quiz held there.
- Deleting an event leaves its quizzes intact and unattached.
- `build_podium` has one implementation, used by both the competition and event endpoints.
