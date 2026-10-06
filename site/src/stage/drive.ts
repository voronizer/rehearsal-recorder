// The app is driven from inside its frame the way a person would drive it:
// by its buttons' words and its fields. These are the hands.

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/**
 * What `find` returns once it is something, looking every 50 ms. Counted in
 * looks rather than time: a frame held off screen does not look, and should
 * not run out of time for it.
 */
export async function waitFor<T>(find: () => T | null | undefined | false, timeout = 10_000): Promise<T> {
  for (let looks = 0; looks < timeout / 50; looks++) {
    const found = find()
    if (found) return found
    await sleep(50)
  }
  throw new Error(`demo: waited ${timeout} ms in vain`)
}

/** A button's words, without the key some of them show ("Stop Space"). */
const words = (b: HTMLButtonElement) =>
  (b.textContent ?? "").replace(/\s*(Space|Esc|Enter|⏎)$/, "").trim()

export function button(text: string, exact = false): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (b) => !b.disabled && (exact ? words(b) === text : words(b).includes(text))
  )
}

export async function press(text: string, { exact = false } = {}): Promise<void> {
  ;(await waitFor(() => button(text, exact))).click()
}

export const hasText = (text: string) => document.body.innerText.includes(text)

/** Types into a field so that React hears it. */
export function fill(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Drags across the take's timeline, between two fractions of its width. */
export async function dragTimeline(from: number, to: number): Promise<void> {
  const timeline = await waitFor(() => document.querySelector('[aria-label="Take timeline"]'))
  const box = timeline.getBoundingClientRect()
  const y = box.top + box.height / 2
  const x0 = box.left + box.width * from
  const x1 = box.left + box.width * to
  const target = document.elementFromPoint(x0, y)
  if (!target) return
  const send = (type: string, x: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      })
    )
  send("pointerdown", x0)
  for (let i = 1; i <= 10; i++) {
    send("pointermove", x0 + ((x1 - x0) * i) / 10)
    await sleep(16)
  }
  send("pointerup", x1)
  await sleep(250)
}
