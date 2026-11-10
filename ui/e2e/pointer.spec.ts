import { closeTakeButton, expect, openBandApp, recordButton, settled, startButton, takeButton, test } from "./app.ts"
import { pointers, wrongPointers } from "./pointer.ts"

test("the pointer is the hand over everything that presses, on every screen", async ({ page }) => {
  const wrong: string[] = []
  const look = async (label: string) => wrong.push(...(await wrongPointers(page, label)))

  await openBandApp(page)
  await settled(page)
  await look("Start")

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const sections = page.getByRole("navigation", { name: "Settings sections" })
  for (const name of await sections.getByRole("button").allInnerTexts()) {
    await sections.getByRole("button", { name: name.trim(), exact: true }).click()
    await look(`Settings, ${name.trim()}`)
  }
  await sections.getByRole("button").first().click()
  await page.getByRole("combobox", { name: "Driver" }).first().click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await look("Settings, a list open")
  await page.keyboard.press("Escape")

  await page.goto("/")
  await page.getByRole("button", { name: "History", exact: true }).click()
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  await look("History, a rehearsal")
  await page.getByRole("radio", { name: "Songs", exact: true }).click()
  await page.getByRole("navigation", { name: "Songs" }).locator("[data-song]").first().click()
  await look("History, a song")
  await page.getByRole("radio", { name: "Marks", exact: true }).click()
  await look("History, Marks")
  await page.getByRole("radio", { name: "Rehearsals", exact: true }).click()
  await takeButton(overview, "Pałyn #4").click()
  await expect(page.getByRole("group", { name: "Take timeline" })).toBeVisible()
  await look("History, a take open")

  await page.goto("/")
  // The band's evening goes on from its own takes, so Record is not the first take's.
  await startButton(page).click()
  await expect(recordButton(page)).toBeVisible()
  await settled(page)
  await look("Rehearsal")
  await recordButton(page).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(closeTakeButton(page)).toBeVisible()
  await settled(page)
  await look("Rehearsal, a take open")

  expect(wrong).toEqual([])
})

test("the check finds the hand on what cannot be pressed, and on a handle that keeps its own", async ({ page }) => {
  await openBandApp(page)
  await settled(page)
  await page.evaluate(() => {
    const box = document.createElement("div")
    box.style.cssText = "position:fixed;left:0;top:0;z-index:99999;display:flex;gap:8px;padding:8px;background:white"
    box.innerHTML = [
      "<button disabled>Off</button>",
      '<button aria-disabled="true">Not now</button>',
      '<button class="cursor-grab">Drag</button>',
      '<button style="cursor:default">Arrow</button>',
      '<button disabled style="cursor:pointer">Off with the hand</button>',
      '<span style="cursor:pointer"><button disabled style="pointer-events:none">Off in a hand</button></span>',
      '<button class="cursor-grab" style="cursor:pointer">Drag with the hand</button>',
    ].join("")
    document.body.append(box)
  })
  expect((await page.evaluate(pointers)).wrong).toEqual([
    'button "Arrow": default',
    'button "Off with the hand": pointer',
    'button "Off in a hand": pointer',
    'button "Drag with the hand": pointer',
  ])
})
