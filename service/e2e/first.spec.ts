import { expect, test } from "@playwright/test"
import { addMember, as, asMember, band, confirm, signIn } from "./band"

test.describe("as Paulik", () => {
  test.use({ storageState: as("paulik") })

  test("the first screen shows what is new, then the songs", async ({ page }) => {
    await page.goto("/")
    const card = page.getByRole("region", { name: "New since you were here" })
    await expect(card.getByRole("link", { name: /^(Viasna|Pałyn|Kupalle|Take) \d+$/ })).toHaveText([
      "Viasna 11",
      "Pałyn 9",
      "Take 7",
      "Kupalle 2",
      "Viasna 5",
      "Pałyn 3",
    ])
    // Paŭlik opened Viasna 12 before the others wrote on it.
    await expect(card.getByRole("listitem")).toHaveCount(3)
    await expect(card.getByRole("listitem").first()).toContainText("“Fill too long?”")
    await expect(card).toContainText("Viasna 12 · 0:04")
    await expect(card).toContainText("“The bridge drags here”")
    await expect(card).toContainText("Dzima")

    const side = page.getByRole("navigation", { name: "Songs" })
    await expect(side.getByRole("link", { name: /New/ })).toContainText("9")
    await expect(side.getByRole("link")).toContainText(["New", "Viasna", "Pałyn", "Kupalle", "Not named"])
  })
})

test("with nothing new the new card is not there", async ({ page }) => {
  const owner = await asMember("alex")
  await addMember(owner, "zoja@example.com")
  await confirm(owner, "zoja@example.com")
  await signIn(page.request, "zoja@example.com")
  await page.request.put("/api/me", { data: { name: "Zoja" } })
  for (const uid of Object.values(band().takes)) await page.request.post(`/api/takes/${uid}/seen`)

  // On a computer the service opens on the song played last.
  await page.goto("/")
  await expect(page).toHaveURL(`/songs/${band().songs["Viasna"]}`)
  await expect(page.getByRole("heading", { level: 1, name: "Viasna" })).toBeVisible()
  await expect(page.getByText("New since you were here")).toHaveCount(0)
  await expect(page.getByRole("navigation", { name: "Songs" }).getByRole("link", { name: "New" })).toHaveText("New")
})

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a computer keeps the songs on the left", async ({ page }) => {
    for (const [width, height] of [
      [1180, 820],
      [960, 680],
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto("/")
      const side = page.getByRole("navigation", { name: "Songs" })
      await side.getByRole("link", { name: "Pałyn" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Pałyn" })).toBeVisible()
      await expect(side.getByRole("link", { name: "Pałyn" })).toHaveAttribute("aria-current", "page")
      await expect(side.getByRole("link", { name: "Viasna" })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  })

  test("a phone shows one page at a time with a back arrow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await expect(page.getByRole("navigation", { name: "Songs" })).toBeHidden()
    const songs = page.getByRole("region", { name: "Songs" })
    await expect(songs.getByRole("link")).toContainText(["Viasna", "Pałyn", "Kupalle", "Not named"])
    await songs.getByRole("link", { name: /Viasna/ }).click()

    await expect(page.getByRole("heading", { level: 1, name: "Viasna" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Back to РЭХА" })).toBeVisible()
    await page.getByRole("link", { name: /^Viasna 12/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Viasna 12" })).toBeVisible()
    await page.getByRole("link", { name: "Back to Viasna" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Viasna" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
