import { Link } from "@tanstack/react-router"

export interface LinkablePlayer {
  player_id: string
  player_display_name: string
  player_slug?: string | null
}

/** Renders one or more players as links, joined by " & ". */
export function PlayerLinks({ players }: { players: LinkablePlayer[] }) {
  if (players.length === 0)
    return <span className="text-muted-foreground">—</span>
  return (
    <span className="font-medium">
      {players.map((p, i) => (
        <span key={p.player_id}>
          {i > 0 && <span className="text-muted-foreground"> & </span>}
          {p.player_slug ? (
            <Link
              to={"/players/$slug" as any}
              params={{ slug: p.player_slug } as any}
              className="hover:underline"
            >
              {p.player_display_name}
            </Link>
          ) : (
            <span>{p.player_display_name}</span>
          )}
        </span>
      ))}
    </span>
  )
}
