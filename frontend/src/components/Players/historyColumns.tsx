import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { PlayerResultWithQuiz } from "@/client"
import { Badge } from "@/components/ui/badge"
import { countryName, teamLabel } from "@/lib/countries"

export const historyColumns: ColumnDef<PlayerResultWithQuiz>[] = [
  {
    accessorKey: "quiz_name",
    header: "Quiz",
    cell: ({ row }) => {
      const result = row.original
      return (
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
          {result.team_name ? (
            <span className="text-muted-foreground text-xs">
              {" "}
              for {result.team_name}
              {result.team_country || result.team_type === "national"
                ? ` (${teamLabel(result)})`
                : ""}
            </span>
          ) : (
            (result.partners ?? []).length > 0 && (
              <span className="text-muted-foreground text-xs">
                {" "}
                with{" "}
                {(result.partners ?? []).map((p) => p.display_name).join(" & ")}
              </span>
            )
          )}
        </span>
      )
    },
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => row.original.start_date,
  },
  {
    accessorKey: "country",
    header: "Country",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {countryName(row.original.country) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.score}</span>
    ),
  },
  {
    accessorKey: "final_rank",
    header: "Rank",
    cell: ({ row }) => {
      const rank = row.original.final_rank
      if (!rank) return <span className="text-muted-foreground">—</span>
      if (rank === 1) return <Badge>1st</Badge>
      if (rank === 2) return <Badge variant="secondary">2nd</Badge>
      if (rank === 3) return <Badge variant="secondary">3rd</Badge>
      return <span className="text-muted-foreground">{rank}</span>
    },
  },
]
