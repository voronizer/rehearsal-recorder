import { test, expect } from "./fixtures.ts"

// reha.stream/band-service: what a band service is, how our band uses one
// and what it does for a band member. It is for the band, not for whoever
// sets the service up: the setup steps are in the service's README on
// GitHub, one link away. Written into its HTML at build time,
// like a story; РЭХА's key line links here (SERVICE_HELP_URL).

const PAGE = "/band-service"
const SETUP = "https://github.com/voronizer/rehearsal-recorder/blob/main/service/README.md#run-one-for-your-band"

test("the band service page is there and linked from the footer", async ({ page }) => {
  await page.goto("/")
  await page.locator(".footer").getByRole("link", { name: "Band service", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${PAGE}$`))
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://reha.stream${PAGE}`)
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "How we use it",
    "How it works",
  ])
})

test("the page is in the sitemap", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text()
  expect(xml).toContain("<loc>https://reha.stream/band-service</loc>")
})

test("the page is for the band: the setup is on GitHub, one link away", async ({ page }) => {
  await page.goto(PAGE)
  await expect(page.locator("#how-it-works").getByRole("link", { name: "the steps on GitHub" })).toHaveAttribute(
    "href",
    SETUP
  )
  await expect(page.locator(".tale ol, .tale ul")).toHaveCount(0)
  await expect(page.locator("main")).not.toContainText(/Cloudflare|token|domain/i)
})

test.describe("with script off", () => {
  test.use({ javaScriptEnabled: false })

  test("the whole page is in its HTML", async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
    await expect(page.locator("#how-it-works").getByRole("link", { name: "the steps on GitHub" })).toBeVisible()
  })
})
