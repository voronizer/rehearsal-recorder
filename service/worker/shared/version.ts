/**
 * The lowest РЭХА the service takes. The service only ever adds fields, so
 * this goes up only when a change cannot work with an older РЭХА.
 */
export const MIN_REHA_VERSION = "0.0.0"

/**
 * Whether a РЭХА that says it is `version` is too old. Versions compare by
 * their leading X.Y.Z, so 0.17.1.dev4+gabc (a clone between releases) counts
 * as 0.17.1; one with no X.Y.Z, such as "unknown" (a clone never installed),
 * is never too old. No version at all is.
 */
export function tooOld(version: string | undefined, min: string): boolean {
  if (!version) return true
  const have = release(version)
  if (!have) return false
  const need = release(min) ?? [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] < need[i]
  }
  return false
}

function release(version: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
