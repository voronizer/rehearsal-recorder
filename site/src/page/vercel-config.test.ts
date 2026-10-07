import { describe, expect, it } from "vitest"
import raw from "../../vercel-config.json?raw"
import { MAC_ZIP, WINDOWS_ZIP } from "./links"

type Route = {
  src?: string
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
const matching = (routes: Route[], path: string) => routes.find((r) => new RegExp(r.src!).test(path))
/** The first route before the files that matches, one that goes on included. */
const route = (path: string) => matching(before, path)

/** What the build has at an address, as dist/ lays it out. */
const BUILT =
  /^\/(|index\.html|stage\.html|og\.html|404\.html|og\.png|robots\.txt|sitemap\.xml|favicon\.svg|assets\/.+)$/
/** What an address gets: a route that ends it before the files, the file,
 *  or a route after them. */
function served(path: string): Route | "file" | undefined {
  const first = before.find((r) => !r.continue && new RegExp(r.src!).test(path))
  if (first) return first
  if (BUILT.test(path)) return "file"
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
  it("serves the build's own files as they are", () => {
    for (const path of ["/", "/index.html", "/stage.html", "/404.html", "/og.png", "/robots.txt", "/assets/index-Bx1y2z3.js"]) {
      expect(served(path)).toBe("file")
    }
  })
})
