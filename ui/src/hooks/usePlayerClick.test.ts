import { describe, expect, it, vi } from "vitest"
import { askingPlayerClick, heardPlayerClick, playerClickOn, setPlayerClick } from "@/hooks/usePlayerClick"

// Python, as far as the switch reaches it: each answer is let go by the test.
const bridge = vi.hoisted(() => ({ player_set_click: vi.fn() }))
vi.mock("@/lib/api", () => ({ api: () => bridge }))

/** A call whose answer comes when the test says. */
function held() {
  let answer: (res: { ok: boolean; error?: string }) => void = () => {}
  bridge.player_set_click.mockReturnValueOnce(new Promise((done) => (answer = done)))
  return (res: { ok: boolean; error?: string }) => answer(res)
}

describe("the click with the take, as the player's polls say it", () => {
  it("is not flipped back by a poll asked before the change", async () => {
    heardPlayerClick(false, askingPlayerClick())
    const before = askingPlayerClick()
    const answer = held()
    const done = setPlayerClick(true)
    expect(playerClickOn()).toBe(true)
    // Asked before the press, answered after it: off, as it was then.
    heardPlayerClick(false, before)
    expect(playerClickOn()).toBe(true)
    // Asked while the change was on its way: not to be trusted either.
    const during = askingPlayerClick()
    answer({ ok: true })
    await done
    heardPlayerClick(false, during)
    expect(playerClickOn()).toBe(true)
    // Asked after Python answered: what it says is so.
    heardPlayerClick(false, askingPlayerClick())
    expect(playerClickOn()).toBe(false)
  })

  it("goes back as it was when Python refuses", async () => {
    heardPlayerClick(false, askingPlayerClick())
    const answer = held()
    const done = setPlayerClick(true)
    expect(playerClickOn()).toBe(true)
    answer({ ok: false, error: "No take is open" })
    expect(await done).toEqual({ ok: false, error: "No take is open" })
    expect(playerClickOn()).toBe(false)
  })
})
