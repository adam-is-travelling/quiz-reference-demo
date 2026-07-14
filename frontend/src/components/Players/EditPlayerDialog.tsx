import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { type PlayerPublic, PlayersService } from "@/client"
import { Button } from "@/components/ui/button"
import { CountryMultiSelect } from "@/components/ui/CountryMultiSelect"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const formSchema = z.object({
  display_name: z.string().min(1, { message: "Name is required" }),
  slug: z.string().min(1, { message: "Slug is required" }),
  countries: z.array(z.string()),
  city: z.string(),
  club: z.string(),
  bio: z.string(),
  photo_url: z.union([
    z.url({ message: "Must be a valid URL" }),
    z.literal(""),
  ]),
})

type FormData = z.infer<typeof formSchema>

function playerFormValues(player: PlayerPublic): FormData {
  return {
    display_name: player.display_name,
    slug: player.slug ?? "",
    countries: player.countries ?? [],
    city: player.city ?? "",
    club: player.club ?? "",
    bio: player.bio ?? "",
    photo_url: player.photo_url ?? "",
  }
}

interface EditPlayerDialogProps {
  player: PlayerPublic
}

export function EditPlayerDialog({ player }: EditPlayerDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: playerFormValues(player),
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      PlayersService.updatePlayerRoute({
        playerId: player.id,
        requestBody: {
          display_name: data.display_name,
          slug: data.slug,
          countries: data.countries,
          city: data.city || null,
          club: data.club || null,
          bio: data.bio || null,
          photo_url: data.photo_url || null,
        },
      }),
    onSuccess: (updated) => {
      showSuccessToast("Player updated")
      setIsOpen(false)
      queryClient.invalidateQueries({ queryKey: ["players"] })
      if (updated.slug && updated.slug !== player.slug) {
        navigate({ to: "/players/$slug", params: { slug: updated.slug } })
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const openDialog = () => {
    form.reset(playerFormValues(player))
    setIsOpen(true)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Pencil className="h-4 w-4 mr-1" />
        Edit
      </Button>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
            <DialogHeader>
              <DialogTitle>Edit Player</DialogTitle>
              <DialogDescription>
                Update player profile details visible to the public.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Display Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Display name"
                        type="text"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-1.5">
                <FormLabel>Countries</FormLabel>
                <Controller
                  name="countries"
                  control={form.control}
                  render={({ field }) => (
                    <CountryMultiSelect
                      value={field.value ?? []}
                      onChange={field.onChange}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  The starred country is the player&apos;s primary country.
                </p>
              </div>

              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="City" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="club"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Club</FormLabel>
                    <FormControl>
                      <Input placeholder="Club" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bio</FormLabel>
                    <FormControl>
                      <textarea
                        {...field}
                        rows={4}
                        placeholder="Player bio…"
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="photo_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://example.com/photo.jpg"
                        type="url"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      URL Slug <span className="text-destructive">*</span>
                    </FormLabel>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">
                        /quizzer/
                      </span>
                      <FormControl>
                        <Input
                          placeholder="evan-lynch"
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Used in the player&apos;s public URL. Auto-generated on
                      creation; change only to correct errors.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button
                  variant="outline"
                  type="button"
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton type="submit" loading={mutation.isPending}>
                Save
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
