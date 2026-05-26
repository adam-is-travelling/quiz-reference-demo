import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Building2 } from "lucide-react"
import { Suspense } from "react"

import { OrganizationsService } from "@/client"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function getOrgsQueryOptions() {
  return {
    queryFn: () =>
      OrganizationsService.readOrganizations({ skip: 0, limit: 100 }),
    queryKey: ["organizations"],
  }
}

export const Route = createFileRoute("/_public/organizations")({
  component: OrganizationsPage,
  head: () => ({ meta: [{ title: "Organizations" }] }),
})

function OrgsContent() {
  const { data: orgs } = useSuspenseQuery(getOrgsQueryOptions())

  if (orgs.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No organizations yet</h3>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {orgs.data.map((org) => (
        <Link key={org.id} to="/organizations/$id" params={{ id: org.id }}>
          <Card className="hover:border-foreground/20 transition-colors">
            <CardHeader>
              <CardTitle className="text-base">{org.name}</CardTitle>
              {org.description && (
                <CardDescription className="line-clamp-2">
                  {org.description}
                </CardDescription>
              )}
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  )
}

function OrganizationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
        <p className="text-muted-foreground">
          Quiz governing bodies and associations
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <OrgsContent />
      </Suspense>
    </div>
  )
}
