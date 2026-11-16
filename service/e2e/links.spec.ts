import { expect, test, type Page } from "@playwright/test"
import { as, asMember, band } from "./band"

/*
  Links to a take for someone outside the band (#106): the chain button on a
  take's page, its window, and the band's list on Members and links.
*/

const take = () => band().takes["Viasna 12"]
const LINK = "Link for someone outside the band"

async function openWindow(page: Page) {
  await page.goto(`/takes/${take()}`)
  await page.getByRole("button", { name: LINK }).click()
  const window = page.getByRole("dialog")
  await expect(window.getByRole("heading", { name: "Link to “Viasna #12”" })).toBeVisible()
  return window
}

/** The tracks' MP3s come slowly, so the mix is still being made when the test looks. */
const slowFiles = (page: Page) =>
  page.route("**/files/**/*.mp3", async (route) => {
    await new Promise((go) => setTimeout(go, 1500))
    await route.continue()
  })

/** The pressed choice of a row of choices. */
const picked = (page: Page, row: string) => page.getByRole("radiogroup", { name: row }).locator('[aria-checked="true"], [data-state="on"]')

test.describe("as Alex", () => {
  test.use({ storageState: as("alex") })

  test("a member makes a tracks link and sees it at the top", async ({ page }) => {
    await page.goto(`/takes/${take()}`)
    const player = page.locator("[data-take-player]")
    await player.getByRole("slider", { name: "Guitar volume" }).press("Home")
    await player.getByRole("button", { name: "Mute Bass" }).click()
    await page.getByRole("button", { name: LINK }).click()
    const window = page.getByRole("dialog")
    await window.getByRole("textbox", { name: "Who it is for" }).fill("Mum")
    await window.getByRole("radiogroup", { name: "Shows" }).getByText("Mix and tracks").click()
    await window.getByRole("radiogroup", { name: "Lasts" }).getByText("No end").click()
    await window.getByRole("button", { name: "Make link" }).click()
    const first = window.locator("[data-link-row]").first()
    await expect(first).toContainText("Mum")
    await expect(first).toContainText("Mix and tracks, no download")
    await expect(first).toContainText("no end")
    await expect(first).toContainText("not played yet")
    const address = await first.getByRole("textbox", { name: "The link" }).inputValue()
    expect(address).toMatch(/\/l\/[A-HJ-NP-Za-km-z2-9]{22}$/)
    await expect(window.getByRole("textbox", { name: "Who it is for" })).toHaveValue("")
    await expect(picked(page, "Shows")).toHaveText("Mix and tracks")
    const id = address.slice(address.lastIndexOf("/") + 1)
    const heard = (await (await page.request.get(`/api/l/${id}`)).json()).link.heard
    expect(heard.volumes.Guitar).toBe(0)
    expect(heard.muted).toContain("Bass")
  })

  test("the window opens at The mix, Nothing and A month each time", async ({ page }) => {
    const window = await openWindow(page)
    await expect(picked(page, "Shows")).toHaveText("The mix")
    await expect(picked(page, "Download")).toHaveText("Nothing")
    await expect(picked(page, "Lasts")).toHaveText("A month")
    await window.getByRole("radiogroup", { name: "Shows" }).getByText("And marks").click()
    await window.getByRole("radiogroup", { name: "Download" }).getByText("Mix and tracks").click()
    await window.getByRole("radiogroup", { name: "Lasts" }).getByText("A day").click()
    await window.getByRole("textbox", { name: "Who it is for" }).fill("Siarhiej")
    await window.getByRole("button", { name: "Close", exact: true }).click()
    await expect(window).toBeHidden()
    await page.getByRole("button", { name: LINK }).click()
    await expect(picked(page, "Shows")).toHaveText("The mix")
    await expect(picked(page, "Download")).toHaveText("Nothing")
    await expect(picked(page, "Lasts")).toHaveText("A month")
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "Who it is for" })).toHaveValue("")
  })

  test("Mix and tracks is greyed out while the link shows the mix", async ({ page }) => {
    const window = await openWindow(page)
    const download = window.getByRole("radiogroup", { name: "Download" })
    await expect(download.getByRole("radio", { name: "Mix and tracks" })).toBeDisabled()
    await window.getByRole("radiogroup", { name: "Shows" }).getByText("Mix and tracks").click()
    await download.getByText("Mix and tracks").click()
    await expect(picked(page, "Download")).toHaveText("Mix and tracks")
    await window.getByRole("radiogroup", { name: "Shows" }).getByText("The mix").click()
    await expect(picked(page, "Download")).toHaveText("The mix")
  })

  test("a mix link is made with its mix", async ({ page }) => {
    await slowFiles(page)
    const window = await openWindow(page)
    await window.getByRole("radiogroup", { name: "Download" }).getByText("The mix").click()
    const make = window.getByRole("button", { name: "Make link" })
    const width = (await make.boundingBox())!.width
    await make.click()
    await expect(window.locator("[data-link-line]")).toContainText(/Mixing…|Sending the mix…/)
    await expect(make).toBeDisabled()
    expect((await make.boundingBox())!.width).toBe(width)
    const first = window.locator("[data-link-row]").first()
    await expect(first.getByRole("textbox", { name: "The link" })).toBeVisible({ timeout: 20_000 })
    await expect(first).toContainText("The mix")
    await expect(first).toContainText("Download the mix")
    await expect(first).toContainText("until")
    const id = (await first.getByRole("textbox", { name: "The link" }).inputValue()).split("/l/")[1]
    const listed = (await (await page.request.get("/api/links")).json()) as { id: string; shows: string }[]
    expect(listed.find((l) => l.id === id)).toMatchObject({ shows: "mix" })
  })

  test("a mix of muted tracks makes no link", async ({ page }) => {
    await page.goto(`/takes/${take()}`)
    const player = page.locator("[data-take-player]")
    for (const name of ["Drums", "Bass", "Guitar", "Keys", "Vocals", "Shaker"]) await player.getByRole("button", { name: `Mute ${name}` }).click()
    let asked = 0
    await page.route("**/api/takes/*/links", (route) => {
      asked++
      return route.continue()
    })
    await page.getByRole("button", { name: LINK }).click()
    const window = page.getByRole("dialog")
    await window.getByRole("button", { name: "Make link" }).click()
    await expect(window.locator("[data-link-line]")).toContainText("Every track is muted, so the mix would be silent.")
    expect(asked).toBe(0)
  })

  test("closing the window while the mix is made makes no link", async ({ page }) => {
    const before = ((await (await page.request.get("/api/links")).json()) as unknown[]).length
    await slowFiles(page)
    const window = await openWindow(page)
    await window.getByRole("button", { name: "Make link" }).click()
    await expect(window.locator("[data-link-line]")).toContainText(/Mixing…/)
    await window.getByRole("button", { name: "Close", exact: true }).click()
    await expect(window).toBeHidden()
    await page.waitForTimeout(500)
    expect(((await (await page.request.get("/api/links")).json()) as unknown[]).length).toBe(before)
  })

  test("a link the service cannot close stays and says so", async ({ page }) => {
    const api = await asMember("alex")
    await api.post(`/api/takes/${take()}/links`, {
      data: { for: "Closing test", shows: "tracks", download: "none", lasts: "never", heard: { volumes: {}, muted: [], soloed: [] } },
    })
    await page.route("**/api/links/*", (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 500, json: { error: "No" } }) : route.continue()))
    const window = await openWindow(page)
    const row = window.locator("[data-link-row]", { hasText: "Closing test" })
    await row.getByRole("button", { name: "Close link" }).click()
    await expect(window.getByText("Could not close the link. Try again.")).toBeVisible()
    await expect(row).toBeVisible()
  })

  test("the address shows to copy by hand when the clipboard refuses", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("No")) } })
    })
    const api = await asMember("alex")
    await api.post(`/api/takes/${take()}/links`, {
      data: { for: "Copy test", shows: "tracks", download: "none", lasts: "never", heard: { volumes: {}, muted: [], soloed: [] } },
    })
    const window = await openWindow(page)
    const row = window.locator("[data-link-row]", { hasText: "Copy test" })
    await row.getByRole("button", { name: "Copy link" }).click()
    const field = row.getByRole("textbox", { name: "The link" })
    await expect(field).toBeVisible()
    await expect(field).toBeFocused()
    expect(await field.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe((await field.inputValue()).length)
  })
})

test.describe("as Ira", () => {
  test.use({ storageState: as("ira") })

  test("Members and links lists every link and any member closes one", async ({ page }) => {
    const api = await asMember("alex")
    const made = await api.post(`/api/takes/${take()}/links`, {
      data: { for: "For the list", shows: "tracks", download: "none", lasts: "never", heard: { volumes: {}, muted: [], soloed: [] } },
    })
    const { id } = (await made.json()) as { id: string }
    await page.goto("/")
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Members and links" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Members and links" })).toBeVisible()
    const group = page.getByRole("region", { name: "Links for people outside the band" })
    const row = group.locator("[data-link-row]", { hasText: "For the list" })
    await expect(row).toContainText("Viasna #12 · For the list")
    await expect(row).toContainText("Alex")
    await row.getByRole("button", { name: "Close link" }).click()
    await expect(row).toHaveCount(0)
    const left = (await (await api.get("/api/links")).json()) as { id: string }[]
    expect(left.map((l) => l.id)).not.toContain(id)
  })
})
