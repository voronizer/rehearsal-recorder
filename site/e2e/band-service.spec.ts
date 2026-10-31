import { test, expect } from "./fixtures.ts"

// reha.stream/band-service: what a band service is, how our band uses one
// and what it does for a band member. The setup steps are in the service's
// README on GitHub, one link away. Written into its HTML at build time,
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
    "One for your band",
  ])
})

test("the page is in the sitemap", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text()
  expect(xml).toContain("<loc>https://reha.stream/band-service</loc>")
})

test("the setup steps are on GitHub, one link away, and the cost is on the page", async ({ page }) => {
  await page.goto(PAGE)
  const own = page.locator("#one-for-your-band")
  await expect(own.getByText("$0.015 per GB a month")).toBeVisible()
  await expect(own.getByRole("link", { name: "How to set one up, step by step" })).toHaveAttribute("href", SETUP)
  await expect(page.locator(".tale ol, .tale ul")).toHaveCount(0)
})

test.describe("with script off", () => {
  test.use({ javaScriptEnabled: false })

  test("the whole page is in its HTML", async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
    await expect(page.locator("#one-for-your-band").getByRole("link", { name: "How to set one up, step by step" })).toBeVisible()
  })
})
