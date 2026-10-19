import { calls, hold, letGo, expect, openApp, openHistory, startRehearsal, setFake, test } from "./app.ts"

test("external recording and stop/save navigate the recorder screens", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await startRehearsal(page)
  await page.evaluate(async () => {
    const win = window as unknown as { pywebview: { api: { control_command(a: string): Promise<unknown> } } }
    await win.pywebview.api.control_command("start")
  })
  await setFake(page, "__CONTROL_STATE__", {state:"recording", busy:false, error:null, pending_take:null,
    take_number:1, take_name:"Remote song", take_go:1, playback_take_number:null})
  await expect(page.getByRole("button", { name:/^Stop/ })).toBeVisible()
  await expect(page.getByRole("heading", {level:1})).toHaveText("Remote song 1")
  await page.evaluate(async () => {
    const win = window as unknown as { pywebview: { api: { control_command(a: string): Promise<unknown> } } }
    await win.pywebview.api.control_command("stop_keep")
  })
  await setFake(page, "__CONTROL_STATE__", null)
  await expect(page.getByRole("button", { name:/Record take 2/ })).toBeVisible()
})

test("Controls settings shows a disabled controller without opening ports", async ({ page }) => {
  await openApp(page)
  await page.getByRole("button", {name:"Settings", exact:true}).click()
  await page.getByRole("button", {name:"Controls", exact:true}).first().click()
  await expect(page.getByRole("combobox", {name:"Controller", exact:true})).toHaveText("Disabled")
  await expect(page.getByText("Controller disabled", {exact:true})).toBeVisible()
})

test("externally started and stopped rehearsals update the setup/rehearsal screens", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await page.evaluate(async () => {
    const w = window as unknown as { pywebview: { api: { start_rehearsal(...args: unknown[]): Promise<unknown> } } }
    await w.pywebview.api.start_rehearsal("Remote rehearsal", 0, 44100, [{ name: "Guitar", channel: 1 }], "pcm24")
  })
  await setFake(page, "__CONTROL_STATE__", { state:"ready", busy:false, rehearsal_active:true })
  await expect(page.getByRole("button", { name:/Record take 1/ })).toBeVisible()
  await page.evaluate(async () => {
    const w = window as unknown as { pywebview: { api: { finish_rehearsal(): Promise<unknown> } } }
    await w.pywebview.api.finish_rehearsal()
  })
  await setFake(page, "__CONTROL_STATE__", { state:"unavailable", busy:false, rehearsal_active:false })
  await expect(page.getByRole("button", { name:/Start rehearsal/ }).first()).toBeVisible()
})

test("external take removal offers Undo once", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await startRehearsal(page)
  await setFake(page, "__CONTROL_EVENTS__", [{ sequence:10, action:"remove_take", ok:true, undo:"controller-test-undo" }])
  await expect(page.getByText("Take removed", {exact:true})).toHaveCount(1)
  await page.waitForTimeout(750)
  await expect(page.getByText("Take removed", {exact:true})).toHaveCount(1)
})

test("starting a rehearsal remotely leaves History", async ({ page }) => {
  await openApp(page, { before: "window.__CONTROLLER_ENABLED__ = true;" })
  await openHistory(page)
  await page.evaluate(async () => {
    const w = window as unknown as { pywebview: { api: { control_command(a: string): Promise<unknown> } } }
    await w.pywebview.api.control_command("start_rehearsal")
  })
  await setFake(page, "__CONTROL_STATE__", { state:"ready", busy:false, rehearsal_active:true })
  await expect(page.getByRole("button", { name:/Record take 1/ })).toBeVisible()
})


test("control snapshots run only while a controller is configured", async ({ page }) => {
  await openApp(page)
  await expect.poll(async () => (await calls(page, "controller_state")).length).toBeGreaterThan(1)
  expect(await calls(page, "control_state")).toHaveLength(0)
  await setFake(page, "__CONTROLLER_ENABLED__", true)
  await expect.poll(async () => (await calls(page, "control_state")).length).toBeGreaterThan(1)
  await setFake(page, "__CONTROLLER_ENABLED__", false)
  const presenceChecks = (await calls(page, "controller_state")).length
  await expect.poll(async () => (await calls(page, "controller_state")).length).toBeGreaterThan(presenceChecks + 1)
  const snapshots = (await calls(page, "control_state")).length
  const nextChecks = (await calls(page, "controller_state")).length
  await expect.poll(async () => (await calls(page, "controller_state")).length).toBeGreaterThan(nextChecks)
  expect(await calls(page, "control_state")).toHaveLength(snapshots)
})


