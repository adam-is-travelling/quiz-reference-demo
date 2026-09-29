# Recurring series (competitions and recurring events)

**Date:** 2026-09-28
**Status:** Design approved
**Delivery:** two PRs, in order: PR 1 (pure rename), then PR 2 (event series)

## Problem

`Competition` models a recurring series of *quizzes*: the World Quizzing Championship across
every year it has run. `Event` models a single *gathering*: Trivia Nationals 2026, one
place and one weekend, several quizzes.

Gatherings recur too. Trivia Nationals happened in 2025 and 2026, but those are two
unrelated `Event` rows today. Nothing links them, so there is no page for "Trivia
Nationals" across its years and no way to see which quiz series were held at each edition.

## Decisions

- **One series concept with a type.** A single `RecurringSeries` model replaces
  `Competition`. It has a `type` of `quiz` (editions are quizzes) or `event` (editions are
  events). A series has one type; its editions are all of that kind.
- **The admin chooses the type.** Trivia Nationals can be set up as an event series, or its
  main championship as a quiz series, or both side by side. The model doesn't prefer
  either.
- **Users still see "Competition".** User-facing labels and the `/competitions` URLs are
  unchanged. `/competitions` lists quiz series only. Event series live under
  `/events/recurring/<slug>`.
- **"Held at" is derived, not stored.** A quiz series is not permanently tied to an event
  series. Trivia the Gathering was a standalone event in 2025 and was held at Trivia
  Nationals in 2026. Whether a quiz series was held at an event series' edition therefore
  comes from each quiz's `series_id` and `event_id`. There is no parent link between
  series.
- **No nested events.** A quiz held at an event is a single quiz, even when in reality it was
  a bracketed tournament.
- **The code and API say "series".** The backend and generated client are renamed so that
  nothing in the code calls Trivia Nationals a "competition". The frontend UI layer (route
  files, components, labels) keeps "competition" because that is the user-facing word.

## Data model (end state)

```
Organization
 └── RecurringSeries            (table: recurringseries, was: competition)
       id, slug, name, description, organization_id
       type: RecurringSeriesType   quiz | event        ← PR 2
         │                    │
   quiz.series_id       event.series_id                ← renamed in PR 1 / new in PR 2
   (type = quiz)        (type = event)
         │                    │
        Quiz ── quiz.event_id ──► Event
```

- `RecurringSeries.type`: Postgres enum `recurringseriestype`, NOT NULL, `server_default
  'quiz'`. Every existing competition is a series of quizzes, so the backfill is `quiz`.
- `Event.series_id`: nullable FK to `recurringseries.id`, `ondelete="SET NULL"`, matching
  `quiz.series_id`.
- `Quiz.competition_id` becomes `Quiz.series_id`, with the same FK behaviour
  (`SET NULL`).

### Rules

| Rule | Where | Failure |
|---|---|---|
| `quiz.series_id` must reference a series of type `quiz` | crud, quiz create/update | 422 |
| `event.series_id` must reference a series of type `event` | crud, event create/update | 422 |
| A referenced series must exist | route | 404 |
| `type` cannot change while any quiz or event links to the series | crud, series update | 409 |
| Organizations need not match across quiz, event and series | — | not enforced (as today) |

An empty series can change type freely, so a wrong choice is cheap to fix.

### Not stored

- **Held at:** quiz → `series_id` plus quiz → `event_id` → event → `series_id`.
- **Edition year:** the event's or quiz's `start_date`. There is no edition-number column.

### Migration safety

Both migrations use `op.rename_table` and `op.alter_column` rather than drop-and-create, so
all existing rows survive, including those in the staging volume. Both have working
downgrades.

## PR 1: pure rename (no behaviour change)

### Backend

- Models:
  - `Competition`, `CompetitionBase`, `CompetitionCreate`, `CompetitionUpdate`,
    `CompetitionPublic` and `CompetitionListPublic` become `RecurringSeries`,
    `RecurringSeriesBase`, `RecurringSeriesCreate`, `RecurringSeriesUpdate`,
    `RecurringSeriesPublic` and `RecurringSeriesListPublic`.
  - `competition_id` becomes `series_id` on `Quiz`, `QuizCreate`, `QuizUpdate` and
    `QuizPublic`.
