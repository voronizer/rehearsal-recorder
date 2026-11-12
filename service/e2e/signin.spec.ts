import { expect, test } from "@playwright/test"
import { addMember, asMember, codeFor, confirm, signIn } from "./band"

const SENT = "If this address is in the band, a code is on its way"

test("sign in with a code, then the band asks for a name", async ({ page, request }) => {
  const owner = await asMember("alex")
  await addMember(owner, "hanna@example.com")
  await confirm(owner, "hanna@example.com")

  // A page asked for before signing in is where the member lands after.
  await page.goto("/trash")
  await expect(page).toHaveURL(/\/signin\?redirect=%2Ftrash/)
  await page.getByLabel("Email address").fill(" Hanna@Example.com ")
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByText(SENT)).toBeVisible()
  await page.getByLabel("Code").fill(await codeFor(request, "hanna@example.com"))
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page.getByRole("heading", { name: "What should the band call you?" })).toBeVisible()
  await page.getByLabel("Your name").fill("Hanna")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page).toHaveURL(/\/trash$/)
  await expect(page.getByRole("button", { name: "Hanna" })).toBeVisible()
})

test("an address not in the band gets the same answer", async ({ page, request }) => {
  await page.goto("/signin")
  await page.getByLabel("Email address").fill("stranger@example.com")
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByText(SENT)).toBeVisible()
  await expect(page.getByLabel("Code")).toBeVisible()
  const letters = (await (await request.get("/api/stand-ins/letters")).json()) as { to: string }[]
  expect(letters.filter((l) => l.to === "stranger@example.com")).toEqual([])
})

test("an unconfirmed address is told to confirm first", async ({ page }) => {
  const owner = await asMember("alex")
  await addMember(owner, "late@example.com")

  await page.goto("/signin")
  await page.getByLabel("Email address").fill("late@example.com")
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(
    page.getByText("First confirm your address: look for a letter from Cloudflare, then press Send code again")
  ).toBeVisible()
  await expect(page.getByLabel("Code")).toHaveCount(0)
})

test("a removed member is sent to sign-in", async ({ page }) => {
  const owner = await asMember("alex")
  const id = await addMember(owner, "gone@example.com")
  await confirm(owner, "gone@example.com")
  await signIn(page.request, "gone@example.com")
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "What should the band call you?" })).toBeVisible()

  expect((await owner.delete(`/api/members/${id}`)).ok()).toBe(true)
  await page.goto("/")
  await expect(page).toHaveURL(/\/signin/)
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible()
})

test("the code pasted whole fills the six boxes, and Sign in is still pressed", async ({ page, request }) => {
  const owner = await asMember("alex")
  await addMember(owner, "pasted@example.com")
  await confirm(owner, "pasted@example.com")

  await page.goto("/signin")
  await page.getByLabel("Email address").fill("pasted@example.com")
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByText(SENT)).toBeVisible()
  const code = await codeFor(request, "pasted@example.com")
  const field = page.getByLabel("Code")
  await field.focus()
  await field.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData("text/plain", text)
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  }, code)
  await expect(page.locator("[data-slot=input-otp-slot]")).toHaveText(code.split(""))
  await expect(field).toHaveValue(code)
  // Nothing signs in by itself.
  await expect(page).toHaveURL(/\/signin/)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "What should the band call you?" })).toBeVisible()
})

test("a wrong code is said under the boxes, and Sign in does not move", async ({ page }) => {
  await page.goto("/signin")
  await page.getByLabel("Email address").fill("nobody@example.com")
  await page.getByRole("button", { name: "Send code" }).click()
  await expect(page.getByText(SENT)).toBeVisible()
  const button = page.getByRole("button", { name: "Sign in" })
  const top = (await button.boundingBox())!.y
  await page.getByLabel("Code").fill("000000")
  await button.click()
  const alert = page.getByRole("alert")
  await expect(alert).toHaveText("This code does not work. Check it, or press Send code for a new one.")
  const boxes = (await page.locator("[data-slot=input-otp-slot]").first().boundingBox())!
  const said = (await alert.boundingBox())!
  expect(said.y).toBeGreaterThanOrEqual(boxes.y + boxes.height)
  // Its two lines fit the room kept for them.
  expect(said.y + said.height).toBeLessThanOrEqual((await button.boundingBox())!.y)
  expect((await button.boundingBox())!.y).toBe(top)
})
