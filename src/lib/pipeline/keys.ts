import path from "node:path"

function relativeKey(key: string, prefix: string) {
  const normalized = `${prefix.replace(/\/$/, "")}/`
  return key.startsWith(normalized) ? key.slice(normalized.length) : key
}

export function outputKey(sourceKey: string, ingestPrefix: string, processedPrefix: string) {
  const relative = relativeKey(sourceKey, ingestPrefix)
  const extension = path.posix.extname(relative)
  const stem = extension ? relative.slice(0, -extension.length) : relative
  return `${processedPrefix.replace(/\/$/, "")}/${stem}.mp4`
}
