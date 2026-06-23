import {
  Building2,
  ClipboardCheck,
  ClipboardList,
  Home,
  LayoutList,
  Users,
} from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User } from "./User"

const baseItems: Item[] = [{ icon: Home, title: "Dashboard", path: "/" }]

export function AppSidebar() {
  const { user: currentUser } = useAuth()

  const items: Item[] = [...baseItems]

  if (currentUser?.is_superuser || currentUser?.is_organizer) {
    items.push({
      icon: ClipboardList,
      title: "Upload Results",
      path: "/upload",
    })
  }

  if (currentUser?.is_superuser) {
    items.push(
      { icon: ClipboardCheck, title: "Review Quizzes", path: "/admin/quizzes" },
      { icon: LayoutList, title: "Formats", path: "/admin/formats" },
      { icon: Building2, title: "Organizations", path: "/admin/organizations" },
      { icon: Users, title: "Admin", path: "/admin" },
    )
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
