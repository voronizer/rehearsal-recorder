import worklet from "signalsmith-stretch?url"

/*
  A take at another speed keeps its key (#105; Alex's pick of 15 November
  2026, 13:33Z, after hearing two ways on his iPhone). The tracks play
  faster or slower on the clock, which moves the key with them, and this
  one node on the whole mix moves it back: Signalsmith Stretch (MIT), as
  WebAssembly on the sound's own thread, on live input.

  The library comes only when a speed other than 100% is first picked:
  one file of the band's own address, which the page imports and the sound
  thread loads, as the pages' Content-Security-Policy allows
  (cloudflare/_headers). The library's own way, a `blob:` made from its
  text, it refuses. The sound thread is given the file here, not by the
  library, which would keep a failure for good: the next pick tries again.
*/

export type Stretch = {
  node: AudioNode
  /** Its own delay, in seconds of the clock: the sound comes out this much after it goes in. */
  latency: number
  /** Moves the key back for a take played at `rate` times its speed. */
  setRate(rate: number): void
}

/** The semitones that put back the key of a take played at `rate`: −12 at double speed, +12 at half. */
export const semitonesFor = (rate: number) => -12 * Math.log2(rate)

const made = new WeakMap<BaseAudioContext, Promise<Stretch>>()
/** The sounds whose thread has the library already: it cannot be given it twice. */
const given = new WeakSet<BaseAudioContext>()
let tries = 0

/** The one stretch of this sound, made the first time it is asked for. */
export function stretchOf(context: BaseAudioContext): Promise<Stretch> {
  let stretch = made.get(context)
  if (!stretch) {
    // A browser keeps a file that did not come as not there: another try asks under another address.
    const url = tries++ ? `${worklet}?try=${tries}` : worklet
    stretch = (async () => {
      const [{ default: make }] = await Promise.all([
        import(/* @vite-ignore */ url) as Promise<typeof import("signalsmith-stretch")>,
        given.has(context) || context.audioWorklet.addModule(url).then(() => given.add(context)),
      ])
      make.moduleUrl = url
      const node = await make(context)
      await node.start()
      const latency = await node.latency()
      return { node, latency, setRate: (rate: number) => void node.schedule({ semitones: semitonesFor(rate) }) }
    })()
    // One that could not be made is tried again the next time.
    stretch.catch(() => made.delete(context))
    made.set(context, stretch)
  }
  return stretch
}
