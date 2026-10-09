import { Outlet } from "@tanstack/react-router"

import { Footer } from "@/components/Common/Footer"
import { TopNav } from "@/components/Common/TopNav"

// Every page — public, dashboard and admin — shares this one shell, so the
// navigation never changes shape as you move between them.
export function SiteLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
