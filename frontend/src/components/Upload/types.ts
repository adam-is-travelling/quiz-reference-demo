import type { ParsedResultWithCandidates, PlayerCreate } from "@/client"

export type EventMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string
  description: string
  series_id: string
  organization_id: string
  format_questions: string
  format_rounds: string
  format_categories: string
}

export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  tiebreaker_rank: number
}

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
}

export type WizardState = {
  step: 1 | 2 | 3 | 4 | 5
  eventMeta: EventMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: Resolution[]
  eventId: string | null
}

export const INITIAL_STATE: WizardState = {
  step: 1,
  eventMeta: {
    name: "",
    start_date: "",
    end_date: "",
    organizer_name: "",
    description: "",
    series_id: "",
    organization_id: "",
    format_questions: "",
    format_rounds: "",
    format_categories: "",
  },
  rawCsv: "",
  parsedRows: [],
  columnMapping: { player_name: 0, country: 1, score: 2, tiebreaker_rank: 3 },
  parsedResults: [],
  resolutions: [],
  eventId: null,
}