- Routes:
  - `api/routes/competitions.py` becomes `api/routes/series.py`, mounted at
    `/api/v1/series` with the tag `series`. The generated client service becomes
    `SeriesService`.
  - The `competition_id` filter on `GET /quizzes` becomes `series_id`.
  - Error text "Competition not found" becomes "Series not found".
- crud: `create_competition`, `update_competition` and `delete_competition` become
  `create_series`, `update_series` and `delete_series`.
- **Player history keeps "competition" for now.** Nothing in the player-history surface is
  renamed:
  - the `GET /players/{player_id}/competition-history?competition=` endpoint;
  - the `PlayerCompetitionGroup` and `PlayerCompetitionHistory` models;
  - the `competition_id`, `competition_name` and `competition_slug` fields on those models
    and on `PlayerResultWithQuiz`;
  - `crud.get_player_competition_history`.

  Internally these read from `RecurringSeries` and `Quiz.series_id`.
- `podium.py`: docstring wording only.
- Migration:
  - rename the table `competition` → `recurringseries`;
  - rename the column `quiz.competition_id` → `series_id`;
  - rename the PK constraint, the FK constraint and the slug index to the names SQLModel
    would generate for the new table and column, so that a later `alembic revision
    --autogenerate` shows no drift.
- Tests: `tests/api/routes/test_competitions.py` becomes `test_series.py`. Every other test
  file referencing competitions (`test_players.py`, `test_slug_routes.py`,
  `tests/utils/quiz.py`, `test_slugs.py`, `conftest.py`) is updated for the new names.

### Frontend

- Regenerate `src/client/` with `scripts/generate-client.sh`.
- Update call sites: `CompetitionsService` → `SeriesService`, `competition_id` →
  `series_id`, and the renamed public types.
- Unchanged:
  - component names (`CompetitionDialog`, `CompetitionPodium`);
  - route files (`competitions.tsx`, `competitions_.$slug.tsx`,
    `players_.$slug_.competitions.$competitionSlug.tsx`, `admin_.competitions.tsx`);
  - URLs and all user-visible labels.
- E2E specs (`competitions-public.spec.ts`, `competitions-admin.spec.ts`,
  `upload.spec.ts`, `players.spec.ts`, `qualifier-quizzes.spec.ts`, `events.spec.ts`,
  among others) are updated for the service and field renames only. Unit tests such as
  `competition-prefill.test.ts` are updated for the same renames.

### How PR 1 is verified

- The backend test suite passes.
- The full E2E suite passes: one run, not concurrent with any other, with mailcatcher up
  and the Docker frontend container stopped.
- On dev, `alembic upgrade head` followed by `alembic downgrade -1` and `upgrade head`
  round-trips cleanly.
- The `/competitions` pages and the admin competitions page are checked by hand and look
  the same as before.

## PR 2: series type and event series

### Backend API

**Series**

- `type: RecurringSeriesType` is added to `RecurringSeriesBase`, so it appears in Create,
  Public and list responses. It defaults to `quiz` on create. `RecurringSeriesUpdate`
  accepts `type: RecurringSeriesType | None`.
- `GET /series` takes an optional `type` query parameter. `count` reflects the filter.
  Without the parameter it returns every series.
- `PATCH /series/{id}` changing `type` while any quiz or event references the series
  returns 409 "Series has linked quizzes or events".

**Events**

- `EventCreate` and `EventUpdate` gain `series_id: uuid.UUID | None`.
- `EventPublic` gains `series_id`, `series_name` and `series_slug`, filled the same way as
  `organization_name` and `organization_slug`.
- `GET /events` takes an optional `series_id` query parameter to list one series'
  editions.

**Type rule**

- A single crud helper, `_require_series_type(session, series_id, expected)`, raises
  `SeriesTypeError`, a `ValueError` subclass distinct from the slug-collision
  `ValueError`, following the `EventValidationError` pattern.
- Routes map `SeriesTypeError` to 422.
- It is called from quiz create and update with `expected=quiz`, and from event create and
  update with `expected=event`.

**Podium**

- `QuizPodium` gains `event_name`, `event_slug`, `series_name` and `series_slug`, all
  optional.
- `GET /series/{id}/podium` selects approved quizzes by the series' type, ordered by
  `start_date` ascending:
  - `quiz`: quizzes with `quiz.series_id = id`, as today.
  - `event`: quizzes whose event has `event.series_id = id`, across every edition.
