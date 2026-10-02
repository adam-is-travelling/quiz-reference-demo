import { Link } from "@tanstack/react-router"
import { Fragment } from "react"

interface NavItem {
  name: string
  slug: string
}

/**
 * "Part of <Series> (Previous, Next)" under the title of a quiz or event that
 * belongs to a series. Previous/Next link to the neighbouring edition and
 * are left out at the ends of the series; with neither, so are the brackets.
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
  const steps = [
    previous && { item: previous, label: "Previous", rel: "prev" },
    next && { item: next, label: "Next", rel: "next" },
  ].filter((step) => step !== null)

  return (
    <p className="text-sm text-muted-foreground" data-testid="series-nav">
      Part of{" "}
      <Link
        to={seriesTo}
        params={{ slug: series.slug }}
        className="hover:underline text-foreground"
      >
        {series.name}
      </Link>
      {steps.length > 0 && (
        <>
          {" ("}
          {steps.map((step, i) => (
            <Fragment key={step.rel}>
              {i > 0 && ", "}
              <Link
                to={itemTo}
                params={{ slug: step.item.slug }}
                rel={step.rel}
                title={step.item.name}
                className="hover:underline text-foreground"
              >
                {step.label}
              </Link>
            </Fragment>
          ))}
          {")"}
        </>
      )}
    </p>
  )
}
