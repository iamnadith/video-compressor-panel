"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function DashboardLiveRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh()
    }
    const interval = window.setInterval(refresh, intervalMs)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [intervalMs, router])

  return null
}
