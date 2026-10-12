import type { QuizFormatPublic } from "@/client"

/**
 * The text for a round's results-table header: its short name when the
 * format gives one, otherwise the full name. The full name always goes in
 * the header's tooltip.
 */
export function roundHeaderLabel(
  format: Pick<QuizFormatPublic, "rounds" | "round_abbreviations">,
  i: number,
): string {
  return format.round_abbreviations?.[i] ?? format.rounds?.[i] ?? ""
}
