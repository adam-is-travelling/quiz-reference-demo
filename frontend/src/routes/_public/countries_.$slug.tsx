import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"

import { CountriesService } from "@/client"
import { CountryProfile } from "@/components/Countries/CountryProfile"

export const Route = createFileRoute("/_public/countries_/$slug")({
  component: CountryPage,
  head: () => ({ meta: [{ title: "Country" }] }),
})

function CountryPage() {
  const { slug } = Route.useParams()
  const query = useQuery({
    queryKey: ["countries", slug],
    queryFn: () => CountriesService.readCountry({ slug }),
    retry: false,
  })

  if (query.isPending) {
    return <p className="text-muted-foreground">Loading…</p>
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">Country not found.</p>
        <Link
          to="/players"
          search={{ page: 1 }}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to players
        </Link>
      </div>
    )
  }

  return <CountryProfile country={query.data} />
}
