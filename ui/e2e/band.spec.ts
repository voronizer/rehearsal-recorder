import { test, expect, openBandApp, openHistory, startButton } from "./app.ts"

// The band in band.js is what the docs' pictures and the site show. These
// keep it in step with the interface: a band the interface cannot open is
// a broken page on the site, not a test that fails somewhere else later.

test("the band's rehearsal opens on its next take", async ({ page }) => {
  await openBandApp(page)
  await page.locator("#rehearsal-name").fill("Tuesday jam")
  await startButton(page).click()
  await expect(page.getByRole("button", { name: /Record take 4/ })).toBeVisible()
  await expect(page.locator("button[aria-label^='Take 2 Polyn 2']")).toBeVisible()
})

test("the band's history lists its rehearsals", async ({ page }) => {
  await openBandApp(page)
  const list = await openHistory(page)
  for (const name of ["Tuesday jam", "New songs", "Soundcheck"]) {
    await expect(list.getByText(name).first()).toBeVisible()
  }
})
