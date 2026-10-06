import { describe, expect, it } from "vitest"
import { createHold, type HoldWindow } from "./hold"

/** A window with a clock that moves only when told to, a frame every 16 ms. */
function fakeWindow() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void; every?: number }>()
  let frames = new Map<number, (t: number) => void>()
  const win: HoldWindow = {
    setTimeout: (fn, ms = 0, ...args) => {
      const id = nextId++
      timers.set(id, { at: now + ms, run: () => fn(...args) })
      return id
    },
    clearTimeout: (id) => void timers.delete(id),
    setInterval: (fn, ms = 0, ...args) => {
      const id = nextId++
      timers.set(id, { at: now + ms, run: () => fn(...args), every: ms })
      return id
    },
    requestAnimationFrame: (cb) => {
      const id = nextId++
      frames.set(id, cb)
      return id
    },
    cancelAnimationFrame: (id) => void frames.delete(id),
  }
  function advance(ms: number) {
    for (const end = now + ms; now < end; ) {
      now += 1
      for (const [id, t] of [...timers]) {
        if (t.at > now || !timers.has(id)) continue
        if (t.every) t.at += t.every
        else timers.delete(id)
        t.run()
      }
      if (now % 16 === 0) {
        const due = frames
        frames = new Map()
        for (const cb of due.values()) cb(now)
      }
    }
  }
  return { win, advance }
}

describe("createHold", () => {
  it("runs a timeout that came due while held when it is let go, once", () => {
    const { win, advance } = fakeWindow()
    const hold = createHold(win)
    let runs = 0
    win.setTimeout(() => runs++, 10)
    hold.hold(true)
    advance(50)
    expect(runs).toBe(0)
    hold.hold(false)
    expect(runs).toBe(1)
    advance(50)
    expect(runs).toBe(1)
  })

  it("does not run a timeout cleared while it waited", () => {
    const { win, advance } = fakeWindow()
    const hold = createHold(win)
    let runs = 0
    const id = win.setTimeout(() => runs++, 10)
    hold.hold(true)
    advance(50)
    win.clearTimeout(id)
    hold.hold(false)
    expect(runs).toBe(0)
  })

  it("skips an interval's ticks while held", () => {
    const { win, advance } = fakeWindow()
    const hold = createHold(win)
    let ticks = 0
    win.setInterval(() => ticks++, 10)
    advance(50)
    expect(ticks).toBe(5)
    hold.hold(true)
    advance(50)
    expect(ticks).toBe(5)
    hold.hold(false)
    advance(50)
    expect(ticks).toBe(10)
  })

  it("runs two frames asked for together on the same frame", () => {
    const { win, advance } = fakeWindow()
    createHold(win)
    let a = -1
    let b = -2
    win.requestAnimationFrame((t) => (a = t))
    win.requestAnimationFrame((t) => (b = t))
    advance(100)
    expect(a).toBeGreaterThan(0)
    expect(a).toBe(b)
  })

  it("runs a loop of frames no more than 24 times a second", () => {
    const { win, advance } = fakeWindow()
    createHold(win)
    const times: number[] = []
    const loop = (t: number) => {
      times.push(t)
      win.requestAnimationFrame(loop)
    }
    win.requestAnimationFrame(loop)
    advance(1000)
    expect(times.length).toBeLessThanOrEqual(24)
    expect(times.length).toBeGreaterThanOrEqual(18)
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000 / 24 - 1)
  })

  it("never runs a frame put off by the cap and then cancelled", () => {
    const { win, advance } = fakeWindow()
    createHold(win)
    win.requestAnimationFrame(() => {})
    advance(16)
    let ran = false
    const id = win.requestAnimationFrame(() => (ran = true))
    advance(16)
    win.cancelAnimationFrame(id)
    advance(100)
    expect(ran).toBe(false)
  })

  it("keeps frames asked for while held until it is let go", () => {
    const { win, advance } = fakeWindow()
    const hold = createHold(win)
    hold.hold(true)
    let ran = false
    let cancelledRan = false
    win.requestAnimationFrame(() => (ran = true))
    const id = win.requestAnimationFrame(() => (cancelledRan = true))
    advance(100)
    expect(ran).toBe(false)
    win.cancelAnimationFrame(id)
    hold.hold(false)
    advance(100)
    expect(ran).toBe(true)
    expect(cancelledRan).toBe(false)
  })

  it("says whether it is held", () => {
    const hold = createHold(fakeWindow().win)
    expect(hold.held()).toBe(false)
    hold.hold(true)
    expect(hold.held()).toBe(true)
  })
})
