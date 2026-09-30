import { expect, test } from "@playwright/test"
import { openApp } from "./app.ts"

// Starting up: the window comes up before Python has, and has to cope with a
// bridge that is late, or never there at all.

test("waits for a bridge whose methods arrive after its ready event", async ({ page }) => {
  await openApp(page, {
    waitUntil: "domcontentloaded",
    // What pywebview actually does: the object appears at once, the methods
    // later, and the event can pass before the app mounts.
    after: `
      const realApi = window.pywebview.api;
      window.pywebview = { api: {} };
      window.dispatchEvent(new Event('pywebviewready'));
      setTimeout(() => { window.pywebview.api = realApi; }, 800);
    `,
  })
  await expect(page.getByRole("button", { name: /Start rehearsal/ })).toBeVisible()
})

test("shows the logo while it connects, and an error rather than a spinner for ever", async ({
  page,
}) => {
  // No fake at all: a bridge that is there and never answers.
  await page.clock.install()
  await page.addInitScript("window.pywebview = { api: {} };")
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByText("Connecting to the audio engine")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('img[src$="logo.svg"]')].some(
          (i) => i.complete && i.naturalWidth > 0
        )
      )
    )
    .toBe(true)
  await page.clock.fastForward("01:00")
  await expect(page.getByText("Could not reach the audio engine")).toBeVisible()
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible()
})

test("puts the chosen theme up before Python answers, and keeps it", async ({ context }) => {
  const warm = await context.newPage()
  await openApp(warm)
  await warm.getByRole("button", { name: "Settings" }).click()
  await warm.getByRole("button", { name: "Appearance", exact: true }).first().click()
  await warm.getByRole("button", { name: "Light", exact: true }).click()
  await expect(warm.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  )

  // The next window, with Python slow to say what the theme is.
  const page = await context.newPage()
  await openApp(page, {
    waitUntil: "domcontentloaded",
    after: `
      const real = window.pywebview.api.get_settings;
      window.pywebview.api.get_settings = async () => {
        await new Promise((r) => setTimeout(r, 600));
        return real();
      };
    `,
  })
  const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"))
  expect(await dark()).toBe(false)
  await expect(page.getByRole("button", { name: /Start rehearsal/ })).toBeVisible()
  expect(await dark()).toBe(false)
})