const controllerPorts = {
  system: "Fake MIDI",
  bluetooth_setup: true,
  inputs: [{ name: "Panel input", id: "panel-in" }],
  outputs: [{ name: "Panel output", id: "panel-out" }, { name: "Other output", id: "other-out" }],
}

async function controls(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Controls", exact: true }).first().click()
  await expect(page.getByRole("combobox", { name: "Controller", exact: true })).toBeEnabled()
}

test("picking a controller saves immediately and survives leaving Settings", async ({ page }) => {
  await openApp(page, { before: `window.__CONTROLLER_PORTS__ = ${JSON.stringify(controllerPorts)};` })
  await controls(page)
  await expect(page.getByRole("button", { name: "Apply controller" })).toHaveCount(0)
  await page.getByRole("combobox", { name: "Controller", exact: true }).click()
  await page.getByRole("option", { name: "Panel input", exact: true }).click()
  await expect(page.getByText("Controller ready", { exact: true })).toBeVisible()
  expect((await calls(page, "set_controller")).at(-1)?.args).toEqual([controllerPorts.inputs[0], null])
  await page.keyboard.press("Escape")
  await controls(page)
  await expect(page.getByRole("combobox", { name: "Controller", exact: true })).toHaveText("Panel input")
  await page.getByRole("combobox", { name: "Controller feedback output" }).click()
  await page.getByRole("option", { name: "Other output", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Controller feedback output" })).toHaveText("Other output")
  await expect.poll(async () => (await calls(page, "set_controller")).at(-1)?.args).toEqual([controllerPorts.inputs[0], controllerPorts.outputs[1]])
  await page.getByRole("combobox", { name: "Controller", exact: true }).click()
  await page.getByRole("option", { name: "Disabled", exact: true }).click()
  await expect(page.getByText("Controller disabled", { exact: true })).toBeVisible()
  expect((await calls(page, "set_controller")).at(-1)?.args).toEqual([null, null])
})

test("controller save failures use the Settings notice", async ({ page }) => {
  await openApp(page, { before: `window.__CONTROLLER_PORTS__ = ${JSON.stringify(controllerPorts)}; window.__CONTROLLER_SAVE_ERROR__ = 'Select the controller feedback output';` })
  await controls(page)
  await page.getByRole("combobox", { name: "Controller", exact: true }).click()
  await page.getByRole("option", { name: "Panel input", exact: true }).click()
  await expect(page.getByText("Select the controller feedback output", { exact: true })).toBeVisible()
  await setFake(page, "__CONTROLLER_SAVE_ERROR__", null)
  await page.getByRole("combobox", { name: "Controller feedback output" }).click()
  await page.getByRole("option", { name: "Other output", exact: true }).click()
  await expect(page.getByText("Controller ready", { exact: true })).toBeVisible()
  await expect(page.getByText("Select the controller feedback output", { exact: true })).toHaveCount(0)
})

test("Look again keeps its refresh icon for a second before the spinner", async ({ page }) => {
  await page.clock.install()
  await openApp(page)
  await controls(page)
  await hold(page, "controller_ports")
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  const look = page.getByRole("button", { name: "Look again" })
  await look.click()
  await expect(look).toBeDisabled()
  await expect(look.locator(".lucide-refresh-cw")).toBeVisible()
  await expect(look.getByRole("status", { name: "Loading" })).toHaveCount(0)
  await page.clock.runFor(999)
  await expect(look.locator(".lucide-refresh-cw")).toBeVisible()
  await expect(look.getByRole("status", { name: "Loading" })).toHaveCount(0)
  await page.clock.runFor(1)
  await expect(look.getByRole("status", { name: "Loading" })).toBeVisible()
  await page.clock.resume()
  await letGo(page, "controller_ports")
  await expect(look).toBeEnabled()
  await expect(look.locator(".lucide-refresh-cw")).toBeVisible()
})
