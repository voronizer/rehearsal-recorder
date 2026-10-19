import { useEffect, useRef, useState } from "react"
import { api, type Signature } from "@/lib/api"
import { clampTempo } from "@/lib/metronome"
import { dismiss } from "@/lib/notices"

/** A take a tempo can be counted from: where it is, and its name. */
export type CountableTake = { folder: string; take_number: number; name: string }

/** What a count gave, for the song it was counted for: the take, and the
 *  number in the signature it was counted in. */
export type TempoCount = { song: string; take: CountableTake; tempo: number; signature: Signature }

/** How a count ended: set, left alone as the screen had moved on, or not
 *  counted, which the screen's notice says. */
export type CountEnd = "counted" | "dropped" | "failed"

/**
 * Counting a song's tempo from one of its takes (spec Parts 7 and 10), the
 * same on the rehearsal screen's row and on a song's page in History.
 *
 * Python counts, and the count is set as a tempo typed would be (`set`). It
 * is kept while the screen shows its number for its song (`shown`): a
 * signature picked then has the same take counted again in that signature,
 * since what a count is in 6/8 is the counter's to say, and the number kept
 * in the new signature's range shows meanwhile (`held`). Should that count
 * fail, the number stays, as with any other signature picked. Halving and
 * doubling (`mend`) keep the count's take.
 *
 * A count that comes back after the screen has moved on is dropped: after
 * a tempo was typed, tapped or stepped (`changed`, which the screen's `set`
 * calls), that is the band's tempo; after the song changed (`songNow`), it
 * is not the song's.
 */
export function useTempoCount(opts: {
  /** The song whose tempo the screen shows. */
  song: string | null
  /** The tempo and signature the screen shows, but for `held`. */
  tempo: number | null
  signature: Signature
  /** Sets a tempo as one typed is, and calls `changed`. */
  set: (tempo: number | null, signature: Signature) => Promise<unknown>
  /** The screen's notice, and its slot, put away as a count starts. */
  sayError: (text: string) => void
  said: string
  /** The song once a count has come back, when it may have changed. */
  songNow?: () => Promise<string | null>
}) {
  // The screen's latest, for a count that comes back after it has drawn again.
  const latest = useRef(opts)
  useEffect(() => {
    latest.current = opts
  })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [count, setCount] = useState<TempoCount | null>(null)
  const [counting, setCounting] = useState<{ song: string; take: string } | null>(null)
  const [held, setHeld] = useState<{ tempo: number; signature: Signature } | null>(null)
  // Each change of the number is counted: a count asked before the last
  // one is not put over it.
  const changes = useRef(0)

  const tempo = held?.tempo ?? opts.tempo
  const signature = held?.signature ?? opts.signature
  const shown =
    count && count.song === opts.song && count.tempo === tempo && count.signature === signature
      ? count
      : null

  /** A tempo or signature changed by hand: a count still out is dropped. */
  const changed = () => {
    changes.current += 1
    setHeld(null)
  }

  /** Counts the tempo from `take` in `sig`, for `forSong`, and sets it. */
  const countFrom = async (
    take: CountableTake,
    sig: Signature,
    forSong: string | null = opts.song
  ): Promise<CountEnd> => {
    if (forSong === null) return "dropped"
    const since = changes.current
    setCounting({ song: forSong, take: take.name })
    dismiss(opts.said)
    let res: { ok: boolean; error?: string; tempo?: number }
    try {
      res = await api().count_tempo(take.folder, take.take_number, sig)
    } catch {
      res = { ok: false }
    }
    const now = latest.current.songNow ? await latest.current.songNow() : latest.current.song
    if (!alive.current) return "dropped"
    setCounting((c) => (c?.song === forSong && c.take === take.name ? null : c))
    if (now !== forSong || changes.current !== since) {
      if (changes.current === since) setHeld(null)
      return "dropped"
    }
    if (!res.ok || res.tempo == null) {
      latest.current.sayError(res.error ?? "Could not count the tempo")
      return "failed"
    }
    setCount({ song: forSong, take, tempo: res.tempo, signature: sig })
    await latest.current.set(res.tempo, sig)
    return "counted"
  }

  /** A signature picked: the number kept, brought into its range, or the
   *  count's take counted again in it while a count is shown. */
  const pickSignature = async (sig: Signature) => {
    const kept = tempo === null ? null : clampTempo(tempo, sig)
    if (!shown || kept === null || sig === shown.signature) {
      await latest.current.set(kept, sig)
      return
    }
    changed()
    setHeld({ tempo: kept, signature: sig })
    if ((await countFrom(shown.take, sig, shown.song)) === "failed") await latest.current.set(kept, sig)
  }

  /** Halved or doubled, the count's mistake: still the count's, in the
   *  same signature. */
  const mend = async (by: number) => {
    if (tempo === null) return
    const next = clampTempo(tempo * by, signature)
    if (shown) setCount({ ...shown, tempo: next })
    await latest.current.set(next, signature)
  }

  return {
    /** The count the screen shows, or null. */
    shown,
    /** The take being counted from for the song shown, by name, or null. */
    counting: counting && counting.song === opts.song ? counting.take : null,
    /** A recount's number in its new signature, shown while it runs. */
    held,
    changed,
    countFrom,
    pickSignature,
    mend,
  }
}
