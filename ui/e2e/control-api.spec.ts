import { calls, closeTakeButton, expect, openApp, startRehearsal, test, recordButton } from "./app.ts"

test("laptop Stop saves the take and opens it even with a controller configured", async ({ page }) => {
  await openApp(page, {before:"window.__CONTROLLER_ENABLED__ = true;"})
  await startRehearsal(page)
  await recordButton(page, 1).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(closeTakeButton(page)).toBeVisible()
  expect(await calls(page, "keep_take")).toHaveLength(1)
  expect((await calls(page, "control_command")).map(c => c.args[0])).toEqual(["start_rehearsal", "start", "stop_keep"])
})

test("an external stop-and-keep opens the take with a controller configured", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await startRehearsal(page)
  await recordButton(page, 1).click()
  await page.evaluate(async () => {
    const w = window as unknown as {pywebview:{api:{control_command(a:string):Promise<unknown>}}}
    await w.pywebview.api.control_command("stop_keep")
  })
  await expect(closeTakeButton(page)).toBeVisible()
  expect(await calls(page, "keep_take")).toHaveLength(1)
})

test("an external failed save opens Unsaved takes with a controller configured", async ({ page }) => {
  await openApp(page, {before:"window.__CONTROLLER_ENABLED__ = true; window.__FAIL__ = {keep_take:'Disk refused save'};"})
  await startRehearsal(page)
  await recordButton(page, 1).click()
  await page.evaluate(async () => {
    const w = window as unknown as {pywebview:{api:{control_command(a:string):Promise<unknown>}}}
    const result = await w.pywebview.api.control_command("stop_keep") as {transport:unknown}
    ;(window as unknown as {__CONTROL_STATE__:unknown}).__CONTROL_STATE__ = result.transport
  })
  await expect(page.getByRole("heading", { name: "Unsaved takes found" })).toBeVisible()
  await expect(page.getByText("Disk refused save", { exact: true })).toBeVisible()
})
