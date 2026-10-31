import { test, expect } from "./fixtures.ts"

// reha.stream/band-service: what a band service is, how our band uses one,
// and how a band runs its own. Written into its HTML at build time, like a
// story; РЭХА's key line links here (SERVICE_HELP_URL).

const PAGE = "/band-service"

test("the band service page is there and linked from the footer", async ({ page }) => {
  await page.goto("/")
  await page.locator(".footer").getByRole("link", { name: "Band service", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${PAGE}$`))
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://reha.stream${PAGE}`)
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "How we use it",
    "Run your own",
    "The code",
  ])
})

test("the page is in the sitemap", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text()
  expect(xml).toContain("<loc>https://reha.stream/band-service</loc>")
})

test("the steps are numbered and name the cost", async ({ page }) => {
  await page.goto(PAGE)
  const run = page.locator("#run-your-own")
  await expect(run.getByText("$0.015 per GB a month")).toBeVisible()
  const steps = run.locator("ol > li")
  expect(await steps.count()).toBeGreaterThanOrEqual(8)
  await expect(steps.first()).toContainText("GitHub")
  await expect(steps.last()).toContainText("I have a band service key")
  await expect(page.locator("#the-code").getByRole("link", { name: /service/ })).toHaveAttribute(
    "href",
    "https://github.com/voronizer/rehearsal-recorder/tree/main/service"
  )
})

test.describe("with script off", () => {
  test.use({ javaScriptEnabled: false })

  test("the whole page is in its HTML", async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
    await expect(page.locator("#run-your-own ol > li").first()).toBeVisible()
  })
})
