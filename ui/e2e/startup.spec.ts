import { calls, expect, openApp, startButton, test } from "./app.ts"

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
  await expect(startButton(page)).toBeVisible()
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
  await expect(startButton(page)).toBeVisible()
  expect(await dark()).toBe(false)
})

test("offers unsaved takes before anything else, and moves on once one is recovered", async ({
  page,
}) => {
  await openApp(page, {
    before: `window.__DRAFTS__ = [{dir: '/rec/old/_drafts/take 1', name: 'take 1',
      tracks: ['Guitar', 'Vocals'], duration_sec: 95,
      rehearsal_folder: '/rec/old', rehearsal_name: 'Tuesday jam',
      created_at: '2026-09-10T19:00:00'}];`,
  })
  await expect(page.getByText("Unsaved takes found")).toBeVisible()
  // Which rehearsal it was from, and how long it is.
  await expect(page.getByText("Tuesday jam").first()).toBeVisible()
  await expect(page.getByText("1:35").first()).toBeVisible()
  await page.getByRole("button", { name: "Recover" }).click()
  await expect(startButton(page)).toBeVisible()
  expect(await calls(page, "recover_draft")).toHaveLength(1)
})
