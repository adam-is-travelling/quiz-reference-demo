# Admin Organizations CRUD — Design Spec

**Date:** 2026-06-19
**Branch:** create-edit-organizations
**Status:** Approved

## Overview

Add create, edit, and delete capabilities for organizations to the admin Dashboard. Currently organizations are read-only (public list + detail pages). The backend already has POST and PATCH endpoints; this spec adds DELETE on the backend and a full admin UI page on the frontend.

## Backend

### New endpoint: `DELETE /organizations/{id}`

- File: `backend/app/api/routes/organizations.py`
- Superuser-only (same guard as POST and PATCH)
- Returns 404 if organization not found
- Returns `{"ok": True}` on success (matches `delete_format` pattern)
- No explicit cascade needed: the `organization_id` FK on Quiz already has `ondelete="SET NULL"`, so related quizzes automatically lose their org reference

## Frontend

### New component: `OrganizationDialog`

- File: `frontend/src/components/Admin/OrganizationDialog.tsx`
- Props: `org?: OrganizationPublic`, `trigger: React.ReactNode`
- Doubles as create (no `org` prop) and edit (with `org` prop)
- Zod schema fields:
  - `name`: required string
  - `description`: optional string
  - `website`: optional string
  - `logo_url`: optional string
- Calls `OrganizationsService.createOrganization` or `updateOrganization` based on mode
- Invalidates `["organizations"]` query on success
- Follows the same Dialog + react-hook-form + shadcn Input/Label pattern as `FormatDialog`

### New route: `admin_.organizations.tsx`

- File: `frontend/src/routes/_layout/admin_.organizations.tsx`
- Superuser guard in `beforeLoad` (same pattern as `admin_.formats.tsx`)
- Page title/description: "Organizations" / "Manage quiz governing bodies and associations"
- Header: "New Organization" button (`OrganizationDialog` with no org prop)
- Table columns: Name | Description | Website | Actions
- Actions per row:
  - Edit: pencil icon button → `OrganizationDialog` with the org
  - Delete: trash icon button → shadcn `AlertDialog`
- Delete `AlertDialog` content:
  - Title: "Delete organization?"
  - Body: `Deleting '{name}' will remove it from any associated quizzes. This cannot be undone.`
  - Buttons: Cancel / Delete (destructive)
- On delete success: invalidates `["organizations"]` query, shows success toast

### Sidebar update

- File: `frontend/src/components/Sidebar/AppSidebar.tsx`
- Add `{ icon: Building2, title: "Organizations", path: "/admin/organizations" }` to the superuser block, between Formats and Admin
- Import `Building2` from `lucide-react`

## Backend Tests

New tests in `backend/tests/api/routes/test_organizations.py`:

### `test_delete_organization_as_superuser`
- Create an org via `create_random_organization(db)`
- `DELETE /organizations/{id}` with superuser headers → 200
- Verify org is gone: `GET /organizations/{id}` → 404

### `test_delete_organization_forbidden`
- Create an org
- `DELETE /organizations/{id}` with `organizer_token_headers` → 403

### `test_delete_organization_not_found`
- `DELETE /organizations/{uuid4()}` with superuser headers → 404

### `test_delete_organization_nullifies_quiz_organization`
- Create an org and a quiz, then set `quiz.organization_id = org.id` (commit/refresh)
- `DELETE /organizations/{org.id}` with superuser headers → 200
- Fetch the quiz from DB, assert `quiz.organization_id is None`
- Assert the quiz itself still exists (no cascade delete)

**Cleanup:** The test creates both an org and a quiz. The existing `clean_org_data` autouse fixture handles org cleanup. Quizzes created in the SET NULL test must also be cleaned up — add a local fixture or inline cleanup (delete the quiz in a `finally`/teardown block, or use a dedicated `clean_quiz_data` fixture scoped to that test).

## Patterns & References

- Dialog pattern: `frontend/src/components/Admin/FormatDialog.tsx`
- Route pattern: `frontend/src/routes/_layout/admin_.formats.tsx`
- Sidebar pattern: `frontend/src/components/Sidebar/AppSidebar.tsx`
- Backend pattern: `backend/app/api/routes/organizations.py` (existing POST/PATCH)
