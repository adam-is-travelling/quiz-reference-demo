import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { QuizPublic } from "@/client"

export const eventColumns: ColumnDef<QuizPublic>[] = [
  {
    accessorKey: "name",
    header: "Quiz",
    cell: ({ row }) => (
      <Link
        to="/quizzes/$id"
        params={{ id: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "start_date",
    header: "Date",
    cell: ({ row }) => {
      const { start_date, end_date } = row.original
      return start_date === end_date
        ? start_date
        : `${start_date} – ${end_date}`
    },
  },
  {
    accessorKey: "organizer_name",
    header: "Organiser",
    cell: ({ getValue }) => getValue<string | null>() ?? "—",
  },
]
