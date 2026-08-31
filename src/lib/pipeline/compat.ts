const minimumProcessorVersion = [1, 3, 1] as const

function versionParts(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  return match ? match.slice(1).map(Number) : null
}

export function isSupportedProcessorVersion(value: string) {
  const parts = versionParts(value)
  if (!parts) return false
  for (let index = 0; index < minimumProcessorVersion.length; index += 1) {
    if (parts[index] !== minimumProcessorVersion[index]) return parts[index] > minimumProcessorVersion[index]
  }
  return true
}

export const requiredProcessorVersion = minimumProcessorVersion.join(".")
