# Player Merge (Admin) — Design

**Date:** 2026-07-15
**Status:** Approved

## Goal

Admins (superusers) can merge a duplicate player record ("source") into the
canonical one ("target"): the source's quiz results move to the target, the
source is deleted, and the admin sees a preview — including exactly which
source results will be deleted due to conflicts — before confirming.

## Decisions

- **Same-quiz conflicts don't block the merge.** Where both players have a
  result in the same quiz (`QuizResult` has `UniqueConstraint(quiz_id,
  player_id)`), the target's result is kept and the source's is deleted —
  but the preview step must show the admin exactly which results will be
  deleted before they confirm.
- **Strict fill-blanks profile policy.** Information from the source is
  copied ONLY into fields the target has blank/null: `city`, `club`, `bio`,
  `photo_url`. The target's `display_name`, `slug`, and `is_published` are
  never changed by a merge. Countries are unioned (additive facts): the
  target's countries and primary stay as they are; source-only countries
  append as non-primary.
- **UI:** standalone admin page with two search pickers, plus a
  "Merge into…" shortcut on the player profile that pre-fills the source.

## API (backend, both endpoints superuser-only)

New SQLModel schemas in `backend/app/models.py`:

```python
class MergePlayersRequest(SQLModel):
    source_player_id: uuid.UUID
    target_player_id: uuid.UUID

class MergeConflict(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    source_score: float
    source_rank: int | None
    target_score: float
    target_rank: int | None

class MergePlayersPreview(SQLModel):
    moved_results_count: int          # source results that will repoint to target
    conflicts: list[MergeConflict]    # source results that will be DELETED
    filled_fields: list[str]          # target-blank fields to be copied from source
    added_countries: list[str]        # source-only countries to be added (non-primary)
```

### `POST /players/merge/preview` → `MergePlayersPreview`

Read-only. Validates both players exist (404) and `source != target` (400).

### `POST /players/merge` → `PlayerPublic`

Same validation. Executes atomically (single transaction, one commit):

1. Delete the source's `QuizResult` rows for quizzes where the target also
   has a result (the previewed conflicts).
2. Repoint the source's remaining `QuizResult.player_id` to the target.
3. Union countries into `player_country`: source-only codes inserted for the
   target with `is_primary=False`; target rows untouched.
4. Fill target-blank profile fields (`city`, `club`, `bio`, `photo_url`)
   from the source (only where target's value is `None` or empty string).
5. Delete the source player (cascade removes its `player_country` rows).

Returns the merged target as `PlayerPublic`.

Merge logic lives in `backend/app/crud.py` (`preview_merge_players`,
`merge_players`); the routes stay thin, per codebase convention.

## Frontend

### Merge page — `frontend/src/routes/_layout/admin_.players.merge.tsx`

- Superuser-gated via `beforeLoad` redirect, like other `admin_.*` routes.
- Two player pickers, labeled **Source (will be deleted)** and
  **Target (will be kept)**, each a search combobox backed by the existing
  `PlayersService.searchPlayersRoute`; a selected player shows a summary
  (name, countries, city/club).
- Search params `?source=<id>&target=<id>` pre-fill the pickers (loaded via
  `PlayersService.getPlayer`).
- When both are selected, the page calls the preview endpoint and renders:
  - results to move (count) and blank fields to fill / countries to add;
  - if conflicts exist, a destructive-styled warning box listing each
    conflicting quiz (name, date) with both results' score/rank, stating
    plainly that the source's results will be permanently deleted.
- "Merge players" button opens a confirmation dialog (restating source →
  target and the deletion count); on confirm, calls the merge endpoint,
  invalidates `["players"]`, shows a success toast, and navigates to the
  merged player's profile (`/players/$slug`; fall back to staying on the
  page with a toast if the target has no slug).
- Errors surface via the existing `handleError` toast pattern.

### Profile shortcut — `frontend/src/routes/_public/players_.$slug.tsx`

In `AdminControls`, next to Edit: an outline "Merge into…" button linking to
`/admin/players/merge?source=<player.id>`.

### Client regeneration

Run `bash ./scripts/generate-client.sh` after backend changes (new schemas
and routes) so `frontend/src/client/` gains the typed methods.

## Testing

Backend (`backend/tests/api/routes/test_players.py`):

- Happy path: N results repointed, countries unioned (target primary
  unchanged), blank fields filled, non-blank target fields untouched,
  source deleted.
- Conflict: source's conflicting result deleted, target's kept, other
  results moved.
- Preview: accurate counts/conflicts/filled_fields/added_countries and NO
  data changes after calling it.
- Auth: non-superuser gets 403 on both endpoints.
- Validation: unknown ids → 404; source == target → 400.

Frontend E2E (`frontend/tests/players.spec.ts` or a new spec): create two
players with results via API, open the merge page via the profile shortcut,
verify the conflict warning renders, confirm the merge, assert the merged
profile shows the moved results and the source profile 404s.
