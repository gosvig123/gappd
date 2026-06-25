type ParsedVersion = { parts: [number, number, number]; preRelease: string | null }

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseVersion(latestVersion)
  const current = parseVersion(currentVersion)
  return Boolean(latest && current && compareVersions(latest, current) > 0)
}

export function isVersionAtLeast(version: string, minimumVersion: string): boolean {
  const parsedVersion = parseVersion(version)
  const parsedMinimum = parseVersion(minimumVersion)
  return Boolean(parsedVersion && parsedMinimum && compareVersions(parsedVersion, parsedMinimum) >= 0)
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  const core = compareVersionParts(left.parts, right.parts)
  if (core !== 0) return core
  return comparePreRelease(left.preRelease, right.preRelease)
}

function compareVersionParts(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

function comparePreRelease(left: string | null, right: string | null): number {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return comparePreReleaseParts(left.split('.'), right.split('.'))
}

function comparePreReleaseParts(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const result = comparePreReleasePart(left[index], right[index])
    if (result !== 0) return result
  }
  return 0
}

function comparePreReleasePart(left?: string, right?: string): number {
  if (!left) return right ? -1 : 0
  if (!right) return 1
  const leftNumber = numericIdentifier(left)
  const rightNumber = numericIdentifier(right)
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber)
  if (leftNumber !== null) return -1
  if (rightNumber !== null) return 1
  return left.localeCompare(right)
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], preRelease: match[4] ?? null }
}

function numericIdentifier(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null
}
