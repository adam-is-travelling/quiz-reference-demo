import { Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"

import type { QuizEventPublic } from "@/client"

export const eventColumns: ColumnDef<QuizEventPublic>[] = [
  {
    accessorKey: "name",
    header: "Event",
    cell: ({ row }) => (
      <Link
        to="/events/$id"
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
  },
]
