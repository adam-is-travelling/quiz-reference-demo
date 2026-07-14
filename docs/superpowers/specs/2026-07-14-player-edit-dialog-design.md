# Admin Player Edit Dialog — Design

**Date:** 2026-07-14
**Status:** Approved

## Goal

Give admins (superusers) an "Edit" option on an individual player's public profile
page (`/players/$slug`) to update the player's information: display name, countries
represented, primary country, city, club, bio, photo URL, and slug.

## Scope

Frontend only. The backend `PATCH /players/{player_id}` endpoint is already
superuser-only and already supports every field via `PlayerUpdate`, including
`countries` where the first country in the submitted list is stored as primary
(`PlayerCountry.is_primary`). No model, route, or migration changes.

## Design

### 1. Entry point — `frontend/src/routes/_public/players_.$slug.tsx`

Restructure `AdminControls` so it always renders for superusers:

- An **Edit** button (Pencil icon, `variant="outline"`, `size="sm"`) always shows
  and opens the new `EditPlayerDialog`.
- The existing **Delete** button keeps its current condition: only shown when the
  player has no quiz results (`history.data.length === 0`).

Today `AdminControls` returns `null` entirely when the player has history; after
this change only Delete is gated by history.

### 2. New component — `frontend/src/components/Players/EditPlayerDialog.tsx`

Follows the established `Admin/EditUser.tsx` pattern: controlled `Dialog`,
react-hook-form + zod via `zodResolver`, shadcn `Form` fields, `LoadingButton`
submit, Cancel via `DialogClose`.

Fields:

| Field | Control | Rules |
|---|---|---|
| Display name | `Input` | Required, non-empty (only required field) |
| Countries | `CountryMultiSelect` | First country is primary (★); helper text explains this |
| City | `Input` | Optional |
| Club | `Input` | Optional |
| Bio | textarea | Optional |
| Photo URL | `Input type="url"` | Optional; must be a valid URL if present |
| Slug | `Input` with `/quizzer/` prefix hint | Optional; helper text: auto-generated on creation, change only to correct errors |

Optional fields submit as `null` when cleared (empty string → `null`) so the
PATCH clears them rather than storing empty strings. Exception: an emptied
**slug** field is omitted from the PATCH entirely — the UI never clears a slug
(a slug-less player has no public URL), it only corrects one.

### 3. `CountryMultiSelect` enhancement — one-click primary

The component keeps its order-based contract (`value: string[]`, first = primary)
but changing the primary today requires removing and re-adding countries. Add a
reorder shortcut:

- Each non-primary chip gets a clickable star button (aria-label
  `Make <country> primary`) that moves that country to position 0.
- The primary chip keeps its static ★ marker.
- No new props, no form changes, no backend changes.

`CountryMultiSelect` has no other consumers after the cleanup in §5, so this is
safe to change.

### 4. Data flow

- Submit calls `PlayersService.updatePlayerRoute({ playerId, requestBody })`.
- **Success:** success toast, close dialog, invalidate `["players"]` and
  `["players", "slug", slug]`. If the slug changed, `navigate` to the new
  `/players/$newSlug` URL so the admin is not left on a dead route.
- **Error** (e.g., 409 slug conflict): `handleError` toast with the backend
  detail; dialog stays open with state intact.

### 5. Cleanup

Delete the orphaned `frontend/src/routes/_layout/admin_.players.$id.tsx` route
(nothing links to it; the dialog has full parity plus the name field).
`routeTree.gen.ts` regenerates on dev/build.

### 6. Testing

Add E2E tests to the existing "Player profile page (superuser)" block in
`frontend/tests/players.spec.ts`:

- Superuser sees the Edit button on a player profile.
- Opening the dialog, changing name and countries (including making a different
  country primary via the star), and saving updates the visible profile.
- Anonymous users see no Edit button.

Backend PATCH behavior (auth, countries replacement, primary assignment) is
already covered by `backend/tests/api/routes/test_players.py`.

## Decisions log

- **Inline dialog** on the public profile page, not a link to a separate admin
  page (user choice).
- **Primary country stays order-based** (first in list = primary); no separate
  primary field. Softened by the one-click "make primary" star (user choice).
- **All profile fields** in the dialog, including slug (user choice).
- **Retire** the orphaned `/admin/players/$id` route (user choice).
