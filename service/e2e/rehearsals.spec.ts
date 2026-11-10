import { expect, test } from "@playwright/test"
import { as, band } from "./band"
import { linesOf, roomBetween } from "./rows"

test.use({ storageState: as("alex") })

test("rehearsals come by month, and a rehearsal's takes by song", async ({ page }) => {
  await page.goto("/rehearsals")
  const october = page.getByRole("region", { name: "October 2025" })
  const rows = october.locator("[data-rehearsal]")
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText(/Thu 30 Oct( 2025)?/)
  await expect(rows.nth(0)).toContainText("Not named")
  await expect(rows.nth(1)).toContainText(/Thu 23 Oct( 2025)?/)
  // 24 px between rows, no lines, and a row that opens as a whole has no dotted day.
  const list = october.getByRole("list")
  expect(await roomBetween(list)).toEqual([24])
  expect(new Set(await linesOf(list))).toEqual(new Set(["0px"]))
  await expect(rows.nth(0).getByText(/Thu 30 Oct/)).toHaveCSS("text-decoration-line", "none")

  // A press on the row's lit room round its words opens it too.
  await list.getByRole("listitem").nth(0).click({ position: { x: 3, y: 3 } })
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Thursday, 30 October( 2025)?$/)
  await expect(page.getByText("5 takes · 3 songs · 0:50 recorded")).toBeVisible()
  // In the order they were played; takes with no song's title last.
  await expect(page.getByRole("main").getByRole("region")).toHaveText([/^Kupalle/, /^Pałyn/, /^Viasna/, /^Not named/])
  const viasna12 = page.locator('[data-take="Viasna 12"]')
  await expect(viasna12).toContainText("The bridge drags here")
  await expect(viasna12).toContainText("Fill too long?")

  // Each song's line over its takes, which do not fold; Not named a plain heading; no Notes and files.
  const main = page.getByRole("main")
  await expect(main.getByRole("link", { name: "Notes and files" })).toHaveCount(0)
  await expect(main.getByRole("button", { name: /^(Kupalle|Pałyn|Viasna|Not named)\s*\d+ takes?$/ })).toHaveCount(0)
  await expect(main.getByRole("heading", { name: "Not named", exact: true })).toBeVisible()
  await expect(main.getByRole("region", { name: "Not named" }).getByRole("link", { name: /takes?\b/ })).toHaveCount(0)
  const line = page.getByRole("region", { name: "Viasna", exact: true }).getByRole("link", { name: /^Viasna\s*2 takes/ })
  await line.click()
  await expect(page).toHaveURL(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Rehearsals" }).click()
  await expect(page).toHaveURL("/rehearsals")
})

test("a rehearsal opened by its link shows its takes only with their songs' titles", async ({ page }) => {
  // The titles come late: until they do, no take is drawn.
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route("**/api/songs", async (route) => {
    await held
    await route.continue()
  })
  const read = page.waitForResponse((r) => r.url().includes("/api/rehearsals/") && r.ok())
  await page.goto(`/rehearsals/${band().rehearsals.second}`)
  await read
  // Two frames for the page to draw what it has.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await expect(page.locator("[data-take]")).toHaveCount(0)

  release()
  const viasna = page.getByRole("region", { name: "Viasna", exact: true })
  await expect(viasna.locator('[data-take="Viasna 11"]')).toBeVisible()
  await expect(page.locator("[data-take]")).toHaveCount(5)
})

test("a rehearsal with no takes left opens Rehearsals", async ({ page }) => {
  // As after Delete take on its last take: the service has no such rehearsal any more.
  await page.goto(`/rehearsals/${crypto.randomUUID()}`)
  await expect(page).toHaveURL(/\/rehearsals$/)
  await expect(page.getByRole("heading", { level: 1, name: "Rehearsals" })).toBeVisible()
  await expect(page.getByText("No such rehearsal")).toHaveCount(0)
})
