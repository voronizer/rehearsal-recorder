// Out of sight, the app holds still: its timers and animation frames wait
// until the page brings it back, so a frame scrolled past costs nothing. On
// screen, its frames are spaced out: a playhead at two dozen frames a second
// looks the same on a page and costs a fraction of sixty.

// A timer's arguments are whatever its caller passes.
type Callback = (...args: any[]) => void

/** The part of a window this replaces. */
export type HoldWindow = {
  setTimeout: (fn: Callback, ms?: number, ...args: any[]) => number
  clearTimeout: (id: number) => void
  setInterval: (fn: Callback, ms?: number, ...args: any[]) => number
  requestAnimationFrame: (cb: (t: number) => void) => number
  cancelAnimationFrame: (id: number) => void
}

export type Hold = { hold(on: boolean): void; held(): boolean }

export function createHold(win: HoldWindow, fps = 24): Hold {
  const real = {
    setTimeout: win.setTimeout.bind(win),
    clearTimeout: win.clearTimeout.bind(win),
    setInterval: win.setInterval.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  }
  const gap = 1000 / fps
  let held = false

  // Timeouts that came due while held, by id, to run when let go.
  const dueTimeouts = new Map<number, () => void>()
  win.setTimeout = (fn, ms, ...args) => {
    if (typeof fn !== "function") return real.setTimeout(fn, ms, ...args)
    const id: number = real.setTimeout(() => {
      if (held) dueTimeouts.set(id, () => fn(...args))
      else fn(...args)
    }, ms)
    return id
  }
  win.clearTimeout = (id) => {
    dueTimeouts.delete(id)
    real.clearTimeout(id)
  }
  win.setInterval = (fn, ms, ...args) => {
    if (typeof fn !== "function") return real.setInterval(fn, ms, ...args)
    return real.setInterval(() => {
      if (!held) fn(...args)
    }, ms)
  }

  // Frames have ids of their own: one may be asked of the browser several
  // times over before it runs, put off by the cap or by a hold, and still be
  // cancelled by the id its caller was given.
  let nextFrame = 1
  let lastFrame = -Infinity
  let frameAt = -1
  const asked = new Map<number, number>() // our id -> the browser's
  const waiting = new Map<number, (t: number) => void>() // asked for while held
  const ask = (id: number, cb: (t: number) => void) => {
    const tick = (t: number) => {
      if (!asked.has(id)) return
      asked.delete(id)
      if (held) {
        waiting.set(id, cb)
        return
      }
      // Every frame asked for before a browser frame runs on it together.
      if (t !== frameAt) {
        if (t - lastFrame < gap - 1) {
          ask(id, cb)
          return
        }
        lastFrame = frameAt = t
      }
      cb(t)
    }
    asked.set(id, real.requestAnimationFrame(tick))
  }
  win.requestAnimationFrame = (cb) => {
    const id = nextFrame++
    ask(id, cb)
    return id
  }
  win.cancelAnimationFrame = (id) => {
    const browsers = asked.get(id)
    if (browsers !== undefined) real.cancelAnimationFrame(browsers)
    asked.delete(id)
    waiting.delete(id)
  }

  return {
    hold(on) {
      if (held === on) return
      held = on
      if (held) return
      const timeouts = [...dueTimeouts.values()]
      dueTimeouts.clear()
      const frames = [...waiting]
      waiting.clear()
      for (const run of timeouts) run()
      for (const [id, cb] of frames) ask(id, cb)
    },
    held: () => held,
  }
}
