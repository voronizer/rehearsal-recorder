// What the page tells those who read it without running it: search engines,
// AI crawlers, and the chats that draw a card for a link. The page itself is
// drawn by script, so all of this is written into the HTML at build time
// (see seo() in vite.config.ts).
import { MAC_ZIP, REPO, WINDOWS_ZIP } from "../page/links.ts"

export const SITE_URL = "https://reha.stream/"
/** Drawn in CI from og.html (scripts/og.mjs). Chats want it absolute. */
export const OG_IMAGE = `${SITE_URL}og.png`
/** The page's <meta name="description">, word for word. */
export const DESCRIPTION =
  "A free app for macOS and Windows that records a band's rehearsal, one track per musician, and keeps every rehearsal you have ever had."

/** The app as schema.org describes software, for search engines. */
export function softwareJsonLd(version: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "РЭХА",
    alternateName: "Rehearsal Recorder",
    description: DESCRIPTION,
    url: SITE_URL,
    image: OG_IMAGE,
    softwareVersion: version,
    operatingSystem: "macOS, Windows",
    applicationCategory: "MultimediaApplication",
    downloadUrl: [MAC_ZIP, WINDOWS_ZIP],
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  }
}

/** JSON for a <script> in the page. A "<" in it is written as <, which
 *  JSON reads the same, so no value can close the script early. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** For a reader with no script: what the app is, and where to get it. */
export function noscriptHtml(hero: { title: string; lede: string }): string {
  return [
    `<h1>${escape(hero.title)}</h1>`,
    `<p>${escape(hero.lede)}</p>`,
    `<p><a href="${MAC_ZIP}">Download for macOS</a> · <a href="${WINDOWS_ZIP}">Download for Windows</a> · <a href="${REPO}">Source on GitHub</a></p>`,
  ].join("\n")
}

/** Every crawler is welcome, AI ones too: the page is there to be found. The
 *  frames and the 404 page keep themselves out with a noindex of their own. */
export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`
}

/** The site is one page. */
export function sitemapXml(): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `<url><loc>${SITE_URL}</loc></url>`,
    `</urlset>`,
    ``,
  ].join("\n")
}
