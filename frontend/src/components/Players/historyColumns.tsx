import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { PlayerResultWithQuiz } from "@/client"
import { Badge } from "@/components/ui/badge"
import { countryName } from "@/lib/countries"

export const historyColumns: ColumnDef<PlayerResultWithQuiz>[] = [
  {
    accessorKey: "quiz_name",
    header: "Quiz",
    cell: ({ row }) => (
      <Link
        to="/quizzes/$slug"
        params={{ slug: row.original.quiz_slug ?? "" }}
        className="font-medium hover:underline"
      >
        {row.original.quiz_name}
      </Link>
    ),
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
