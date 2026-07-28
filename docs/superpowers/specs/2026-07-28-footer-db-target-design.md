# Admin footer database-target line

**Date:** 2026-07-28
**Status:** Approved (pending spec review)

## Goal

Show admin (superuser) users a small muted line in the footer stating which database the app
is currently pointed at (`dev` or `staging`), so they can tell at a glance. Non-admin and
anonymous users see the footer unchanged.

## Scope

- Surfaces the existing `settings.DB_TARGET` (from the dev/staging toggle feature).
- Reuses the current-user (`GET /users/me`) payload the app already fetches — no new endpoint.
- No new DB tables or migrations.

## Design

### Backend

- Add a response model in `backend/app/models.py`:

  ```python
  class UserMePublic(UserPublic):
      db_target: str | None = None
  ```

- Change **only** the `GET /users/me` route (`backend/app/api/routes/users.py:123`) to use
  `response_model=UserMePublic`, and build the response explicitly, populating `db_target`
  **only for superusers**:

  ```python
  @router.get("/me", response_model=UserMePublic)
  def read_user_me(current_user: CurrentUser) -> Any:
      """
      Get current user.
      """
      user_public = UserPublic.model_validate(current_user)
      return UserMePublic(
          **user_public.model_dump(),
          db_target=settings.DB_TARGET if current_user.is_superuser else None,
      )
  ```

  Narrowing through `UserPublic` first drops `hashed_password` so it can never leak into the
  response. `settings` is already imported in `users.py` (`from app.core.config import
  settings`).

- `UserPublic` and every other user response (`PATCH /me`, user lists, `GET /{user_id}`, etc.)
  are untouched — `db_target` exists only on the `/users/me` GET response, and is `null` for
  non-superusers. So the value is access-controlled at the API, not just hidden in the UI.

### Frontend

- Regenerate the typed client (`readUserMe` response gains `db_target: string | null`).
- `frontend/src/components/Common/Footer.tsx` calls `useAuth()`. When
  `user?.is_superuser && user.db_target`, render a small muted line alongside the existing
  footer text, e.g. `Database: staging`, styled plainly (muted, same scale as the existing
  footer copyright text — no color emphasis). Otherwise render the footer exactly as today.
- The footer is shared by the public and authed layouts; a logged-in superuser sees the line
  wherever the footer appears, anonymous/non-admin users never do.

### Display

- Text: `Database: <db_target>` (e.g. `Database: dev`). Plain muted styling
  (`text-muted-foreground text-sm`), consistent with the existing footer text.

## Tests

- **Backend** (`backend/tests/api/routes/test_users.py`):
  - `GET /users/me` as the superuser returns `db_target` equal to `settings.DB_TARGET`.
  - `GET /users/me` as a normal (non-superuser) user returns `db_target` = `null`.
- **Frontend E2E** (extend an existing footer/auth spec, or add one):
  - Logged in as the superuser, the footer shows the `Database:` line.
  - Logged out (public page), the footer does not show it.

## Out of scope

- Any new endpoint (reusing `/users/me`).
- Color/emphasis styling for non-dev targets (plain muted only).
- Exposing the target to non-admin or anonymous users.
- New DB tables or migrations.
