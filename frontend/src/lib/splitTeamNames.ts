/**
 * Split a team's lineup cell into its individual quizzers.
 *
 * Separators are `&`, a standalone `and`, and `,`. The comma is what
 * separates this from the pairs splitter: adding it to
 * PAIR_SEPARATOR_PATTERN would silently change how existing pairs uploads
 * parse a cell, so teams get their own pattern instead.
 *
 * The whitespace requirement around `and` is what keeps "Alexander" and
 * "Sandy" intact — only a free-standing "and" separates two people.
 */
export const TEAM_SEPARATOR_PATTERN = /\s*&\s*|\s+and\s+|\s*,\s*/gi

/** Deliberately unflagged with `g`: a global regex's `.test()` is stateful. */
export const HAS_TEAM_SEPARATOR = /\s*&\s*|\s+and\s+|\s*,\s*/i

export function splitTeamNames(cell: string): string[] {
  return cell
    .split(TEAM_SEPARATOR_PATTERN)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0)
}
