import { useEffect, useRef, useState } from "react"
import { FooterRow } from "@/components/FooterRow"
import { HealthLine } from "@/components/HealthLine"
import { Shell } from "@/components/Shell"
import { StopTake } from "@/components/StopTake"
import { GoTitle } from "@/components/TakeTitle"
import { TrackTile } from "@/components/TrackTile"
import { useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  poll as pollPython,
  type LastAttempt,
  type PendingTake,
  type RecordingHealth,
  type PlacedTrack,
} from "@/lib/api"
import { formatClock, formatDate, formatMMSS } from "@/lib/format"
import { isSilent, watchStep, type TrackWatch } from "@/lib/levels"
import { useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"

// The capture block is ~21 ms, so the meters can update often; Python returns
// the peak accumulated since the last poll, so spikes are not lost.
const LEVELS_POLL_MS = 70
const TIMER_TICK_MS = 200
// Disk space and stream health — every couple of seconds, not a hot path.
const HEALTH_POLL_MS = 2000
// The slot this screen's notice takes: why a take stopped by itself.
const SAID = "recording"
// The clock is as big as the window's height allows, and the take's name
// over it half that, so the two read from the same distance.
const CLOCK_SIZE = "clamp(4rem, 19vh, 9.5rem)"

/**
 * The take while it records, laid out to be read from behind the kit: nobody
 * stands at the laptop while they play. What is being recorded, big, over a
 * big clock; how far into the song the band is against the last go at it;
 * and a tile per track that lights up with its level and turns red if it
 * clips. Running out of disk is said where the free space always is.
 */
export function Recording({
  takeNumber,
  takeName,
  takeGo,
  tracks,
  lastAttempt,
  onStopped,
}: {
  takeNumber: number
  takeName: string
  takeGo: number | null
  tracks: PlacedTrack[]
  /** The last go at this take's song, to measure this one against. */
  lastAttempt?: LastAttempt | null
  onStopped: (take: PendingTake) => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<Record<string, number[]>>({})
  // What each track has been doing, kept across polls: a clip nobody saw
  // stays on its tile to the end of the take. Stamped with the poll's own
  // time, which is what a tile's silence is measured from.
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

  // A take nobody named is "Take 3" big, the sign that a name was forgotten,
  // and the number up top would only say it again.
  const named = takeName !== `Take ${takeNumber}`

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

  return (
    <Shell
      activity={false}
      footer={
        <FooterRow error={error}>
          <StopTake onStop={stop} stopping={stopping} saving={saving} />
        </FooterRow>
      }
    >
      <div className="flex h-full min-h-0 flex-col items-center gap-[2.5vh]">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <div data-recording-line className="flex items-center gap-2.5 text-sm">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
            </span>
            <span className="font-semibold tracking-wide text-destructive uppercase">
              Recording
            </span>
            {named && <span className="text-muted-foreground">Take {takeNumber}</span>}
          </div>

          <HealthLine health={health} />
        </div>

        {/* The name was the smallest thing here, grey in the corner, and it
            is what most often goes wrong: the band has moved on to another
            song and nobody changed it. Only shown — a field would invite a
            keypress, and Space stops the take. One line, cut short, so that
            a long name never pushes the clock or the tiles about. */}
        <div className="flex max-w-full flex-col items-center gap-1">
          <h1
            className="flex max-w-full pb-[0.08em] leading-none font-semibold tracking-tight"
            style={{ fontSize: `calc(${CLOCK_SIZE} / 2)` }}
          >
            <GoTitle title={takeName} go={takeGo} cut />
          </h1>
          {/* Digits stand on the baseline, and the room a line keeps under
              it for "g" and "y" was empty space that the tiles needed back
              for the name over the clock. Trimmed only below: above, it is
              the gap between the name and the digits. */}
          <div
            role="timer"
            aria-label="Take time"
            className="leading-none font-semibold tracking-tight tabular-nums [text-box:trim-end_cap_alphabetic]"
            style={{ fontSize: CLOCK_SIZE }}
          >
            {formatClock(elapsed)}
          </div>
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
              {/* The song is over the clock already. The first go of the
                  evening is measured against the go before tonight (its
                  newest ★ go, else the last at its latest rehearsal), and
                  says which day that was. */}
              <span>
                Took {formatMMSS(lastAttempt.duration_sec)}{" "}
                {lastAttempt.created_at ? `on ${formatDate(lastAttempt.created_at)}` : "last time"}
              </span>
            </div>
          </div>
        )}

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
                icon={t.icon}
                channel={t.channel}
                stereo={t.stereo}
                peaks={levels[t.name] ?? (t.stereo ? [0, 0] : [0])}
                shown={seen?.shown ?? []}
                held={seen?.hold.map((h) => h.peak) ?? []}
                clips={seen?.clips ?? 0}
                silent={isSilent(seen, watch.at)}
              />
            )
          })}
        </div>
      </div>
    </Shell>
  )
}
