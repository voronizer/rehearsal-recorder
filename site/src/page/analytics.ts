// The site's own address. A pull request's preview on Vercel, the project's
// vercel.app address and a build on this computer load the same page, and
// their visits are not visits to the site.
export const SITE_HOST = "reha.stream"

/** Vercel's analytics event as it is, on reha.stream; elsewhere null, which
 *  tells the script not to send it. */
export function onlyOnSite<E extends { url: string }>(event: E): E | null {
  return new URL(event.url).hostname === SITE_HOST ? event : null
}
