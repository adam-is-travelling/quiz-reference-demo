# Quiz Series Admin & Public Pages — Design

**Date:** 2026-06-26
**Branch:** create-edit-series

## Overview

Add full CRUD admin pages and a public-facing read-only list page for Quiz Series. Series already exist in the database and backend, but lack a delete endpoint, org-name enrichment, an admin UI, a public list page, and tests.

## Scope

- Backend: delete endpoint, org-name join, backend tests
- Frontend admin: SeriesDialog, admin series page, sidebar link
- Frontend public: series list page, public nav link, detail page enhancement
- Frontend tests: Playwright specs for admin CRUD and public browsing

---

## Section 1: Backend

### 1.1 Delete endpoint

Add `delete_series` to `crud.py`:

```python
def delete_series(*, session: Session, db_series: QuizSeries) -> None:
    session.delete(db_series)
    session.commit()
```

Add `DELETE /{id}` to `series.py` — superuser-only, returns `{"ok": True}`, 404 if not found. Deleting a series sets `quiz.series_id` to NULL automatically via the existing `ondelete="SET NULL"` FK constraint.

### 1.2 Organization name enrichment

Add `organization_name: str | None = None` to `QuizSeriesPublic` in `models.py`.

Update the `GET /series/` (list) and `GET /series/{id}` (detail) endpoints to join with `Organization` and populate `organization_name`. The `organization_id` field is already returned, giving the frontend enough to both display the name and construct a link to `/organizations/$id`.

### 1.3 Client regeneration

After backend changes, run `scripts/generate-client.sh` to add `SeriesDeleteSeries` to the generated frontend SDK.

### 1.4 Backend tests (additions to `test_series.py`)

| Test | Assertion |
|---|---|
| `test_delete_series_as_superuser` | 200 + `{"ok": True}`; subsequent GET returns 404 |
| `test_delete_series_forbidden_for_organizer` | 403 |
| `test_delete_series_not_found` | 404 for unknown UUID |
| `test_delete_series_nullifies_quiz_series_id` | Deleting a series sets `quiz.series_id` to NULL |
| `test_read_series_includes_organization_name` | List endpoint returns `organization_name` when org is attached |
| `test_read_series_item_includes_organization_name` | Detail endpoint returns `organization_name` when org is attached |

---

## Section 2: Frontend — Admin

### 2.1 `SeriesDialog.tsx` (`components/Admin/`)

Create/edit dialog following the `OrganizationDialog` pattern.

Fields:
- `name` — required text input
- `description` — optional textarea
- `organization_id` — optional `<select>` dropdown populated via `OrganizationsService.readOrganizations`

Behaviour:
- When `series` prop is passed → edit mode (`SeriesService.updateSeries`)
- Without prop → create mode (`SeriesService.createSeries`)
- On success: invalidate `["series"]` query, close dialog, show toast

### 2.2 `_layout/admin_.series.tsx`

Superuser-only page (redirect in `beforeLoad` if not superuser).

Table columns: Name, Description, Organization (org name or "—"), Actions.

Actions column:
- Edit button → opens `SeriesDialog` in edit mode
- Delete button → opens `AlertDialog` confirmation, calls `SeriesService.deleteSeries`, invalidates `["series"]` query

Page header has "New Series" button that opens `SeriesDialog` in create mode.

Table content is Suspense-wrapped with a loading skeleton fallback.

### 2.3 Admin sidebar (`AppSidebar.tsx`)

Add "Series" entry to the superuser items list between Formats and Organizations, using the `List` lucide icon and path `/admin/series`.

---

## Section 3: Frontend — Public

### 3.1 `_public/series.tsx` (new)

Public list page, no auth required.

Renders a simple table with columns: Name, Description, Organization. Each row links to `/series/$id`. Empty state message when no series exist. Suspense-wrapped.

### 3.2 `PublicNav.tsx`

Add "Series" link after "Organizations" in the nav bar, same style as existing links.

### 3.3 `_public/series.$id.tsx` (update existing)

Update the existing detail page to display the organization name with a link to `/organizations/$id` when `organization_id` is set. Rendered beneath the series description, above the events table.

---

## Section 4: Frontend Tests (Playwright)

### 4.1 `tests/series-admin.spec.ts`

Logs in as superuser:
1. Navigates to `/admin/series`
2. Verifies page loads and "Series" appears in admin sidebar
3. Creates a new series via dialog, confirms it appears in the table
4. Edits it, confirms the name updates in the table
5. Deletes it via confirmation dialog, confirms row is gone

### 4.2 `tests/series-public.spec.ts`

Unauthenticated browser. Requires at least one series to exist — the spec creates one via the API (using superuser credentials in a `beforeAll` setup hook) and cleans up after itself.

1. Visits `/series`, verifies page loads and "Series" appears in public nav
2. Clicks the seeded series row, confirms navigation to `/series/$id`
3. Verifies the quizzes section is present on the detail page

---

## Files Changed

| File | Change |
|---|---|
| `backend/app/crud.py` | Add `delete_series` |
| `backend/app/models.py` | Add `organization_name` to `QuizSeriesPublic` |
| `backend/app/api/routes/series.py` | Add DELETE endpoint; update list + detail to join org name |
| `backend/tests/api/routes/test_series.py` | Add 6 new test cases |
| `frontend/src/components/Admin/SeriesDialog.tsx` | New component |
| `frontend/src/routes/_layout/admin_.series.tsx` | New route |
| `frontend/src/routes/_public/series.tsx` | New route |
| `frontend/src/routes/_public/series.$id.tsx` | Add org name + link |
| `frontend/src/components/Common/PublicNav.tsx` | Add Series link |
| `frontend/src/components/Sidebar/AppSidebar.tsx` | Add Series sidebar item |
| `frontend/src/client/` | Regenerated (add delete method) |
| `frontend/tests/series-admin.spec.ts` | New Playwright spec |
| `frontend/tests/series-public.spec.ts` | New Playwright spec |
