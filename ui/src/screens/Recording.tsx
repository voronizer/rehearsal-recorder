import { useEffect, useRef, useState } from "react"
import { CircleCheck, HardDrive, Square, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd, Shell } from "@/components/Shell"
import { TrackTile } from "@/components/TrackTile"
import { RunningLine } from "@/components/RunningLine"
import { useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  poll as pollPython,
  type LastAttempt,
  type PendingTake,
  type RecordingHealth,
  type PlacedTrack,
} from "@/lib/api"
import {
  aboutDuration,
  clippedLine,
  formatClock,
  formatMMSS,
  recordingLine,
} from "@/lib/format"
import {
  clipsInLastMinute,
  isSilent,
  watchStep,
  type TrackWatch,
} from "@/lib/levels"
import { useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"
import { cn } from "@/lib/utils"

// The capture block is ~21 ms, so the meters can update often; Python returns
// the peak accumulated since the last poll, so spikes are not lost.
const LEVELS_POLL_MS = 70
const TIMER_TICK_MS = 200
// Disk space and stream health — every couple of seconds, not a hot path.
const HEALTH_POLL_MS = 2000
// The slot this screen's notice takes: why a take stopped by itself.
const SAID = "recording"

/**
 * The take while it records, laid out to be read from behind the kit: nobody
 * stands at the laptop while they play. A big clock, how far into the song
 * the band is against the last go at it, one line that says what is wrong —
 * or that nothing is — and a tile per track that lights up with its level.
 */
export function Recording({
  takeNumber,
  takeName,
  tracks,
  lastAttempt,
  onStopped,
}: {
  takeNumber: number
  takeName: string
  tracks: PlacedTrack[]
  /** The last go at this take's song, to measure this one against. */
  lastAttempt?: LastAttempt | null
  onStopped: (take: PendingTake) => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<Record<string, number[]>>({})
  // What each track has been doing, kept across polls: a clip nobody saw
  // stays on screen for a minute. Stamped with the poll's own time, so the
  // tiles and the line agree about which clips are still in the minute.
  const [watch, setWatch] = useState<{
    at: number
    tracks: Record<string, TrackWatch>
  }>(() => ({ at: Date.now(), tracks: {} }))
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<RecordingHealth | null>(null)
  const startedAt = useRef(Date.now())
  const stopRef = useRef<() => Promise<void>>(async () => {})
  // Turning every raw track into a .wav takes real seconds on a long take.
  const saving = useRunning("stop")

  // A new take is recording: why the last one stopped by itself no longer
  // stands, and "Recording stopped" over a take that is recording is wrong.
  useEffect(() => dismiss(SAID), [])

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
        if (alive) {
          const now = Date.now()
          setLevels(next)
          setWatch((prev) => ({
            at: now,
            tracks: Object.fromEntries(
              Object.entries(next).map(([name, peaks]) => [
                name,
                watchStep(prev.tracks[name], peaks, now),
              ])
            ),
          }))
        }
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
    const res = await watching(api().stop_take())
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
        // so that everything recorded until this moment is saved. Said as a
        // notice, because the line above is about to leave with this screen
        // and a take that ended early with no reason given looks like a bug.
        if (h.recording && h.error) {
          alive = false
          notify({ key: SAID, kind: "warning", text: h.error })
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

  // The one line read from across the room. Running out of disk comes first:
  // it is what would end the take. A card that has gone is said up in the
  // corner instead, for the moment before the take stops itself.
  const clipped = tracks
    .map((t) => ({ name: t.name, clips: clipsInLastMinute(watch.tracks[t.name], watch.at) }))
    .filter((t) => t.clips > 0)
  const said: { kind: "space" | "clip" | "fine"; text: string } | null =
    health === null || health.error
      ? null
      : health.low_space
        ? { kind: "space", text: "Running out of space" }
        : clipped.length > 0
          ? { kind: "clip", text: clippedLine(clipped) }
          : { kind: "fine", text: recordingLine(tracks.length) }

  return (
    <Shell
      activity={false}
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
          {stopping ? (
            <RunningLine entry={saving} label="Saving the take" active />
          ) : (
            <p className="text-xs text-muted-foreground">autosaved every 30 s</p>
          )}
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col items-center gap-[2.5vh]">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <div className="flex items-center gap-2.5 text-sm">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
            </span>
            <span className="font-semibold tracking-wide text-destructive uppercase">
              Recording
            </span>
            <span className="text-muted-foreground">
              {/* "Take 3 · Take 3" for a take nobody has named yet says it twice */}
              {takeName === `Take ${takeNumber}`
                ? takeName
                : `Take ${takeNumber} · ${takeName}`}
            </span>
          </div>

          {/* Always there, not only when something is wrong: you should be
              able to see at a glance that the recording is healthy. */}
          <div
            className={cn(
              "flex items-center gap-2 text-xs",
              health?.error
                ? "text-destructive"
                : health?.low_space
                  ? "text-warn"
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
                Running out of space: {aboutDuration(health.minutes_left ?? 0)}{" "}
                left. Free some up or finish the rehearsal.
              </span>
            ) : (
              <span>
                Interface connected · room for{" "}
                {aboutDuration(health.minutes_left ?? 0)} more
              </span>
            )}
          </div>
        </div>

        <div
          role="timer"
          aria-label="Take time"
          className="leading-none font-semibold tracking-tight tabular-nums"
          style={{ fontSize: "clamp(4rem, 19vh, 9.5rem)" }}
        >
          {formatClock(elapsed)}
        </div>

        {lastAttempt && lastAttempt.duration_sec > 0 && (
          <div className="flex w-full max-w-xl flex-col gap-2">
            <div
              role="progressbar"
              aria-label="Against the last go"
              aria-valuemin={0}
              aria-valuemax={Math.round(lastAttempt.duration_sec)}
              aria-valuenow={Math.round(Math.min(elapsed, lastAttempt.duration_sec))}
              className="relative h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/55"
                style={{
                  width: `${Math.min(100, (elapsed / lastAttempt.duration_sec) * 100)}%`,
                }}
              />
            </div>
            <div className="flex justify-between gap-4 text-sm text-muted-foreground">
              <span className="tnum">0:00</span>
              <span>
                {lastAttempt.song} took {formatMMSS(lastAttempt.duration_sec)} last time
              </span>
            </div>
          </div>
        )}

        <div
          role="status"
          aria-label="Take status"
          className={cn(
            "inline-flex min-h-11 items-center gap-2.5 rounded-full border px-5 py-2 text-lg font-semibold",
            !said && "invisible",
            said?.kind === "fine" && "border-signal/45 bg-signal/10 text-signal",
            said?.kind === "clip" &&
              "border-destructive/50 bg-destructive/10 text-destructive",
            said?.kind === "space" && "border-warn/50 bg-warn/10 text-warn"
          )}
        >
          {said?.kind === "fine" ? (
            <CircleCheck className="size-5 shrink-0" />
          ) : (
            said && <TriangleAlert className="size-5 shrink-0" />
          )}
          {said?.text}
        </div>

        <div
          className="grid min-h-0 w-full flex-1 gap-[clamp(0.25rem,0.8vw,0.75rem)]"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, tracks.length)}, minmax(0, 1fr))`,
          }}
        >
          {tracks.map((t) => {
            const seen = watch.tracks[t.name]
            return (
              <TrackTile
                key={t.name}
                name={t.name}
                channel={t.channel}
                stereo={t.stereo}
                peaks={levels[t.name] ?? [0]}
                held={seen?.hold.map((h) => h.peak) ?? []}
                clips={clipsInLastMinute(seen, watch.at)}
                silent={isSilent(seen, watch.at)}
              />
            )
          })}
        </div>
      </div>
    </Shell>
  )
}
