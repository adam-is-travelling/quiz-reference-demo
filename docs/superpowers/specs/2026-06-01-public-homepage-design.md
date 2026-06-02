# Public Homepage Design

**Date:** 2026-06-01  
**Branch:** rearrange-links-home-page-admin

## Overview

Replace the current authenticated-only root (`/`) with a public homepage visible to all visitors. Logged-in users see the same page with the collapsible sidebar and a small greeting; guests see the public nav and a discreet admin login link.

## Goals

- Make `/` publicly accessible without requiring login
- Surface recent events and quizzers on the landing page
- Provide clear navigation links to Events, Organizations, and Quizzers pages
- Give logged-in users sidebar access from the homepage
- Offer a discreet login entry point for admins on the homepage

## Route & Layout Structure

| File | Change |
|---|---|
| `frontend/src/routes/_home.tsx` | **New** — pathless layout, no auth guard. Renders `PublicNav` + `Footer` for guests; full `SidebarProvider` + `AppSidebar` + `SidebarInset` layout (matching `_layout.tsx` structure) for logged-in users |
| `frontend/src/routes/_home/index.tsx` | **New** — homepage component at `/` |
| `frontend/src/routes/_layout/index.tsx` | **Deleted** — old authenticated dashboard, superseded by homepage |
| `frontend/src/routes/_layout.tsx` | Unchanged — still guards `/items`, `/admin`, etc. |
| `frontend/src/routes/_public.tsx` | Unchanged — used for `/events`, `/organizations`, `/quizzers` |
| `frontend/src/routes/login.tsx` | Unchanged — standalone route at `/login` |

The sidebar "Dashboard" link (`/`) continues to work as before — logged-in users land on the homepage and see the sidebar.

## Homepage Content

### Header area
- **Logged in:** Small muted greeting — `"Hi, <username>"` — at the top of the page content
- **Guest:** A brief one-line description of the site

### Navigation links
Three prominent links styled as cards or bold text links:
- Events → `/events`
- Organizations → `/organizations`
- Quizzers → `/quizzers`

### Recent content
Two side-by-side sections below the nav links:

**Recent Events** (left)
- 5 most recently added events
- Each row: event name (linked to `/events/$id`) + date

**Recent Quizzers** (right)
- 5 most recently added quizzers
- Each row: avatar + display name (linked to `/quizzer/$slug` if slug exists)

### Footer
- Standard `Footer` component
- Discreet "Admin Login" link — small, muted text — only rendered when not logged in, links to `/login`

## Data Fetching

| Data | API call | Query key |
|---|---|---|
| Recent events | `EventsService.readEvents({ skip: 0, limit: 5 })` | `["events", "recent"]` |
| Recent quizzers | `PlayersService.listPlayers({ skip: 0, limit: 5 })` | `["players", "recent"]` |

- Both endpoints are unauthenticated (already used on public pages)
- Both wrapped in `Suspense` with a simple loading fallback
- API currently returns items in insertion order (newest first); if this proves incorrect, add `order_by` to the backend at that point

## Out of Scope

- Changes to `PublicNav` (the "Log In" / "Dashboard" button on `/events` etc. stays as-is)
- Authentication changes to any route other than removing the guard on `/`
- Pagination or filtering on the homepage sections
