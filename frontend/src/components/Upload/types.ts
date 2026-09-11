import type {
  ParsedResultWithCandidates,
  PlayerCreate,
  QuizFormatPublic,
} from "@/client"
import type { RowResolution } from "@/lib/matchPlayers"

export function today(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type ParticipantMode = "individual" | "pairs" | "teams"

export type QuizMeta = {
  name: string
  start_date: string
  end_date: string
  organizer_name: string | null
  description: string
  competition_id: string
  organization_id: string
  event_id: string
  format_id: string
  participant_mode: ParticipantMode
}

export function emptyQuizMeta(): QuizMeta {
  const t = today()
  return {
    name: "",
    start_date: t,
    end_date: t,
    organizer_name: null,
    description: "",
    competition_id: "",
    organization_id: "",
    event_id: "",
    format_id: "",
    participant_mode: "individual",
  }
}

export type ColumnMapping = {
  player_name: number
  country: number | null
  score: number
  position: number | null
  rounds: (number | null)[]
  player_name_2: number | null
  pairsLayout: "combined" | "two-columns"
  team_name: number | null
  lineupLayout: "combined" | "numbered-columns"
  lineup_combined: number | null
  lineup_columns: number[]
}

export type ReviewClass = "country-mismatch" | "single-candidate" | "ambiguous"

/**
 * The type and country chosen for one team name in this file.
 *
 * `is_international` is wizard-only state and is never sent to the API — the
 * backend infers an international side from a national team with a null
 * country. It exists here because "no country chosen yet" and "deliberately
 * has no country" look identical in `team_country` alone, and the checkbox
 * has to know which one it is looking at.
 */
export type TeamDetails = {
  team_type: "national" | "club"
  team_country: string | null
  is_international: boolean
}

export type Resolution = {
  player_id: string | null
  player_create: PlayerCreate | null
  autoResolved?: boolean
  reviewClass?: ReviewClass
}

export type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5
  quizMode: "new" | "existing"
  existingQuizId: string | null
  existingQuizName: string | null
  submitMode: "append" | "replace"
  quizMeta: QuizMeta
  rawCsv: string
  parsedRows: string[][]
  columnMapping: ColumnMapping
  parsedResults: ParsedResultWithCandidates[]
  resolutions: RowResolution[]
  quizId: string | null
  selectedFormat: QuizFormatPublic | null
  participantMode: ParticipantMode
  defaultTeamType: "national" | "club"
  teamsByName: Record<string, TeamDetails>
}

export const INITIAL_STATE: WizardState = {
  step: 0,
  quizMode: "new",
  existingQuizId: null,
  existingQuizName: null,
  submitMode: "append",
  quizMeta: emptyQuizMeta(),
  rawCsv: "",
  parsedRows: [],
  columnMapping: {
    player_name: 0,
    country: 1,
    score: 2,
    position: null,
    rounds: [],
    player_name_2: null,
    pairsLayout: "combined",
    team_name: null,
    lineupLayout: "combined",
    lineup_combined: null,
    lineup_columns: [],
  },
  parsedResults: [],
  resolutions: [],
  quizId: null,
  selectedFormat: null,
  participantMode: "individual",
  defaultTeamType: "national",
  teamsByName: {},
}
