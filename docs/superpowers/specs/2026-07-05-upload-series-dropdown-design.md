# Series require an organization + org-scoped Series dropdown in upload wizard

**Date:** 2026-07-05
**Scope:** Backend model/migration/routes, regenerated API client, `SeriesDialog.tsx`, `Step1EventMeta.tsx`.

## Problem

1. In the results-upload wizard (Step 1, "New quiz" mode):
   - The Series dropdown shows all series regardless of organization.
   - "None" is a `SelectValue` placeholder, so it renders muted grey instead of the normal foreground color.
   - Series sits above Organization in the form, though a series only makes sense in the context of an organization.
2. Series can exist without an organization, which no longer matches how the product is used. All series must belong to an organization.

## Requirements

### Backend: organization required on series

1. `QuizSeries.organization_id` becomes non-nullable, FK `ondelete="CASCADE"`: deleting an organization deletes its series. Quizzes pointing at a deleted series keep existing with `series_id` cleared (that FK is already `SET NULL`).
2. `QuizSeriesCreate.organization_id` is required (`uuid.UUID`, no default).
3. `QuizSeriesPublic.organization_id` is non-null; `organization_name` remains as-is.
4. `QuizSeriesUpdate.organization_id` stays optional (PATCH semantics), but an explicit `null` must not unset the org: in `crud.update_series`, drop `organization_id` from the update payload when it is `None`.
5. Create and update routes validate the target organization exists and return 404 `"Organization not found"` otherwise (instead of an FK-violation 500).
6. Alembic migration:
   - Delete any `quizseries` rows with `organization_id IS NULL` before adding the constraint (dev DB has zero such rows today, so this is a no-op safety step; quiz FKs SET NULL automatically).
   - Alter `organization_id` to `NOT NULL`; replace the FK with `ondelete="CASCADE"`.
   - Downgrade reverses both.
7. Regenerate the frontend OpenAPI client (`bash ./scripts/generate-client.sh`).

### Frontend: SeriesDialog (admin)

8. Organization is required: Zod `min(1, "Organization is required")`, the `None` option is replaced by a disabled `— choose an organization —` placeholder, and a validation error renders like the name field's.

### Frontend: upload wizard Step 1

9. The Series dropdown appears on the same row as the Organization dropdown, to its right (same flex-row pattern as the start/end date pair).
10. The Series dropdown is rendered only when both are true:
    - an organization is selected (not "No Organization"), and
    - that organization has at least one series.
11. Series options are scoped to the selected organization: `seriesList.data.filter(s => s.organization_id === selectedOrgId)`.
12. "None" is an explicit selectable item (`__none__`) rendered in the normal foreground color (white in dark mode), not a muted placeholder. The select becomes controlled via new `selectedSeriesId` state (mirroring `selectedOrgId` / `selectedFormatId`), initialized from `state.eventMeta.series_id || "__none__"`.
13. When the organization changes (including to "No Organization"), reset `selectedSeriesId` to `"__none__"` and clear `series_id`, so a series from another org can never be submitted.
14. Returning to this step with a previously chosen org + series restores both selections.

## Approach notes

- Series scoping in the wizard is filtered client-side: `QuizSeriesPublic` carries `organization_id` and the wizard already fetches all series (limit 100). No new backend query param.
- With organization now mandatory, org-less series cannot exist, so the strict equality filter in (11) covers all series.

## Testing

- Backend: extend the existing series route tests (pytest) — creating a series without an organization fails validation; creating with a non-existent org returns 404; PATCH with explicit `organization_id: null` leaves the org unchanged; deleting an org cascades to its series. Run via `docker compose exec backend bash scripts/tests-start.sh`.
- Frontend: verify manually via the running stack that:
  - SeriesDialog requires an organization and shows the validation error.
  - In the wizard, Series is hidden with no org selected, hidden for an org with no series, visible and scoped for an org with series.
  - Changing org resets the series selection; "None" renders in foreground color.
