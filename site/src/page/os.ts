/**
 * Whether this visitor is on Windows: their download is then the button.
 * The platform says it best; the user agent is for a browser that leaves
 * the platform empty.
 */
export function isWindows(platform: string, userAgent: string): boolean {
  if (platform) return /^Win/.test(platform)
  return /\bWindows\b/.test(userAgent)
}
