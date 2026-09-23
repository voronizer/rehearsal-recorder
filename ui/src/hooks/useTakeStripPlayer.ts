import { useEffect, useRef, useState } from "react"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { Take } from "@/lib/api"

/**
 * Selection for the take strip, plus the player it drives. Split out of
 * `TakeStrip.tsx` so that file only exports components — the hook and the
 * pills row were sharing a module for no reason but proximity.
 */
export function useTakeStripPlayer() {
  const [selected, setSelected] = useState<Take | null>(null)
  const player = useMultitrackPlayer(
    selected?.tracks ?? null,
    selected?.duration_sec ?? 0
  )

  // Nothing is open until somebody picks a take: opening a rehearsal should
  // not start reading audio files nobody asked for. Once one is open it
  // stays open — with a strip there is nothing to gain by emptying the
  // player, and the old rows only closed because they had to make room.
  const select = (take: Take | null) => setSelected(take)

  // Same setter as select() — kept as its own name because the call site is
  // "point the player at this take's fresh copy after a rename," not "the
  // user picked this take." selected only carries the player's identity
  // (which tracks to open); render code should read the take's fields off
  // the live `takes` array instead — see `liveTake` in TakeStrip.tsx.
  const reselect = select

  // Opening a take at a spot — a note in the rehearsal overview. The seek has
  // to wait for the take to be open: sent before, Python has no player to
  // seek and drops it. "Open" is loading having gone on and then off again,
  // because on the render that asks, loading is still false from before.
  const [pendingAt, setPendingAt] = useState<number | null>(null)
  const sawLoading = useRef(false)
  const { loading, loadError, seek } = player
  useEffect(() => {
    if (pendingAt === null) return
    if (loading) {
      sawLoading.current = true
      return
    }
    if (!sawLoading.current) return
    sawLoading.current = false
    if (!loadError) seek(pendingAt)
    setPendingAt(null)
  }, [pendingAt, loading, loadError, seek])

  const openAt = (take: Take, at: number) => {
    sawLoading.current = false
    setPendingAt(at)
    setSelected(take)
  }

  return { selected, select, reselect, openAt, player }
}
