import { test, expect, openBandApp, openHistory, startButton } from "./app.ts"

// The band in band.js is what the docs' pictures and the site show. These
// keep it in step with the interface: a band the interface cannot open is
// a broken page on the site, not a test that fails somewhere else later.

test("the band's rehearsal opens on its next take", async ({ page }) => {
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startButton(page).click()
  await expect(page.getByRole("button", { name: /Record take 6/ })).toBeVisible()
  await expect(page.locator("button[aria-label^='Take 2 Pałyn 2']")).toBeVisible()
})

test("the band's rehearsal played by its set lists the set", async ({ page }) => {
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await page.locator("[data-set-picker]").click()
  await page
    .getByRole("menu", { name: "Sets" })
    .getByRole("menuitemradio", { name: /Gig on the 25th/ })
    .click()
  await startButton(page).click()
  const card = page.locator("[data-set-card]")
  await expect(card.locator("h2")).toHaveText("Gig on the 25th — 3 of 6 played")
  await expect(card.locator("[data-set-song='Viasna']")).toHaveAttribute("aria-current", "true")
})

test("the band's history lists its rehearsals", async ({ page }) => {
  await openBandApp(page)
  const list = await openHistory(page)
  for (const name of ["Tuesday jam", "New songs", "Soundcheck"]) {
    await expect(list.getByText(name).first()).toBeVisible()
  }
})

test("a rehearsal of the band's played by its set says so in History", async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __PLAYED_BY__: object }).__PLAYED_BY__ = {
      "/rec/tue": { name: "Gig on the 25th", songs: ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška"] },
    }
  })
  await openBandApp(page)
  await openHistory(page)
  await expect(page.locator("[data-set-name]").first()).toHaveText("Gig on the 25th")
  await expect(page.locator("[data-set-played-card] h3")).toHaveText("Gig on the 25th — 4 of 6 played")
})
