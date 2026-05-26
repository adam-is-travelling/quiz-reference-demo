import { createFileRoute, Outlet } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import { PublicNav } from "@/components/Common/PublicNav"

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
})

function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicNav />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
