# Reject Submissions, Admin Edit/Delete on Event Page

**Date:** 2026-06-09  
**Branch:** reject-submissions  
**Approach:** Option A — symmetric reject endpoint, public-page inline admin controls

---

## Overview

Three capabilities are added:

1. Admins can reject pending event submissions, putting them into a `rejected` state. Rejected events can be returned to `pending`.
2. The admin Event Review page gains a "Rejected" section and Reject/Return-to-Pending buttons.
3. The public `/events/$id` page gains Edit and Delete controls visible only to admins.

---

## Backend

### Model change

`EventStatus` enum gains a third value:

```python
class EventStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
```

A new Alembic migration updates the DB column type to include `rejected`.

### New endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/events/{id}/reject` | Superuser | Sets status `pending → rejected`. 400 if already rejected or approved. |
| `POST` | `/events/{id}/set-pending` | Superuser | Sets status `rejected → pending`. 400 if not currently rejected. |
| `DELETE` | `/events/{id}` | Superuser | Hard-deletes the event and its results (cascade already in place). |

### Visibility rules (unchanged logic, extended for `rejected`)

- `GET /events/` — non-superusers always see only `approved`. Superusers can pass `?status=rejected` to filter.
- `GET /events/{id}` — rejected events return 404 for non-superusers; visible to superusers.
- Same applies to `GET /events/{id}/results` and `/results/with-players`.

---

## Frontend — Admin Event Review page (`/admin/events`)

### Section layout (updated)

1. **Pending Review** — existing, unchanged
2. **Rejected** — new section using `EventsTableContent` with `status="rejected"`. Empty state: "No rejected events."
3. **Approved Events** — renamed from "All Events"; uses `status="approved"` explicitly.

### Event row actions

The existing **Review** button in the Pending Review table gains a companion **Reject** button that calls `POST /reject` directly (no confirmation dialog — rejection is reversible).

### Admin event detail page (`/admin/events/$id`)

Button row logic:

| Event status | Buttons shown |
|---|---|
| `pending` | Approve, Reject, Edit Metadata |
| `rejected` | Return to Pending, Edit Metadata |
| `approved` | Edit Metadata |

Badge variants: `pending` → `destructive`, `approved` → `default`, `rejected` → `secondary`.

---

## Frontend — Public event detail page (`/events/$id`)

When the current user is a superuser, the event header gains two icon buttons in the top-right:

- **Edit** (pencil icon) — opens `MetadataEditDialog`, extracted into a shared component at `src/components/Events/MetadataEditDialog.tsx` and reused by both the admin detail page and this page.
- **Delete** (trash icon) — opens a confirmation dialog ("Are you sure? This cannot be undone."), calls `DELETE /events/{id}`, then redirects to `/events` on success.

These controls are not rendered for non-superusers. Current user is fetched via `UsersService.readUserMe()`.

---

## Tests (`backend/tests/api/routes/test_events.py`)

### `POST /events/{id}/reject`
- `test_reject_event_as_superuser` — pending → rejected, response reflects new status
- `test_reject_event_as_organizer_forbidden` — 403
- `test_reject_event_as_regular_user_forbidden` — 403
- `test_reject_already_rejected_event` — 400
- `test_reject_approved_event_forbidden` — 400

### `POST /events/{id}/set-pending`
- `test_set_pending_from_rejected` — rejected → pending round-trip
- `test_set_pending_from_non_rejected_returns_400` — 400 on pending or approved event
- `test_set_pending_as_organizer_forbidden` — 403
- `test_set_pending_as_regular_user_forbidden` — 403

### `DELETE /events/{id}`
- `test_delete_event_as_superuser` — event removed from DB
- `test_delete_event_cascades_results` — results gone after delete
- `test_delete_event_as_organizer_forbidden` — 403
- `test_delete_event_as_regular_user_forbidden` — 403

### Visibility
- `test_read_rejected_event_as_public_returns_404`
- `test_superuser_can_filter_rejected`

---

## Shared component extraction

`MetadataEditDialog` is moved from `_layout/admin_.events_.$id.tsx` into `src/components/Events/MetadataEditDialog.tsx` and imported by both:
- `src/routes/_layout/admin_.events_.$id.tsx`
- `src/routes/_public/events_.$id.tsx`
