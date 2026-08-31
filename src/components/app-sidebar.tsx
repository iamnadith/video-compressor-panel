"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  BoxesIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  Settings2Icon,
  UserCircleIcon,
  UsersIcon,
} from "lucide-react"

import { logoutAction } from "@/app/login/actions"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/dashboard/jobs", label: "Jobs", icon: BoxesIcon },
  { href: "/dashboard/workers", label: "Workers", icon: UsersIcon },
  { href: "/dashboard/storage", label: "Storage", icon: DatabaseIcon },
  { href: "/dashboard/activity", label: "Activity", icon: ActivityIcon },
  { href: "/dashboard/settings", label: "Settings", icon: Settings2Icon },
  { href: "/dashboard/account", label: "Account", icon: UserCircleIcon },
]

export function AppSidebar({ email }: { email: string }) {
  const pathname = usePathname()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />} tooltip="Transcode">
              <BoxesIcon />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">Transcode</span>
                <span className="truncate text-xs text-muted-foreground">Control plane</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname === item.href}
                    tooltip={item.label}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-2">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <div className="flex min-w-0 flex-col px-2 group-data-[collapsible=icon]:hidden">
          <span className="truncate text-xs text-muted-foreground">Signed in as</span>
          <span className="truncate text-sm">{email}</span>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" className="w-full justify-start">
            <LogOutIcon data-icon="inline-start" />
            <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
          </Button>
        </form>
      </SidebarFooter>
    </Sidebar>
  )
}
