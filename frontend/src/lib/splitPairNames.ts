/**
 * Split a result's name cell into its individual quizzers.
 *
 * Separators are `&` (with or without surrounding whitespace) and the
 * standalone word `and`. The whitespace requirement around `and` is what
 * keeps names like "Alexander" and "Sandy" intact — only a free-standing
 * "and" separates two people.
 */
export const PAIR_SEPARATOR_PATTERN = /\s*&\s*|\s+and\s+/gi

export function splitPairNames(cell: string): string[] {
  return cell
    .split(PAIR_SEPARATOR_PATTERN)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0)
}

export const HAS_PAIR_SEPARATOR = /\s*&\s*|\s+and\s+/i
