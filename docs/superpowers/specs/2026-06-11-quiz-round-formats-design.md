# Quiz Round Formats — Design Spec

**Date:** 2026-06-11

## Overview

Quizzes are divided into multiple rounds. This feature adds a `QuizFormat` entity that defines the named rounds for an event, stores per-round scores against each `EventResult`, and surfaces round columns on the public event results page. Formats are shared across events and managed via a dedicated admin page.

---

## Data Model

### New table: `QuizFormat`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `name` | varchar(255), not null | e.g. "UK Championship Format" |
| `description` | text, nullable | Optional free-text description |
| `rounds` | JSON (list[str]), not null | Ordered list of up to 20 round name strings, e.g. `["Round 1", "Geography", "Picture Round"]` |

`rounds` is stored as a JSON array on the format entity because it is a definition (names/labels), not measurement data. The length of the list (1–20) determines how many round columns are active for any event that uses this format.

### `QuizEvent` changes

- **Remove:** `format: dict | None` — the existing freeform JSON field (`questions`, `rounds` count, `categories`). This metadata was display-only and is superseded.
- **Add:** `format_id: uuid.UUID | None` — FK → `quizformat.id`, `ON DELETE SET NULL`

The nested format object is included in `QuizEventPublic` so the frontend always has round names in a single fetch.

### `EventResult` changes

- **Keep:** `id`, `event_id`, `player_id`, `score` (independent total), `final_rank`
- **Add:** `round_1` … `round_20` — all `float | None`, default `None`

Round slot `round_N` holds the score for `format.rounds[N-1]`. Only slots `1..len(format.rounds)` are expected to be populated; the remainder stay `None`. The `score` field is the independently-entered total and is **not** auto-computed from round scores.

**Serialisation contract:** The backend serialises the 20 columns into a compact `list[float | None]` trimmed to the active round count for API responses (`round_scores`), and maps back to the correct columns on write.

---

## API

### New router: `POST/GET/PATCH/DELETE /formats/`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/formats/` | public | List all formats |
| `POST` | `/formats/` | superuser | Create format |
| `GET` | `/formats/{id}` | public | Get single format |
| `PATCH` | `/formats/{id}` | superuser | Update name / description / rounds |
| `DELETE` | `/formats/{id}` | superuser | Returns 409 if any event references the format |

**Models:**

```
QuizFormatBase:   name, description, rounds
QuizFormatCreate: QuizFormatBase
QuizFormatUpdate: all fields optional
QuizFormat:       table=True, id
QuizFormatPublic: id + QuizFormatBase
QuizFormatsPublic: data: list[QuizFormatPublic], count: int
```

### Updated event models

- `QuizEventCreate` / `QuizEventUpdate`: `format_id: uuid.UUID | None` replaces `format: dict | None`
- `QuizEventPublic`: exposes `format_id: uuid.UUID | None` and `format: QuizFormatPublic | None` (nested, populated by a join in the read endpoint — no second request needed on the frontend)

### Updated result models

All result read models (`EventResultPublic`, `EventResultWithPlayer`) add:
```
round_scores: list[float | None] | None
```

All result write models (`EventResultCreate`, `EventResultUpdate`, `ResolvedResultRow`) add:
```
round_scores: list[float | None] | None  # max length 20, validated
```

The backend validates that `len(round_scores) <= len(event.format.rounds)` when a format is assigned, and rejects `round_scores` on events with no format.

---

## Frontend

### New page: `/admin/formats`

A superuser-only page listing all formats in a table:

| Name | Description | Rounds | Actions |
|------|-------------|--------|---------|

**Create / Edit dialog:**
- Name (required)
- Description (optional textarea)
- Dynamic list of round name inputs (up to 20). Rows can be added and removed. Order is significant.

**Delete:** If any event references the format, show an error toast ("Format is in use by N event(s)") and do not delete. Otherwise, delete with confirmation.

A new **"Formats"** sidebar entry is added to the superuser admin section, between "Review Events" and "Admin".

### Event metadata dialog (`MetadataEditDialog`)

Adds a **Format** dropdown (options: "No Format" + all existing formats by name). Selecting a format sets `format_id` on the event. Clearing it sets `format_id: null`.

### Public event results table

**With a format assigned** — columns are rendered dynamically:

| Rank | Player | Total | Round 1 | Geography | Picture Round | … |

- "Total" maps to `EventResult.score`
- Round columns are headed with the round name from `format.rounds`
- Empty round slots (`null`) render as `—`

**Without a format** — falls back to the current layout:

| Rank | Player | Score |

### Admin event results table (`/admin/events/:id`)

Same dynamic column behaviour as the public table. The existing inline score edit targets the `score` (total) field. Round scores are read-only in the admin table (edited via re-upload or future per-cell editing).

### Upload wizard — Step 3 column mapping

If the event has a format assigned, the column mapper exposes the format's round names as additional optional mapping targets alongside `player_name`, `country`, and `score`. Each round column is independently optional — unmapped rounds are submitted as `None`.

Mapped round values flow through `ResolvedResultRow.round_scores` (a list ordered by round index) to the submit endpoint.

If the event has no format, the round mapping targets are not shown.

---

## Migration

1. Add `quizformat` table.
2. Add `format_id` column to `quizevent` (nullable FK).
3. Drop `format` JSON column from `quizevent`.
4. Add `round_1` … `round_20` columns to `eventresult` (all nullable float).

The drop of `quizevent.format` is a breaking schema change. Existing events lose the freeform metadata (question count, categories). This is acceptable — that data was display-only and has no downstream consumers.

---

## Constraints & Validation

- `QuizFormat.rounds` length: 1–20. Empty rounds list is rejected.
- Individual round names: max 100 chars, non-empty.
- `EventResultCreate.round_scores`: max length 20; must not exceed `len(event.format.rounds)`; rejected if event has no format.
- Format delete: blocked (HTTP 409) if `quizevent.format_id` references the format.
- Round slot alignment: enforced in application code, not at DB level.
- Unassigning a format from an event: permitted regardless of existing round scores (the scores are preserved in the DB but not displayed). The admin is responsible for cleaning up stale round scores if needed.
