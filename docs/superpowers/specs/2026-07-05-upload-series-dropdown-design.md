# Upload wizard: org-scoped Series dropdown

**Date:** 2026-07-05
**Scope:** `frontend/src/components/Upload/steps/Step1EventMeta.tsx` only. No backend or API client changes.

## Problem

In the results-upload wizard (Step 1, "New quiz" mode):

- The Series dropdown shows all series regardless of organization.
- "None" is a `SelectValue` placeholder, so it renders muted grey instead of the normal foreground color.
- Series sits above Organization in the form, though a series only makes sense in the context of an organization.

## Requirements

1. The Series dropdown appears on the same row as the Organization dropdown, to its right.
2. The Series dropdown is rendered only when both are true:
   - an organization is selected (not "No Organization"), and
   - that organization has at least one series.
3. Series options are scoped to the selected organization.
4. "None" is an explicit selectable item rendered in the normal foreground color (white in dark mode), not a muted placeholder.

## Approach

Filter client-side. `QuizSeriesPublic` already includes `organization_id`, and the wizard already fetches all series (limit 100), so no backend query param or client regeneration is needed.

## Design

- **Layout:** Replace the separate Series and Organization blocks with one flex row (same pattern as the start/end date pair in this form): Organization on the left, Series on the right when visible.
- **Controlled select:** Add `selectedSeriesId` state (mirroring the existing `selectedOrgId` / `selectedFormatId` pattern), initialized from `state.eventMeta.series_id || "__none__"`. The select gets an explicit `<SelectItem value="__none__">None</SelectItem>`; because "None" is a real selected value rather than a placeholder, it renders in the foreground color.
- **Scoping:** Options are `seriesList.data.filter(s => s.organization_id === selectedOrgId)`.
- **Visibility:** Render the Series field only when `selectedOrgId !== "__none__"` and the filtered list is non-empty.
- **Reset:** When the organization changes (including to "No Organization"), reset `selectedSeriesId` to `"__none__"` and `setValue("series_id", "")`, so a series from another org can never be submitted.
- **Persistence:** Returning to this step with a previously chosen org + series restores both selections.

## Testing

- Playwright E2E covers the upload wizard; verify manually via the running stack that:
  - Series is hidden with no org selected, hidden for an org with no series, visible and scoped for an org with series.
  - Changing org resets the series selection.
  - "None" renders in foreground color.
- No unit-test framework exists for frontend components in this repo; no new test infrastructure is introduced.
