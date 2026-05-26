import { Link } from "@tanstack/react-router"

import { Logo } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"
import { isLoggedIn } from "@/hooks/useAuth"

export function PublicNav() {
  return (
    <nav className="border-b bg-background">
      <div className="container mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link to={"/events" as any}>
            <Logo asLink={false} />
          </Link>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Link
            to={"/events" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Events
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
            to={"/quizzers" as any}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Quizzers
          </Link>
        </div>
        <Button asChild variant="outline" size="sm">
          {isLoggedIn() ? (
            <Link to="/">Dashboard</Link>
          ) : (
            <Link to="/login">Log In</Link>
          )}
        </Button>
      </div>
    </nav>
  )
}
