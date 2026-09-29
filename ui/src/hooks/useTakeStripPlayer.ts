import { useEffect, useRef, useState } from "react"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { Take } from "@/lib/api"

function sameTake(a: Take | null, b: Take | null): boolean {
  return a !== null && b !== null && a.take_number === b.take_number
}

/**
 * Selection for the take strip, plus the player it drives. Split out of
 * `TakeStrip.tsx` so that file only exports components — the hook and the
 * pills row were sharing a module for no reason but proximity.
 *
 * Two takes can be in hand. `selected` is open in the player, on screen.
 * `cued` is playing, or paused, in the rehearsal overview, with no player on
 * screen: Play on a row of the overview plays that take right there. One of
 * them at most is loaded, and it is always the same object while it stays
 * loaded — the player reopens whenever the `tracks` array it is given is a
 * different one, so handing it a fresh copy of the same take would stop the
 * music and start it again from nothing.
 */
export function useTakeStripPlayer() {
  const [selected, setSelected] = useState<Take | null>(null)
  const [cued, setCued] = useState<Take | null>(null)
  const loaded = selected ?? cued
  const player = useMultitrackPlayer(
    loaded?.tracks ?? null,
    loaded?.duration_sec ?? 0
  )

  // Nothing is open until somebody picks a take: opening a rehearsal should
  // not start reading audio files nobody asked for.
  //
  // Opening the take already playing in the overview keeps it playing, from
  // where it is. Going back to the overview keeps a take that is playing
  // playing there, and puts away one that is not — the overview is where the
  // rest of the takes are, not a place to leave a paused one hanging.
  const select = (take: Take | null) => {
    if (take === null) {
      setCued(player.playing ? selected : null)
      setSelected(null)
      return
    }
    setSelected(sameTake(take, loaded) ? loaded : take)
    setCued(null)
  }

  /** Nothing in hand any more: the rehearsal is being left. */
  const close = () => {
    setSelected(null)
    setCued(null)
  }

  /** The take playing in the overview is stopped and put away. */
  const uncue = () => setCued(null)

  // After a rename or a crop, the take in hand is pointed at its fresh copy:
  // its folder moved, or its files were rewritten. That is a new `tracks`
  // identity on purpose, and the player opens it again from zero. Only the
  // take it is about is touched.
  const reselect = (fresh: Take) => {
    setSelected((s) => (sameTake(s, fresh) ? fresh : s))
    setCued((c) => (sameTake(c, fresh) ? fresh : c))
  }

  /** A deleted take is let go of, wherever it was. */
  const forget = (takeNumber: number) => {
    setSelected((s) => (s?.take_number === takeNumber ? null : s))
    setCued((c) => (c?.take_number === takeNumber ? null : c))
  }

  // What to do once the take being opened is open: seek to a note in it, or
  // start playing it from the overview. Sent before, Python has no player to
  // act on and drops it. "Open" is loading having gone on and then off
  // again, because on the render that asks, loading is still false from
  // before.
  const [pending, setPending] = useState<{ at: number | null; play: boolean } | null>(null)
  const sawLoading = useRef(false)
  const { loading, loadError, seek, play } = player
  useEffect(() => {
    if (pending === null) return
    if (loading) {
      sawLoading.current = true
      return
    }
    if (!sawLoading.current) return
    sawLoading.current = false
    if (!loadError) {
      if (pending.at !== null) seek(pending.at)
      if (pending.play) play()
    }
    setPending(null)
  }, [pending, loading, loadError, seek, play])

  const whenOpen = (next: { at: number | null; play: boolean }) => {
    sawLoading.current = false
    setPending(next)
  }

  /** Opening a take at a spot — a note in the rehearsal overview. */
  const openAt = (take: Take, at: number) => {
    if (sameTake(take, loaded)) {
      select(take)
      seek(at)
      return
    }
    whenOpen({ at, play: false })
    select(take)
  }

  /** Play or pause a take from its row in the overview, without opening it. */
  const playInOverview = (take: Take) => {
    if (sameTake(take, loaded)) {
      player.toggle()
      return
    }
    whenOpen({ at: null, play: true })
    setCued(take)
  }

  return {
    selected,
    cued,
    select,
    close,
    uncue,
    reselect,
    forget,
    openAt,
    playInOverview,
    player,
  }
}
