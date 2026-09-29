import { Link } from "@tanstack/react-router"

import type { QuizPodium } from "@/client"
import { PlayerLinks } from "@/components/Common/PlayerLinks"
import { QualifierSuffix } from "@/components/Quizzes/QualifierSuffix"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SeriesMatrix as SeriesMatrixData } from "@/lib/seriesMatrix"

function HeldQuiz({ quiz }: { quiz: QuizPodium }) {
  const winners = quiz.finishers.filter((f) => f.place === 1)
  return (
    <div className="flex flex-col">
      {quiz.quiz_slug ? (
        <Link
          to="/quizzes/$slug"
          params={{ slug: quiz.quiz_slug }}
          className="text-xs text-muted-foreground hover:underline"
        >
          {quiz.quiz_name}
          {quiz.is_qualifier && <QualifierSuffix />}
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">
          {quiz.quiz_name}
          {quiz.is_qualifier && <QualifierSuffix />}
        </span>
      )}
      {winners.length === 0 ? (
        <span className="text-muted-foreground">No result yet</span>
      ) : (
        winners.map((f) =>
          f.team_name ? (
            <span key={f.team_name} className="font-medium">
              {f.team_name}
            </span>
          ) : (
            <PlayerLinks
              key={(f.participants ?? []).map((p) => p.player_id).join("-")}
              players={f.participants ?? []}
            />
          ),
        )
      )}
    </div>
  )
}

export function SeriesMatrix({ matrix }: { matrix: SeriesMatrixData }) {
  if (matrix.rows.length === 0) {
    return (
      <p className="text-muted-foreground">
        No quizzes held at these events yet.
      </p>
    )
  }
  return (
    <div
      className="rounded-md border overflow-x-auto"
      data-testid="series-matrix"
    >
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Quiz</TableHead>
            {matrix.columns.map((c) => (
              <TableHead key={c.eventId}>
                <Link
                  to="/events/$slug"
                  params={{ slug: c.eventSlug }}
                  className="hover:underline"
                  title={c.eventName}
                >
                  {c.year}
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.rows.map((row) => (
            <TableRow
              key={row.key}
              data-testid={`series-matrix-row-${row.key}`}
            >
              <TableCell className="font-medium whitespace-nowrap align-top">
                {row.seriesSlug ? (
                  <Link
                    to="/competitions/$slug"
                    params={{ slug: row.seriesSlug }}
                    className="hover:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  row.label
                )}
              </TableCell>
              {row.cells.map((quizzes, i) => (
                <TableCell
                  key={matrix.columns[i].eventId}
                  className="align-top"
                >
                  {quizzes.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {quizzes.map((q) => (
                        <HeldQuiz key={q.quiz_id} quiz={q} />
                      ))}
                    </div>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
