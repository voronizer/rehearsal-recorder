import worklet from "signalsmith-stretch?url"

/*
  A take at another speed keeps its key (#105; Alex's pick of 15 November
  2026, 13:33Z, after hearing two ways on his iPhone). The tracks play
  faster or slower on the clock, which moves the key with them, and this
  one node on the whole mix moves it back: Signalsmith Stretch (MIT), as
  WebAssembly on the sound's own thread, on live input.

  The library comes only when a speed other than 100% is first picked. The
  sound thread loads it as a file of the band's own address, which the
  pages' Content-Security-Policy allows (cloudflare/_headers); the
  library's own way, a `blob:` made from its text, it refuses.
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

/** The one stretch of this sound, made the first time it is asked for. */
export function stretchOf(context: BaseAudioContext): Promise<Stretch> {
  let stretch = made.get(context)
  if (!stretch) {
    stretch = (async () => {
      const { default: make } = await import("signalsmith-stretch")
      make.moduleUrl = worklet
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
