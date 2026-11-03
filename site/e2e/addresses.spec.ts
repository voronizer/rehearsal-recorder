import { MAC_ZIP, WINDOWS_ZIP } from "../src/page/links.ts"
import { test, expect } from "./fixtures.ts"

// What reha.stream answers for each kind of address, as Cloudflare's own
// local server answers it from wrangler.jsonc and the build's _redirects and
// _headers. Each request stops at the first answer, so a redirect is seen
// as itself.

const first = { maxRedirects: 0 }

test("the page and every page of stories answer at their own addresses", async ({ request }) => {
  for (const path of ["/", "/stories", "/stories/metronome", "/stories/digital-mixer", "/band-service"]) {
    expect((await request.get(path, first)).status(), path).toBe(200)
  }
})

// The same zips the page's download buttons give.
test("the short links send you to the latest zips on GitHub", async ({ request }) => {
  for (const [path, zip] of [
    ["/mac", MAC_ZIP],
    ["/mac/", MAC_ZIP],
    ["/windows", WINDOWS_ZIP],
    ["/windows/", WINDOWS_ZIP],
  ]) {
    const answer = await request.get(path, first)
    expect(answer.status(), path).toBe(307)
    expect(answer.headers()["location"], path).toBe(zip)
  }
})

test("a slash at the end or .html sends you to the plain address", async ({ request }) => {
  for (const [path, to] of [
    ["/stories/", "/stories"],
    ["/stories.html", "/stories"],
    ["/stories/metronome/", "/stories/metronome"],
    ["/index.html", "/"],
    ["/stage.html", "/stage"],
  ]) {
    const answer = await request.get(path, first)
    expect(answer.status(), path).toBe(307)
    expect(new URL(answer.headers()["location"], "http://x").pathname, path).toBe(to)
  }
})

test("the build's own files are kept for a year, the pages are not", async ({ page, request }) => {
  const scripts: string[] = []
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/assets/")) scripts.push(r.url())
  })
  await page.goto("/")
  expect(scripts.length).toBeGreaterThan(0)
  expect((await request.get(scripts[0])).headers()["cache-control"]).toBe("public, max-age=31536000, immutable")
  expect((await request.get("/")).headers()["cache-control"]).not.toContain("max-age=31536000")
})

test("an address that is no file gets the 404 page, in any letters", async ({ request }) => {
  for (const path of ["/no-such-take", "/stories/no-such-story", "/MAC"]) {
    const answer = await request.get(path, first)
    expect(answer.status(), path).toBe(404)
    expect(await answer.text(), path).toContain("<title>РЭХА: nothing was recorded here</title>")
  }
})
