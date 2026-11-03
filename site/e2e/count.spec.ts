import { test, expect } from "./fixtures.ts"

// On reha.stream itself the page and the pages of stories add Cloudflare's
// counter, with the site's token; the app's frames never do. Every request
// for reha.stream is answered here by this machine's server, and the
// counter's script with nothing, so no visit reaches Cloudflare. Only a
// build with the token (the repository's WEB_ANALYTICS_TOKEN, given to the
// build as VITE_WEB_ANALYTICS_TOKEN) has a counter at all; away from
// reha.stream the other tests check there is none.

const TOKEN = process.env.VITE_WEB_ANALYTICS_TOKEN?.trim()
const BEACON = "https://static.cloudflareinsights.com/beacon.min.js"

test.skip(!TOKEN, "this build has no Web Analytics token")

test.beforeEach(async ({ context, baseURL }) => {
  await context.route("http://reha.stream/**", async (route) => {
    const url = route.request().url().replace("http://reha.stream", baseURL!)
    await route.fulfill({ response: await route.fetch({ url }) })
  })
  await context.route(`${BEACON}*`, (route) => route.fulfill({ contentType: "text/javascript", body: "" }))
})

test("on reha.stream the page counts its visit with the site's token, the app in it does not", async ({ page }) => {
  await page.goto("http://reha.stream/")
  const beacon = page.locator(`script[src="${BEACON}"]`)
  await expect(beacon).toHaveCount(1)
  await expect(beacon).toHaveAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }))
  await expect.poll(() => page.frames().filter((f) => new URL(f.url()).pathname === "/stage").length).toBeGreaterThan(0)
  for (const f of page.frames().filter((f) => f !== page.mainFrame())) {
    await f.waitForLoadState()
    expect(await f.locator(`script[src="${BEACON}"]`).count(), f.url()).toBe(0)
  }
})

test("on reha.stream the stories and the band service's page count theirs", async ({ page }) => {
  for (const path of ["/stories", "/stories/metronome", "/band-service"]) {
    await page.goto(`http://reha.stream${path}`)
    await expect(page.locator(`script[src="${BEACON}"]`), path).toHaveCount(1)
  }
})
