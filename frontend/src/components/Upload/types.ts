import type {
  ParsedResultWithCandidates,
  PlayerCreate,
  QuizFormatPublic,
} from "@/client"

export function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type EventMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string | null
  description: string
  series_id: string
  organization_id: string
  format_id: string
}

export function emptyEventMeta(): EventMeta {
  const t = today()
  return {
    name: "",
    start_date: t,
    end_date: t,
    organizer_name: null,
    description: "",
    series_id: "",
    organization_id: "",
    format_id: "",
  }
}

export type ColumnMapping = {
  player_name: number
  country: number
  score: number
  position: number | null
  rounds: (number | null)[]
}

export type ReviewClass = "country-mismatch" | "single-candidate" | "ambiguous"

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
  autoResolved?: boolean
  reviewClass?: ReviewClass
}

export type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5
  eventMode: "new" | "existing"
  existingEventId: string | null
  existingEventName: string | null
  submitMode: "append" | "replace"
  eventMeta: EventMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: Resolution[]
  eventId: string | null
  selectedFormat: QuizFormatPublic | null
}

export const INITIAL_STATE: WizardState = {
  step: 0,
  eventMode: "new",
  existingEventId: null,
  existingEventName: null,
  submitMode: "append",
  eventMeta: emptyEventMeta(),
  rawCsv: "",
  parsedRows: [],
  columnMapping: {
    player_name: 0,
    country: 1,
    score: 2,
    position: null,
    rounds: [],
  },
  parsedResults: [],
  resolutions: [],
  eventId: null,
  selectedFormat: null,
}
