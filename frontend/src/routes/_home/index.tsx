import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { EventsService, PlayersService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import { Labels } from "@/test-ids"

function getRecentEventsQueryOptions() {
  return {
    queryFn: () => EventsService.readEvents({ skip: 0, limit: 5 }),
    queryKey: ["events", "recent"],
  }
}

function getRecentPlayersQueryOptions() {
  return {
    queryFn: () => PlayersService.listPlayers({ skip: 0, limit: 5 }),
    queryKey: ["players", "recent"],
  }
}

export const Route = createFileRoute("/_home/")({
  component: HomePage,
  head: () => ({ meta: [{ title: "Home" }] }),
})

function RecentEvents() {
  const { data } = useSuspenseQuery(getRecentEventsQueryOptions())

  return (
    <div data-testid={Labels.homeRecentEvents}>
      <h2 className="text-lg font-semibold mb-3">Recent Events</h2>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet</p>
      ) : (
        <ul className="space-y-2">
          {data.data.map((event) => (
            <li key={event.id} className="flex items-baseline gap-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Link
                to={"/events/$id" as any}
                params={{ id: event.id } as any}
                className="text-sm hover:underline"
              >
                {event.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {event.start_date}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentQuizzers() {
  const { data } = useSuspenseQuery(getRecentPlayersQueryOptions())

  return (
    <div data-testid={Labels.homeRecentQuizzers}>
      <h2 className="text-lg font-semibold mb-3">Recent Quizzers</h2>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quizzers yet</p>
      ) : (
        <ul className="space-y-2">
          {data.data.map((player) => {
            const row = (
              <span className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  {player.photo_url && <AvatarImage src={player.photo_url} />}
                  <AvatarFallback className="text-xs">
                    {player.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm">{player.display_name}</span>
              </span>
            )

            return (
              <li key={player.id}>
                {player.slug ? (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <Link
                    to={"/quizzer/$slug" as any}
                    params={{ slug: player.slug } as any}
                    className="hover:underline"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function HomePage() {
  const { user } = useAuth()
  const loggedIn = isLoggedIn()

  return (
    <div className="flex flex-col gap-8">
      {loggedIn && user && (
        <p
          className="text-sm text-muted-foreground"
          data-testid={Labels.homeGreeting}
        >
          Hi, {user.full_name || user.email}
        </p>
      )}
      {!loggedIn && (
        <p className="text-sm text-muted-foreground">
          Quiz competition results, players, and events.
        </p>
      )}

      <nav className="flex gap-6">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/events" as any} className="text-sm font-medium hover:underline">
          Events
        </Link>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/organizations" as any} className="text-sm font-medium hover:underline">
          Organizations
        </Link>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/quizzers" as any} className="text-sm font-medium hover:underline">
          Quizzers
        </Link>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
        >
          <RecentEvents />
        </Suspense>
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
        >
          <RecentQuizzers />
        </Suspense>
      </div>

      {!loggedIn && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Link
            to="/login"
            className="hover:underline"
            data-testid={Labels.homeAdminLoginLink}
          >
            Admin Login
          </Link>
        </p>
      )}
    </div>
  )
}
