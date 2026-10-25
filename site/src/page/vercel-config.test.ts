import { describe, expect, it } from "vitest"
import raw from "../../vercel-config.json?raw"
import { MAC_ZIP, WINDOWS_ZIP } from "./links"

type Route = {
  src?: string
  caseSensitive?: boolean
  handle?: string
  status?: number
  dest?: string
  headers?: Record<string, string>
  continue?: boolean
}
const config: { version: number; routes: Route[] } = JSON.parse(raw)

// Vercel goes through the routes in phases: those before
// { "handle": "filesystem" } first, then the build's files, and the routes
// after it only for an address that is no file.
const files = config.routes.findIndex((r) => r.handle === "filesystem")
const before = files < 0 ? config.routes : config.routes.slice(0, files)
const after = files < 0 ? [] : config.routes.slice(files + 1)
// Vercel matches a route whatever the letters' case, unless it says it is
// case-sensitive.
const pattern = (r: Route) => new RegExp(r.src!, r.caseSensitive ? "" : "i")
const matching = (routes: Route[], path: string) => routes.find((r) => pattern(r).test(path))
/** The first route before the files that matches, one that goes on included. */
const route = (path: string) => matching(before, path)

/** The stories, by their files' names: each is built as stories/<name>.html. */
const STORIES = Object.keys(import.meta.glob("../../content/stories/*.md")).map((path) =>
  path.slice(path.lastIndexOf("/") + 1, -".md".length)
)

/** What the build has at an address, as dist/ lays it out: its pages, what
 *  it writes beside them, the interface's public files, and /assets/. */
const BUILT = new Set([
  "/",
  "/index.html",
  "/stage.html",
  "/og.html",
  "/404.html",
  "/stories.html",
  ...STORIES.map((name) => `/stories/${name}.html`),
  "/og.png",
  "/robots.txt",
  "/sitemap.xml",
  ...Object.keys(import.meta.glob("../../../ui/public/*")).map((path) => path.slice(path.lastIndexOf("/"))),
])
const built = (path: string) => BUILT.has(path) || /^\/assets\/.+$/.test(path)
/** What an address gets: a route that ends it before the files (a redirect,
 *  or the file a route sends it to), the file, or a route after them. */
function served(path: string): Route | { file: string } | undefined {
  const first = before.find((r) => !r.continue && pattern(r).test(path))
  if (first?.dest && !first.status) return { file: path.replace(pattern(first), first.dest) }
  if (first) return first
  if (built(path)) return { file: path }
  return matching(after, path)
}

describe("vercel-config.json", () => {
  it("is a Build Output API v3 config", () => {
    expect(config.version).toBe(3)
  })
  it("sends /mac and /windows to the latest zips, for now", () => {
    for (const [path, zip] of [
      ["/mac", MAC_ZIP],
      ["/mac/", MAC_ZIP],
      ["/windows", WINDOWS_ZIP],
      ["/windows/", WINDOWS_ZIP],
    ]) {
      expect(route(path)).toMatchObject({ status: 307, headers: { Location: zip } })
      expect(served(path)).toMatchObject({ status: 307, headers: { Location: zip } })
    }
  })
  it("leaves other addresses that start the same alone", () => {
    expect(route("/macos")).toBeUndefined()
    expect(route("/mac/x")).toBeUndefined()
    expect(route("/windowsx")).toBeUndefined()
  })
  it("caches the build's hashed files for a year, and nothing else", () => {
    expect(route("/assets/index-Bx1y2z3.js")).toMatchObject({
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      continue: true,
    })
    expect(route("/")).toBeUndefined()
    expect(route("/index.html")).toBeUndefined()
    expect(route("/stage.html")).toBeUndefined()
  })
  it("answers an address that is no file with 404 and the 404 page", () => {
    expect(files).toBeGreaterThan(0)
    for (const path of ["/nothing-here", "/mac/x", "/macos", "/windowsx", "/assets", "/index"]) {
      expect(served(path)).toMatchObject({ status: 404, dest: "/404.html" })
    }
  })
  // Vercel's own addresses: Web Analytics' and Speed Insights' scripts and
  // where they send to. The 404 above them answered those too, and nothing
  // was counted.
  it("leaves Vercel's own addresses to Vercel", () => {
    for (const path of [
      "/_vercel/insights/script.js",
      "/_vercel/insights/view",
      "/_vercel/speed-insights/script.js",
      "/_vercel/speed-insights/vitals",
    ]) {
      expect(served(path)).toBeUndefined()
    }
    expect(served("/_vercelx")).toMatchObject({ status: 404 })
  })
  it("serves the build's own files as they are", () => {
    expect(BUILT).toContain("/favicon.svg")
    for (const path of [...BUILT, "/assets/index-Bx1y2z3.js"]) {
      expect(served(path)).toEqual({ file: path })
    }
  })
  it("serves each story at its address, with or without a slash, and the page of stories", () => {
    expect(STORIES.length).toBeGreaterThan(0)
    for (const path of ["/stories", "/stories/"]) expect(served(path)).toEqual({ file: "/stories.html" })
    for (const name of STORIES)
      for (const path of [`/stories/${name}`, `/stories/${name}/`]) {
        expect(served(path)).toEqual({ file: `/stories/${name}.html` })
        expect(BUILT).toContain(`/stories/${name}.html`)
      }
  })
  // A story added without its name in the route would answer 404.
  it("names every story in its route, and no other", () => {
    const route = before.find((r) => r.dest === "/stories/$1.html")
    const names = /\(([^)]*)\)/.exec(route?.src ?? "")?.[1].split("|") ?? []
    expect(names.sort()).toEqual([...STORIES].sort())
  })
  it("answers a story that is not there with the 404 page", () => {
    // A story's name in other letters too: the route would send it to a file
    // that is not there, and Vercel's own 404 would answer, not the site's.
    for (const path of ["/stories/nothing", "/stories/digital-mixer/x", "/storiesx", "/stories/x.html", "/stories/Metronome", "/Stories"]) {
      expect(served(path)).toMatchObject({ status: 404, dest: "/404.html" })
    }
  })
})
