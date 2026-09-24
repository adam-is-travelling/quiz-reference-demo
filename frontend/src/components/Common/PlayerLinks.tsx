import { Link } from "@tanstack/react-router"

export interface LinkablePlayer {
  player_id: string
  player_display_name: string
  player_slug?: string | null
}

function PlayerName({ player }: { player: LinkablePlayer }) {
  if (!player.player_slug) return <span>{player.player_display_name}</span>
  return (
    <Link
      to={"/players/$slug" as any}
      params={{ slug: player.player_slug } as any}
      className="hover:underline"
    >
      {player.player_display_name}
    </Link>
  )
}

/**
 * Renders one or more players as links.
 *
 * Inline by default — joined by " & ", which is how a pair reads in a table
 * row or on a podium. An inline team squad asks for `team` and is joined by
 * commas instead. A squad of eight does not read well inline at all, so the
 * team panel asks for `stacked` and gets one name per line.
 */
export function PlayerLinks({
  players,
  stacked = false,
  team = false,
}: {
  players: LinkablePlayer[]
  stacked?: boolean
  team?: boolean
}) {
  if (players.length === 0)
    return <span className="text-muted-foreground">—</span>

  if (stacked) {
    return (
      <ul className="font-medium flex flex-col gap-1">
        {players.map((p) => (
          <li key={p.player_id}>
            <PlayerName player={p} />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <span className="font-medium">
      {players.map((p, i) => (
        <span key={p.player_id}>
          {i > 0 &&
            (team ? ", " : <span className="text-muted-foreground"> & </span>)}
          <PlayerName player={p} />
        </span>
      ))}
    </span>
  )
}
