import { Link } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import { type ReactNode, useState } from "react"

import type { PlayerResultWithQuiz } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { sortMedalResults } from "@/lib/sortMedalResults"
import { cn } from "@/lib/utils"

const PLACES = [
  { place: "first", medal: "🥇", label: "First place" },
  { place: "second", medal: "🥈", label: "Second place" },
  { place: "third", medal: "🥉", label: "Third place" },
] as const

interface PlayerFinishesProps {
  first: number
  second: number
  third: number
  /** The podium results behind the counts; when given, the table can be
   * expanded to show where each medal was won. */
  medalResults?: PlayerResultWithQuiz[]
  /** Shown beside the table on wide screens (above it on narrow ones), with
   * the table pushed to the right. */
  children?: ReactNode
}

/** A player's 1st/2nd/3rd finish counts, headed by medals. */
export function PlayerFinishes({
  first,
  second,
  third,
  medalResults = [],
  children,
}: PlayerFinishesProps) {
  const [expanded, setExpanded] = useState(false)
  const counts = { first, second, third }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {children}
        {/* The table's own container is full-width and carries the border;
            this shrinks it to the three columns. */}
        <div className="w-fit">
          <Table data-testid="player-finishes">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {PLACES.map(({ medal, label }) => (
                  <TableHead key={label} className="text-center text-xl">
                    <span role="img" aria-label={label} title={label}>
                      {medal}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-transparent">
                {PLACES.map(({ place }) => (
                  <TableCell
                    key={place}
                    data-testid={`finishes-${place}`}
                    className="px-6 text-center text-xl font-bold tabular-nums"
                  >
                    {counts[place]}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {medalResults.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-2 md:self-end"
          aria-expanded={expanded}
          aria-controls="player-medal-results"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Hide" : "Show"} all medals
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </Button>
      )}

      {expanded && (
        <ul
          id="player-medal-results"
          data-testid="player-medal-results"
          className="flex flex-col gap-1.5 px-2 md:self-end"
        >
          {sortMedalResults(medalResults).map((result) => (
            <MedalResultItem key={result.result_id} result={result} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MedalResultItem({ result }: { result: PlayerResultWithQuiz }) {
  const place = PLACES[(result.final_rank ?? 1) - 1]
  // "World Quizzing Championships 2026, World Quizzing Championships" says
  // the competition twice; name it only when the quiz name doesn't.
  const competition = result.competition_name
  const showCompetition =
    !!competition &&
    !result.quiz_name.toLowerCase().includes(competition.toLowerCase())
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <span role="img" aria-label={place.label} title={place.label}>
        {place.medal}
      </span>
      <span>
        {result.quiz_slug ? (
          <Link
            to="/quizzes/$slug"
            params={{ slug: result.quiz_slug }}
            className="font-medium hover:underline"
          >
            {result.quiz_name}
          </Link>
        ) : (
          <span className="font-medium">{result.quiz_name}</span>
        )}
        {showCompetition && (
          <>
            {", "}
            {result.competition_slug ? (
              <Link
                to="/competitions/$slug"
                params={{ slug: result.competition_slug }}
                className="hover:underline"
              >
                {result.competition_name}
              </Link>
            ) : (
              result.competition_name
            )}
          </>
        )}
      </span>
    </li>
  )
}
