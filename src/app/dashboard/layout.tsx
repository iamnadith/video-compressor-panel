import { AppSidebar } from "@/components/app-sidebar"
import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { requireUser } from "@/lib/auth"

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  return (
    <SidebarProvider>
      <AppSidebar email={user.email ?? "Administrator"} />
      <SidebarInset>
        <DashboardLiveRefresh />
        <header className="flex h-14 shrink-0 items-center gap-3 px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">Distributed video pipeline</span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 pt-2 md:p-6 md:pt-3">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
