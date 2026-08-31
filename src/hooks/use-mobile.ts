import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
  return React.useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", onStoreChange)
      return () => media.removeEventListener("change", onStoreChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
