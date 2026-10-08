import { Link } from "@tanstack/react-router"

import { Logo } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

export function PublicNav() {
  const { user } = useAuth()

  return (
    <nav className="border-b bg-background" data-testid="public-nav">
      <div className="container mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 md:h-16 md:flex-nowrap md:py-0">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Link to={"/quizzes" as any} className="shrink-0">
          <Logo asLink={false} />
        </Link>
        {/* On narrow screens the links take a row of their own below the
            logo, scrolling sideways if they still don't fit, rather than
            widening the whole page. */}
        <div className="order-last flex w-full min-w-0 items-center gap-6 overflow-x-auto md:order-none md:w-auto md:flex-1 [&>a]:shrink-0">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/quizzes" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Quizzes
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/organizations" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Organizations
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/competitions" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Competitions
          </Link>
          <Link
            to="/events"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Events
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/players" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Players
          </Link>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          {isLoggedIn() ? (
            <Link to="/">
              {user?.is_superuser ? "Admin Dashboard" : "Dashboard"}
            </Link>
          ) : (
            <Link to="/login">Log In</Link>
          )}
        </Button>
      </div>
    </nav>
  )
}
