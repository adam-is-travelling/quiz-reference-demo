import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"
import { useForm } from "react-hook-form"

import { PlayersService } from "@/client"
import type { PlayerUpdate } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"

export const Route = createFileRoute("/_layout/admin_/players/$id")({
  component: AdminPlayerEdit,
  beforeLoad: async () => {
    const { UsersService } = await import("@/client")
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Edit Player - Admin" }],
  }),
})

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function PlayerEditForm({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: player } = useSuspenseQuery({
    queryKey: ["admin", "player", id],
    queryFn: () => PlayersService.getPlayer({ playerId: id }),
  })

  const { register, handleSubmit } = useForm({
    defaultValues: {
      slug: player.slug ?? "",
      bio: player.bio ?? "",
      photo_url: player.photo_url ?? "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: PlayerUpdate) =>
      PlayersService.updatePlayerRoute({ playerId: id, requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "player", id] })
      queryClient.invalidateQueries({ queryKey: ["players"] })
      showSuccessToast("Player updated")
    },
    onError: () => showErrorToast("Failed to update player"),
  })

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 text-lg">
          <AvatarImage src={player.photo_url ?? undefined} alt={player.display_name} />
          <AvatarFallback>{getInitials(player.display_name)}</AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {player.display_name}
          </h2>
          <p className="text-muted-foreground text-sm">
            {[player.country, player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((data) => mutation.mutate(data))}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-1.5">
          <Label>URL Slug</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">/quizzer/</span>
            <Input
              {...register("slug")}
              placeholder="evan-lynch"
              className="font-mono"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Used in the player&apos;s public URL. Auto-generated on creation; change only to correct errors.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>Photo URL</Label>
          <Input
            {...register("photo_url")}
            placeholder="https://example.com/photo.jpg"
            type="url"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Bio</Label>
          <textarea
            {...register("bio")}
            rows={4}
            placeholder="Player bio…"
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <Button type="submit" disabled={mutation.isPending} className="self-start">
          {mutation.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </form>
    </div>
  )
}

function AdminPlayerEdit() {
  const { id } = Route.useParams()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Player</h1>
        <p className="text-muted-foreground">
          Update player profile details visible to the public.
        </p>
      </div>
      <Suspense fallback={<div className="animate-pulse h-64 w-full rounded bg-muted" />}>
        <PlayerEditForm id={id} />
      </Suspense>
    </div>
  )
}
