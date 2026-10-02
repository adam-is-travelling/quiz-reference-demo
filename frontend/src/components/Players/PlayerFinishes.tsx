import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PLACES = [
  { place: "first", medal: "🥇", label: "First place" },
  { place: "second", medal: "🥈", label: "Second place" },
  { place: "third", medal: "🥉", label: "Third place" },
] as const

interface PlayerFinishesProps {
  first: number
  second: number
  third: number
}

/** A player's 1st/2nd/3rd finish counts, headed by medals. */
export function PlayerFinishes({ first, second, third }: PlayerFinishesProps) {
  const counts = { first, second, third }
  return (
    // The table's own container is full-width and carries the border; this
    // shrinks it to the three columns.
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
  )
}
