import { Badge } from "@/components/ui/badge"

const destructive = new Set(["failed", "offline", "disabled", "error"])
const defaultStates = new Set(["completed", "online", "busy", "processing", "uploading"])

export function StatusBadge({ state }: { state: string }) {
  const variant = destructive.has(state)
    ? "destructive"
    : defaultStates.has(state)
      ? "default"
      : state === "queued" || state === "idle" || state === "claimed"
        ? "secondary"
        : "outline"
  return <Badge variant={variant}>{state.replaceAll("_", " ")}</Badge>
}

