import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Suspense } from "react"

import { PlayersService, QuizzesService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import { Labels } from "@/test-ids"

function getRecentQuizzesQueryOptions() {
  return {
    queryFn: () => QuizzesService.readQuizzes({ skip: 0, limit: 5 }),
    queryKey: ["quizzes", "recent"],
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

function RecentQuizzes() {
  const { data } = useSuspenseQuery(getRecentQuizzesQueryOptions())

  return (
    <div data-testid={Labels.homeRecentQuizzes}>
      <h2 className="text-lg font-semibold mb-3">Recent Quizzes</h2>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quizzes yet</p>
      ) : (
        <ul className="space-y-2">
          {data.data.map((quiz) => (
            <li key={quiz.id} className="flex items-baseline gap-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Link
                to={"/quizzes/$id" as any}
                params={{ id: quiz.id } as any}
                className="text-sm hover:underline"
              >
                {quiz.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {quiz.start_date}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentPlayers() {
  const { data } = useSuspenseQuery(getRecentPlayersQueryOptions())

  return (
    <div data-testid={Labels.homeRecentPlayers}>
      <h2 className="text-lg font-semibold mb-3">Recent Players</h2>
      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No players yet</p>
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
                    to={"/players/$slug" as any}
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
          Quiz competition results, players, and quizzes.
        </p>
      )}

      <nav className="flex gap-6">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link
          to={"/quizzes" as any}
          className="text-sm font-medium hover:underline"
        >
          Quizzes
        </Link>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link
          to={"/organizations" as any}
          className="text-sm font-medium hover:underline"
        >
          Organizations
        </Link>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link
          to={"/players" as any}
          className="text-sm font-medium hover:underline"
        >
          Players
        </Link>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
        >
          <RecentQuizzes />
        </Suspense>
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
        >
          <RecentPlayers />
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
