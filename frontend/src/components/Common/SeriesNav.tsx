import { Link } from "@tanstack/react-router"

interface NavItem {
  name: string
  slug: string
}

/**
 * "← previous · Series · next →" above a quiz or event that belongs to a
 * series. The ends of a series simply omit the missing side.
 */
export function SeriesNav({
  series,
  seriesTo,
  itemTo,
  previous,
  next,
}: {
  series: NavItem
  seriesTo: "/competitions/$slug" | "/events/recurring/$slug"
  itemTo: "/quizzes/$slug" | "/events/$slug"
  previous: NavItem | null
  next: NavItem | null
}) {
  return (
    <nav
      aria-label={`${series.name} editions`}
      className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
      data-testid="series-nav"
    >
      {previous && (
        <>
          <Link
            to={itemTo}
            params={{ slug: previous.slug }}
            rel="prev"
            className="hover:underline hover:text-foreground"
          >
            ← {previous.name}
          </Link>
          <span aria-hidden="true">·</span>
        </>
      )}
      <Link
        to={seriesTo}
        params={{ slug: series.slug }}
        className="font-medium text-foreground hover:underline"
      >
        {series.name}
      </Link>
      {next && (
        <>
          <span aria-hidden="true">·</span>
          <Link
            to={itemTo}
            params={{ slug: next.slug }}
            rel="next"
            className="hover:underline hover:text-foreground"
          >
            {next.name} →
          </Link>
        </>
      )}
    </nav>
  )
}
