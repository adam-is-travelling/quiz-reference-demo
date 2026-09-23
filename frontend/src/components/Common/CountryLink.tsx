import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { countryName, countrySlug, teamLabel } from "@/lib/countries"

/**
 * A country's name, linked to its page. An unknown or missing code renders
 * as plain text — the same text countryName would have shown.
 */
export function CountryLink({
  code,
  className = "hover:underline",
  children,
}: {
  code: string | null | undefined
  className?: string
  children?: ReactNode
}) {
  const slug = countrySlug(code)
  const label = children ?? countryName(code)
  if (!slug) return <>{label}</>
  return (
    <Link to="/countries/$slug" params={{ slug }} className={className}>
      {label}
    </Link>
  )
}

/**
 * teamLabel, with a national team's country linked to its page. Club teams
 * and international sides keep their plain label: only national teams
 * represent a country.
 */
export function TeamAffiliation({
  result,
}: {
  result: { team_type?: string | null; team_country?: string | null }
}) {
  if (result.team_type === "national" && result.team_country) {
    return <CountryLink code={result.team_country} />
  }
  return <>{teamLabel(result)}</>
}
