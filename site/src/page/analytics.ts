// Visits are counted by Cloudflare Web Analytics, which also measures how
// fast the page loads for them. Only reha.stream's own visitors count: a
// build on a computer loads the same page.
//
// The page adds Cloudflare's script itself rather than letting Cloudflare
// put it into every page it serves: then each frame of the app on the page
// would count as a page view of its own. The token is the site's in
// Cloudflare, the repository's variable WEB_ANALYTICS_TOKEN given to the
// build (.github/actions/site); it is public by design, since every
// visitor's browser sees it. Without one the site counts nothing.

const SITE_HOST = "reha.stream"

const BEACON = "https://static.cloudflareinsights.com/beacon.min.js"

/** Cloudflare's script and its settings for a page at `host`, or null when
 *  that page's visit is not counted. */
export function beaconFor(host: string, token: string | undefined): { src: string; data: string } | null {
  const t = token?.trim()
  if (!t || host !== SITE_HOST) return null
  return { src: BEACON, data: JSON.stringify({ token: t }) }
}

/** Starts counting this page's visit, on reha.stream. */
export function countVisits(token = import.meta.env.VITE_WEB_ANALYTICS_TOKEN): void {
  const beacon = beaconFor(location.hostname, token)
  if (!beacon) return
  const script = document.createElement("script")
  script.defer = true
  script.src = beacon.src
  script.dataset.cfBeacon = beacon.data
  document.head.append(script)
}
