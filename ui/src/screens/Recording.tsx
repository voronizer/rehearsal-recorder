import { useEffect, useRef, useState } from "react"
import { HardDrive, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd, Shell } from "@/components/Shell"
import { LevelMeter } from "@/components/LevelMeter"
import { useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  poll as pollPython,
  type PendingTake,
  type RecordingHealth,
  type PlacedTrack,
} from "@/lib/api"
import { formatDuration, formatHMS } from "@/lib/format"
import { cn } from "@/lib/utils"

// The capture block is ~21 ms, so the meters can update often; Python returns
// the peak accumulated since the last poll, so spikes are not lost.
const LEVELS_POLL_MS = 70
const TIMER_TICK_MS = 200
// Disk space and stream health — every couple of seconds, not a hot path.
const HEALTH_POLL_MS = 2000

export function Recording({
  takeNumber,
  takeName,
  tracks,
  onStopped,
}: {
  takeNumber: number
  takeName: string
  tracks: PlacedTrack[]
  onStopped: (take: PendingTake) => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<Record<string, number[]>>({})
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<RecordingHealth | null>(null)
  const startedAt = useRef(Date.now())
  const stopRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000)
    }, TIMER_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    let timeout = 0

    // Poll in a chain rather than on an interval: if the bridge stalls, the
    // requests will not pile up on each other.
    const poll = async () => {
      try {
        const next = await pollPython("get_levels")
        if (alive) setLevels(next)
      } catch {
        /* the bridge can blink — the meters just skip this tick */
      }
      if (alive) timeout = window.setTimeout(poll, LEVELS_POLL_MS)
    }
    poll()

    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [])

  const stop = async () => {
    if (stopping) return
    setStopping(true)
    const res = await api().stop_take()
    if (!res.ok) {
      setStopping(false)
      setError(("error" in res && res.error) || "Could not stop the recording")
      return
    }
    onStopped(res as PendingTake)
  }
  stopRef.current = stop

  useSpacebar(stop, !stopping)

  // Watch that the interface is still there and the disk is not filling up.
  useEffect(() => {
    let alive = true
    let timer = 0

    const poll = async () => {
      if (!alive) return
      try {
        const h = await pollPython("recording_health")
        if (!alive) return
        setHealth(h)
        // The interface went away — do not wait for a human, stop right now
        // so that everything recorded until this moment is saved.
        if (h.recording && h.error) {
          alive = false
          await stopRef.current()
          return
        }
      } catch {
        /* the bridge blinked — try again next time */
      }
      if (alive) timer = window.setTimeout(poll, HEALTH_POLL_MS)
    }
    // Ask once immediately so the status line is not empty at the start.
    poll()

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <Shell
      footer={
        <div className="flex flex-col items-center gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            size="xl"
            onClick={stop}
            disabled={stopping}
            aria-keyshortcuts="Space"
          >
            <Square className="fill-current" />
            Stop
            <Kbd>Space</Kbd>
          </Button>
          <p className="text-xs text-muted-foreground">autosaved every 30 s</p>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between gap-6 rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-3 rounded-full bg-destructive" />
            </span>
            <div>
              <div className="text-sm font-semibold tracking-wide text-destructive uppercase">
                Recording
              </div>
              <div className="text-xs text-muted-foreground">
                Take {takeNumber} · {takeName}
              </div>
            </div>
          </div>
          <div className="tnum text-4xl font-semibold">{formatHMS(elapsed)}</div>
        </div>

        {/* Always visible, not only when something is wrong: you should be
            able to see at a glance that the recording is healthy. */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs",
            health?.error
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : health?.low_space
                ? "border-warn/40 bg-warn/10 text-warn"
                : "text-muted-foreground"
          )}
        >
          <HardDrive className="size-3.5 shrink-0" />
          {health?.error ? (
            <span>{health.error}</span>
          ) : health === null ? (
            <span>Checking free space…</span>
          ) : health.low_space ? (
            <span>
              Running out of space: about {formatDuration(health.minutes_left ?? 0)}{" "}
              left. Free some up or finish the rehearsal.
            </span>
          ) : (
            <span>
              Interface connected · room for about{" "}
              {formatDuration(health.minutes_left ?? 0)} more
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {tracks.map((t) => (
            <LevelMeter
              key={t.name}
              name={t.name}
              channel={t.channel}
              stereo={t.stereo}
              peaks={levels[t.name] ?? [0]}
            />
          ))}
        </div>
      </div>
    </Shell>
  )
}
