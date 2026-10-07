import { useEffect, useRef, useState } from "react"
import { type Spot, useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { Take } from "@/lib/api"

/** Two copies of one take, within one rehearsal: a rename or a crop hands
 *  back a fresh copy under the same number, with its files moved. */
function byNumber(a: Take, b: Take): boolean {
  return a.take_number === b.take_number
}

/** The same take, when they come from several rehearsals, as on the setup
 *  screen: two rehearsals both have a take 2. Nothing is renamed there. */
export function byFiles(a: Take, b: Take): boolean {
  return a.take_number === b.take_number && a.tracks[0]?.file === b.tracks[0]?.file
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
export function useTakeStripPlayer<T extends Take = Take>(
  same: (a: T, b: T) => boolean = byNumber
) {
  const sameTake = (a: T | null, b: T | null) => a !== null && b !== null && same(a, b)
  const [selected, setSelected] = useState<T | null>(null)
  const [cued, setCued] = useState<T | null>(null)
  // Whether the strip's tabs are opened out into columns. They start shut
  // each time a take is opened from outside the player, and stay as they
  // are while goes are gone through inside it.
  const [expanded, setExpanded] = useState(false)
  const loaded = selected ?? cued
  const player = useMultitrackPlayer(
    loaded?.tracks ?? null,
    loaded?.duration_sec ?? 0
  )

  // What to do once the take being opened is open: seek to a note in it,
  // start playing it from the overview, or put back the place kept from
  // another go at the song. Sent before, Python has no player to act on and
  // drops it. "Open" is loading having gone on and then off again, because
  // on the render that asks, loading is still false from before.
  type Pending = { at: number | null; play: boolean; spot?: Spot }
  const [pending, setPending] = useState<Pending | null>(null)
  const sawLoading = useRef(false)
  const { loading, loadError, seek, play, restore } = player
  useEffect(() => {
    if (pending === null) return
    if (loading) {
      sawLoading.current = true
      return
    }
    if (!sawLoading.current) return
    sawLoading.current = false
    if (!loadError) {
      if (pending.spot) void restore(pending.spot)
      if (pending.at !== null) seek(pending.at)
      if (pending.play) play()
    }
    setPending(null)
  }, [pending, loading, loadError, seek, play, restore])

  const whenOpen = (next: Pending | null) => {
    sawLoading.current = false
    setPending(next)
  }
  const drop = () => whenOpen(null)

  // Nothing is open until somebody picks a take: opening a rehearsal should
  // not start reading audio files nobody asked for.
  //
  // Opening the take already playing in the overview keeps it playing, from
  // where it is. Going back to the overview keeps a take that is playing
  // playing there, and puts away one that is not — the overview is where the
  // rest of the takes are, not a place to leave a paused one hanging.
  //
  // Whatever was waiting for another take to open — a place carried from
  // the go before, a note — is let go of: it was asked for that take.
  const select = (take: T | null) => {
    if (take === null) {
      setCued(player.playing ? selected : null)
      setSelected(null)
      setExpanded(false)
      drop()
      return
    }
    if (selected === null) setExpanded(false)
    if (!sameTake(take, loaded)) drop()
    setSelected(sameTake(take, loaded) ? loaded : take)
    setCued(null)
  }

  /** Nothing in hand any more: the rehearsal is being left. */
  const close = () => {
    setSelected(null)
    setCued(null)
    setExpanded(false)
    drop()
  }

  /** The take playing in the overview is stopped and put away. */
  const uncue = () => setCued(null)

  // After a rename or a crop, the take in hand is pointed at its fresh copy:
  // its folder moved, or its files were rewritten. That is a new `tracks`
  // identity on purpose, and the player opens it again from zero. Only the
  // take it is about is touched: the one that is `was`, which is the fresh
  // copy itself unless the take changed what makes it the same (a
  // rehearsal renamed under a take that knows its rehearsal's folder).
  const reselect = (fresh: T, was: T = fresh) => {
    setSelected((s) => (sameTake(s, was) ? fresh : s))
    setCued((c) => (sameTake(c, was) ? fresh : c))
  }

  /** A deleted take is let go of, wherever it was. */
  const forget = (take: T) => {
    if (sameTake(selected, take) || sameTake(cued, take)) drop()
    setSelected((s) => (sameTake(s, take) ? null : s))
    setCued((c) => (sameTake(c, take) ? null : c))
  }

  /** Opening a take at a spot — a note in the rehearsal overview. */
  const openAt = (take: T, at: number) => {
    if (sameTake(take, loaded)) {
      select(take)
      seek(at)
      return
    }
    select(take)
    whenOpen({ at, play: false })
  }

  /**
   * Another go at the open song, at the same place: its row in the column,
   * or ↑ ↓. A second move before the first go has opened carries the first
   * one's place on, not the nothing the half-opened go has yet; so does a
   * move before a go opened at a note has, with the note's place.
   */
  const move = (take: T) => {
    if (sameTake(take, loaded)) return
    const note: Spot | null =
      pending && pending.at !== null
        ? { position: pending.at, region: null, looping: false, view: null, playing: pending.play }
        : null
    const spot = pending?.spot ?? note ?? player.spot()
    select(take)
    whenOpen({ at: null, play: false, spot })
  }

  /** Play or pause a take from its row in the overview, without opening it. */
  const playInOverview = (take: T) => {
    if (sameTake(take, loaded)) {
      player.toggle()
      return
    }
    whenOpen({ at: null, play: true })
    setCued(take)
  }

  /**
   * Play a take where it is from a spot in it, without opening it: a note
   * under one of the rehearsal screen's earlier goes plays from just before
   * it. The take already loaded is moved there; another is loaded first.
   */
  const cueAt = (take: T, at: number) => {
    if (sameTake(take, loaded)) {
      seek(at)
      play()
      return
    }
    whenOpen({ at, play: true })
    setCued(take)
  }

  return {
    selected,
    cued,
    expanded,
    setExpanded,
    select,
    close,
    uncue,
    reselect,
    forget,
    openAt,
    move,
    playInOverview,
    cueAt,
    player,
  }
}
