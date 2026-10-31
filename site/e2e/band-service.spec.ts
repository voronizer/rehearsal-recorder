import { test, expect } from "./fixtures.ts"

// reha.stream/band-service, the page a band member is sent: what the
// service does for them, a chapter each with a picture of it on a phone,
// then how to start. It is for the band, not for whoever sets the service
// up: the setup steps are in the service's README on GitHub, one link
// away. Written into its HTML at build time, like a story; РЭХА's key line
// links here (SERVICE_HELP_URL).

const PAGE = "/band-service"
const SETUP = "https://github.com/voronizer/rehearsal-recorder/blob/main/service/README.md#run-one-for-your-band"

test("the band service page is there and linked from the footer", async ({ page }) => {
  await page.goto("/")
  await page.locator(".footer").getByRole("link", { name: "Band service", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${PAGE}$`))
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://reha.stream${PAGE}`)
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "The takes are on your phone the same evening",
    "Hear your own part",
    "Point at the second",
    "Know which take you're aiming for",
    "Nothing gets lost",
    "Take your track home",
    "How to start",
  ])
  await expect(page.locator(".chap-head .n")).toHaveText(["1", "2", "3", "4", "5", "6"])
  await expect(page.locator("#how-to-start .chap-steps li")).toHaveCount(4)
  await expect(page.locator("#how-to-start .chap-steps li").last()).toBeVisible()
})

for (const theme of ["light", "dark"] as const) {
  test(`each picture of the service comes in, in the ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto(PAGE)
    await expect(page.locator(".phone-shot img")).toHaveCount(6)
    // Downloading is for the recording program at home: that one is a computer.
    await expect(page.locator("#take-your-track-home .computer-shot img")).toHaveCount(1)
    for (const img of await page.locator("figure img").all()) {
      await img.scrollIntoViewIfNeeded()
      await expect(img).toHaveJSProperty("complete", true)
      // Sharp: at least as many pixels as the page gives it.
      expect(await img.evaluate((el: HTMLImageElement, theme) => [el.naturalWidth >= el.width, el.currentSrc.includes(`-${theme}-`)], theme)).toEqual([true, true])
    }
    // The caption names what to look at, and is the picture's name for a screen reader.
    await expect(page.getByRole("img", { name: /^Viasna 12 with S pressed on the guitar's lane/ })).toBeVisible()
  })
}

test("the page is in the sitemap", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text()
  expect(xml).toContain("<loc>https://reha.stream/band-service</loc>")
})

test("the page is for the band: the setup is on GitHub, one link away", async ({ page }) => {
  await page.goto(PAGE)
  await expect(page.locator("#how-to-start").getByRole("link", { name: "the steps on GitHub" })).toHaveAttribute(
    "href",
    SETUP
  )
  await expect(page.locator("main")).not.toContainText(/Cloudflare|token|domain|secret/i)
})

test.describe("with script off", () => {
  test.use({ javaScriptEnabled: false })

  test("the whole page is in its HTML", async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A band service of your own")
    await expect(page.locator("#how-to-start").getByRole("link", { name: "the steps on GitHub" })).toBeVisible()
    await expect(page.locator("figure img")).toHaveCount(7)
  })
})