- `build_podium` is unchanged. An event series therefore gets aggregated medal standings
  across its whole history, and qualifiers keep their existing no-medal treatment.

**Migration**

- Create the enum `recurringseriestype` (`quiz`, `event`).
- Add `recurringseries.type` NOT NULL with `server_default 'quiz'`.
- Add `event.series_id` as a nullable FK with `ON DELETE SET NULL`.
- The downgrade drops the new column, the new type and the new FK.

### Frontend

**Public pages**

- `/competitions` requests `type=quiz`, so event series are not listed.
- `/competitions/$slug`:
  - A slug that belongs to an event series redirects to `/events/recurring/$slug`.
  - Each quiz in the history shows "at <event>", linking to `/events/<event-slug>`,
    when the quiz has an event.
- `/events` groups events under their series name, which links to
  `/events/recurring/<slug>`. Events without a series are listed as today.
- `/events/$slug` shows "Part of <series>" under the title, linking to the series page,
  when the event has a series.
- `/events/recurring/$slug` (new route file `events_.recurring.$slug.tsx`) has four parts:
  - **Header:** name, organization link, description.
  - **Editions:** one row per event, earliest first, with year, event name (linking to the
    event page), location and quiz count. The data comes from
    `GET /events?series_id=`.
  - **Held here (matrix):**
    - Columns: one per edition, earliest first.
    - Rows: one per quiz series that appeared at any edition, labelled with the series
      name and linking to `/competitions/<slug>`.
    - Cells: the winner (the team name for team quizzes, otherwise the participants),
      linking to the quiz. A cell shows "—" when that series was not held at that
      edition.
    - A final **Other quizzes** row holds one-off quizzes (no `series_id`). Each cell lists
      the quiz name and its winner, one line per quiz.
    - Qualifiers are shown with a "Qualifier" tag and no medal styling.
    - The matrix is built client-side from the event-series podium response (each
      `QuizPodium` carries its event and series), and scrolls horizontally inside its own
      container at narrow widths.
  - **Medal table:** the existing standings component, fed by the same podium response.
- The `/events/recurring/$slug` route shows a not-found state for an unknown slug or a
  quiz-type series.

**Admin**

- Admin competitions page:
  - A **Type** column (Quiz / Event) is added. Series of both types are listed.
  - `CompetitionDialog` gains a Type segmented toggle (the standard segmented control)
    that defaults to Quiz.
  - A 409 on a type change shows as an error toast.
- Admin events dialog gains an optional **Recurring series** select, populated from
  `GET /series?type=event`.
- Upload wizard: the competition dropdown requests `type=quiz` only.

### Tests

**Backend**

- The type rule for quizzes and events, including the correct type (accepted), the wrong
  type (422) and an unknown series (404).
- A type change is blocked (409) when quizzes or events link to the series, and allowed
  when it is empty.
- The `GET /series?type=` and `GET /events?series_id=` filters, including counts.
- The event-series podium across two editions: a quiz series held at both, a one-off quiz
  at one, an unapproved quiz excluded, and a qualifier included without medals.
- The new `QuizPodium` event and series fields are filled, and are null when absent.
- `EventPublic` series fields.
- Migration round-trip on dev: upgrade, downgrade, upgrade.

**E2E (fixtures built through the generated client)**

- New `events-recurring.spec.ts`:
  - the editions list;
  - matrix cells, including "—" and the Other quizzes row;
  - the medal table;
  - the "Part of" line on the event page;
  - the "at <event>" line on a quiz series page;
  - the redirect from `/competitions/<event-series-slug>`.
- `competitions-public.spec.ts`: an event series is not listed on `/competitions`.
- `competitions-admin.spec.ts`: the Type toggle, and the 409 toast on a type change.
- `events.spec.ts`: assigning a recurring series in the admin events dialog, and grouping
  on `/events`.
- `upload.spec.ts`: event series are absent from the competition dropdown.

## Out of scope

- An explicit, user-defined ordering of series or editions. Chronological order stays the
  interim ordering.
- Nested events, and bracket or tournament structure within a quiz.
- Any stored parent link between a quiz series and an event series.
- Renaming anything the user sees from "Competition" to "Series".
