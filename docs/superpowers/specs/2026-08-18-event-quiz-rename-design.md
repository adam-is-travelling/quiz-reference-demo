# `event` → `quiz` rename

**Date:** 2026-08-18
**Status:** Design approved

## Problem

The codebase uses "event" to mean *a quiz*. `CompetitionPodiumPublic.events` is a list of
quizzes, `components/Events/` holds quiz components, `Step1EventMeta` collects quiz
metadata, and `crud.py` names its `Quiz` parameters `db_event` and `event_in`. A user-facing
heading on the competition page reads "Events" above a table of quizzes.

The [Event feature](2026-08-18-events-design.md) introduces `Event` as a real model: a
gathering such as Trivia Nationals 2026 that groups several quizzes. Building it on top of
the current vocabulary would leave `Event` meaning two different things in the same files.

This spec frees the word. It is a pure rename: no behaviour changes, no schema changes, no
new endpoints. It ships as its own branch and PR, merged before the Event feature starts.

## Scope

Roughly 322 occurrences in application code plus 187 in `backend/tests/` and 12 in
`frontend/tests/`, across ~30 files, excluding Alembic migrations and DOM event handlers.

### Backend

`backend/app/models.py`:

| Before | After |
| --- | --- |
| `CompetitionEventPodium` | `QuizPodium` |
| `CompetitionPodiumPublic.events` | `CompetitionPodiumPublic.quizzes` |
| `PlayerHistoryGrouped.total_events` | `PlayerHistoryGrouped.total_quizzes` |

`CompetitionEventPodium` drops its prefix entirely rather than becoming
`CompetitionQuizPodium`. The model describes a single quiz's podium — the `Competition`
prefix was never accurate, and the Event feature will reuse the model for events. Renaming
it once, here, avoids renaming the same symbol again in the next PR.

`backend/app/crud.py` and `backend/app/api/routes/`: rename local variables and keyword
parameters that hold a `Quiz`.

| Before | After |
| --- | --- |
| `db_event` | `db_quiz` |
| `event_in` | `quiz_in` |
| `event` (loop variable over `Quiz`) | `quiz` |
| `event_id` (parameter naming a `Quiz`) | `quiz_id` |
| `event_podiums` | `quiz_podiums` |

`crud.py` keyword parameters are called by name from route handlers, so every call site
changes with the definition.

`QuizResult.quiz_id` and the `quiz` table are already correctly named. They do not change.

### Frontend

| Before | After |
| --- | --- |
| `components/Events/` | `components/Quizzes/` |
| `components/Events/EventResultsTable.tsx` | `components/Quizzes/QuizResultsTable.tsx` |
| `components/Events/columns.tsx` | `components/Quizzes/columns.tsx` |
| `components/Events/MetadataEditDialog.tsx` | `components/Quizzes/MetadataEditDialog.tsx` |
| `components/Upload/steps/Step1EventMeta.tsx` | `components/Upload/steps/Step1QuizMeta.tsx` |
| `UploadWizard` state key `eventMeta` | `quizMeta` |
| `"Events"` heading in `CompetitionPodium.tsx` | `"Quizzes"` |
| `"No events published yet."` | `"No quizzes published yet."` |

`git mv` the files so history follows them.

### Tests

`backend/tests/utils/quiz.py` exports helpers whose names say "event" but return `Quiz`:

| Before | After |
| --- | --- |
| `create_random_event` | `create_random_quiz` |
| `create_approved_event` | `create_approved_quiz` |
| `create_approved_event_in_competition` | `create_approved_quiz_in_competition` |
| `create_rejected_event` | `create_rejected_quiz` |

Their call sites across `backend/tests/` change with them, as do local variables named
`event` that hold a `Quiz`, and `event_in=` keyword arguments to `crud` functions.

`frontend/tests/`:

| Before | After |
| --- | --- |
| `emptyEventMeta` (from `Upload/types.ts`) | `emptyQuizMeta` |
| `competitions-public.spec.ts` heading assertion `"Events"` | `"Quizzes"` |

The Playwright assertions on the "Events" heading must change in lockstep with the
component, or `competitions-public.spec.ts` fails.

### Client regeneration

Regenerate the API client from project root:

```bash
bash ./scripts/generate-client.sh
```

This rewrites `frontend/src/client/schemas.gen.ts` and `types.gen.ts` with the renamed
response models. Those two files are generated — never hand-edit them.

## Explicitly out of scope

**Alembic migration files.** `09b03772bf36_rename_quizevent_to_quiz_eventresult_to_.py`,
`5461017c4a57_add_unique_constraint_event_id_player_.py`,
`a3f9b2c1d4e5_drop_tiebreaker_rank_from_eventresult.py` and
`f9213e8bae49_add_rejected_to_event_status.py` keep their filenames, revision IDs and
contents. They are immutable history; renaming them breaks the revision chain.

**Historical spec documents.** `2026-05-27-upload-to-existing-event-design.md` and
`2026-05-29-event-date-ux.md` are records of past decisions and are left alone.

**DOM event handlers.** `addEventListener`, `MouseEvent`, `pointer-events-none` and similar
are unrelated uses of the word.

**Database schema.** No migration is generated. No column, table or constraint changes.

## Commit structure

One commit per layer, so a reviewer can verify each in isolation:

1. `refactor(backend): rename Quiz podium models from event to quiz` — `models.py`
2. `refactor(backend): rename Quiz locals and params from event to quiz` — `crud.py`, routes
3. `refactor(frontend): rename Events components to Quizzes` — `git mv` plus imports
4. `refactor(frontend): rename upload wizard quiz metadata step` — `Step1QuizMeta`, `quizMeta`
5. `refactor(tests): rename event helpers and locals to quiz` — `backend/tests/`, `frontend/tests/`
6. `chore(client): regenerate API client after rename`

## Verification

The rename is correct when behaviour is provably unchanged:

```bash
# Backend — from repo root, using the host venv (the backend container
# serves a stale baked image and will not see these changes)
source .venv/bin/activate && cd backend && bash ./scripts/test.sh

# Frontend
cd frontend && bun run build && bun run lint
```

No test may change its *meaning*. Test edits are limited to two kinds:

1. A renamed symbol at a call site (`create_random_event` → `create_random_quiz`).
2. A renamed user-facing string in an assertion — only the two `"Events"` heading
   assertions in `competitions-public.spec.ts`, which become `"Quizzes"`.

No test count changes, no test is deleted, and no assertion is weakened or removed.

After the client regenerates, confirm the diff to `frontend/src/client/` contains only the
renamed model names and their references. Any change to field types, endpoint paths or
required/optional status means something other than a rename happened.

Finally, grep for stragglers:

```bash
grep -rniE "event" frontend/src frontend/tests backend/app backend/tests \
  --include="*.tsx" --include="*.ts" --include="*.py" \
  | grep -v "components/ui/" \
  | grep -viE "pointer-events|addEventListener|removeEventListener|MouseEvent|ChangeEvent|KeyboardEvent|FormEvent"
```

Every remaining hit must be inside `backend/app/alembic/versions/`.

## Success criteria

- No identifier in `backend/app` (outside `alembic/versions/`), `backend/tests`,
  `frontend/src` or `frontend/tests` uses "event" to mean a quiz.
- No user-facing string says "event" when it means a quiz.
- The full backend and frontend test suites pass unmodified.
- The generated client diff contains renames only.
