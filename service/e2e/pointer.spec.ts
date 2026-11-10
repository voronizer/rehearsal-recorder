import { expect, test, type Page } from "@playwright/test"
import { wrongPointers } from "../../ui/e2e/pointer.ts"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

test("the pointer is the hand over everything that presses, on every page", async ({ page }) => {
  const b = band()
  const take = b.takes["Viasna 12"]
  const menu = (p: Page) => p.getByRole("main").getByRole("button", { name: /^What to do with/ }).first().click()
  const pages: [string, string, ((p: Page) => Promise<unknown>)?][] = [
    ["Home", "/"],
    ["Home, a take's menu", "/", menu],
    ["Rehearsals", "/rehearsals"],
    ["A rehearsal", `/rehearsals/${b.rehearsals.first}`],
    ["Songs", "/songs"],
    ["Songs, the statuses' panel", "/songs?panel=statuses"],
    ["A song", `/songs/${b.songs.Viasna}`],
    ["A song's menu", `/songs/${b.songs.Viasna}`, menu],
    ["A take", `/takes/${take}`],
    ["A take's menu", `/takes/${take}`, menu],
    ["A take's marks", `/takes/${take}?panel=marks:${take}`],
    ["Sets", "/sets"],
    ["A set", `/sets/${b.sets["Club gig"]}`],
    ["Marks", "/marks"],
    ["Marks, the labels' panel", "/marks?panel=labels"],
    ["Members", "/members"],
  ]
  const wrong: string[] = []
  for (const [label, path, act] of pages) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await page.waitForLoadState("networkidle")
    if (act) {
      await act(page)
      await expect(page.getByRole("menu")).toBeVisible()
    }
    wrong.push(...(await wrongPointers(page, label)))
  }
  expect(wrong).toEqual([])
})
