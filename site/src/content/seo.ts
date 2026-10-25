// What the site tells those who read it without running it: search engines,
// AI crawlers, and the chats that draw a card for a link. The main page is
// drawn by script, so all of this is written into the HTML at build time
// (see seo() in vite.config.ts); the stories' pages are written whole then
// (stories() there).
import { MAC_ZIP, REPO, WINDOWS_ZIP } from "../page/links.ts"

export const SITE_URL = "https://reha.stream/"
/** Drawn in CI from og.html (scripts/og.mjs). Chats want it absolute. */
export const OG_IMAGE = `${SITE_URL}og.png`
/** The page's <meta name="description">, word for word. */
export const DESCRIPTION =
  "A free app for macOS and Windows that records a band's rehearsal, one track per musician, and keeps every rehearsal you record."

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

/** JSON for a <script> in the page. A "<" in it is written as \u003c, which
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

/** The 404 page for a reader with no script: what it says, and the way back. */
export function notFoundNoscriptHtml(notFound: { title: string; lede: string }): string {
  return [
    `<h1>${escape(notFound.title)}</h1>`,
    `<p>${escape(notFound.lede)}</p>`,
    `<p><a href="/">Go to the main page</a></p>`,
  ].join("\n")
}

/** Every crawler is welcome, AI ones too: the page is there to be found. The
 *  frames and the 404 page keep themselves out with a noindex of their own. */
export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`
}

/** Every page of the site, by its path: the main page and the stories'. */
export function sitemapXml(paths: string[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...paths.map((path) => `<url><loc>${escape(pageUrl(path))}</loc></url>`),
    `</urlset>`,
    ``,
  ].join("\n")
}

/** A page's whole address: /stories is https://reha.stream/stories. */
export function pageUrl(path: string): string {
  return SITE_URL + path.replace(/^\//, "")
}

/** A page of the site that is written whole at build time: a story, or the
 *  page of stories (the stories() plugin in vite.config.ts). */
export type PageMeta = {
  path: string
  /** As the browser's tab and search results show it: “… · РЭХА”. */
  title: string
  description: string
  kind: "website" | "article"
  jsonLd: Record<string, unknown> | null
}

/** Such a page's head: what index.html has by hand, for its own address. The
 *  link card's picture is the main page's. */
export function pageHeadHtml(meta: PageMeta): string {
  const url = escape(pageUrl(meta.path))
  const title = escape(meta.title)
  const description = escape(meta.description)
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${meta.kind}" />`,
    `<meta property="og:site_name" content="РЭХА" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="РЭХА: the rehearsal screen, playing a take" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(meta.jsonLd ? [`<script type="application/ld+json">${jsonLdText(meta.jsonLd)}</script>`] : []),
  ].join("\n    ")
}

/** A story as schema.org describes an article: Alex's, published by the app. */
export function articleJsonLd(story: {
  title: string
  description: string
  date: string
  url: string
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.title,
    description: story.description,
    datePublished: story.date,
    url: story.url,
    mainEntityOfPage: story.url,
    image: OG_IMAGE,
    inLanguage: "en",
    author: { "@type": "Person", name: "Alex" },
    publisher: { "@type": "Organization", name: "РЭХА", url: SITE_URL },
  }
}
