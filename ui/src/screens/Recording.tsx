import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { FooterRow } from "@/components/FooterRow"
import { HealthLine } from "@/components/HealthLine"
import { Shell } from "@/components/Shell"
import { StopTake } from "@/components/StopTake"
import { CountIn } from "@/components/metronome/CountIn"
import { EdgeLight } from "@/components/metronome/EdgeLight"
import { TakeRow } from "@/components/metronome/TakeRow"
import { GoTitle } from "@/components/TakeTitle"
import { TrackTile } from "@/components/TrackTile"
import { Progress } from "@/components/ui/progress"
import { useAfter } from "@/hooks/useAfter"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useMetronome } from "@/hooks/useMetronome"
import { useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  poll as pollPython,
  type LastAttempt,
  type MidiActivity,
  type PendingTake,
  type RecordingHealth,
  type PlacedTrack,
} from "@/lib/api"
import { formatClock, formatDate, formatMMSS } from "@/lib/format"
import { fallBack, isSilent, watchStep, type TrackWatch } from "@/lib/levels"
import { accentOf } from "@/lib/metronome"
import { recordsAudio, recordsNotes } from "@/lib/midi"
import { portBusyText, portGoneText } from "@/lib/midiPorts"
import { useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"
import { cn } from "@/lib/utils"

// The capture block is ~21 ms, so the meters can update often; Python returns
// the peak accumulated since the last poll, so spikes are not lost.
const LEVELS_POLL_MS = 70
// Often enough that the clock turns 0:01 within a tenth of a second of the
// second, counted from the count-in's end.
const TIMER_TICK_MS = 100
// How long the clock waits to hear whether the take counts in, at most:
// past that it counts from Record, as with no click.
const COUNT_IN_WAIT_MS = 1000
// Disk space and stream health — every couple of seconds, not a hot path.
const HEALTH_POLL_MS = 2000
// The slot this screen's notice takes: why a take stopped by itself.
const SAID = "recording"
// The slot a failed Stop says so in. Its own: SAID holds why the take stopped
// by itself, and the Stop that follows it can fail as well; both are said.
const ERROR = "recording-error"
// The clock is as big as the window's height allows, and the take's name
// over it half that, so the two read from the same distance.
const CLOCK_SIZE = "clamp(4rem, 19vh, 9.5rem)"
/** The size the fit sets (--clock, see Recording), or the window's. */
const CLOCK = `var(--clock, ${CLOCK_SIZE})`
/** How far the clock gives way for the tiles, at most. */
const CLOCK_FLOOR_REM = 3
/** How far the tiles give way after it, from their 12.5rem: the 6rem they
 *  had before. */
const TILE_FLOOR_REM = 6
/** The widest the clock reads in a take under 100 h: eight tabular figures,
 *  as wide as any of 10:00:00 to 99:59:59. */
const CLOCK_WIDEST = "10:00:00"

/** What a track that takes notes is showing: where its fill stands (the
 *  loudest note lately, falling back between notes as a meter does), how many
 *  notes this take, whether its port is plugged in, and whether another app
 *  holds it, which reads as not plugged in too. */
type NoteWatch = { vel: number; notes: number; connected: boolean; inUse: boolean }

/**
 * The tracks' notes after one more poll. Python gives the loudest note since
 * the last poll, so the fill is the meter's rise and fall back, in the same
 * time as the levels'.
 */
function noteStep(
  prev: { at: number; tracks: Record<string, NoteWatch> } | null,
  next: MidiActivity,
  now: number
) {
  const since = prev ? now - prev.at : 0
  return {
    at: now,
    tracks: Object.fromEntries(
      Object.entries(next).map(([name, a]) => [
        name,
        {
          vel: fallBack(prev?.tracks[name]?.vel ?? 0, a.vel, since),
          notes: a.notes,
          connected: a.connected,
          inUse: a.state === "in_use",
        },
      ])
    ),
  }
}

/**
 * The take while it records, laid out to be read from behind the kit: nobody
 * stands at the laptop while they play. Two groups and a footer, with no
 * header (Q1, «Статус у Stop»): the take, what is being recorded, big, over a
 * big clock, and how far into the song the band is against the last go at
 * it; then a tile per track that lights up with its level and turns red if
 * it clips. Recording, the take's number and the disk line are in the
 * footer, just left of Stop, and the metronome's row at its far left, as on
 * the rehearsal screen (q14, «Слева, как было»). Running out of disk is said
 * where the free space always is.
 *
 * A take with the click counts in first: the bar's clicks, big, in the
 * clock's place; the clock starts at the count-in's end, and the window's
 * edge lights on every click from there to Stop.
 *
 * A track on Both has a column of notes beside its levels, and one on MIDI
 * alone a tile of its own. Their notes are polled with the levels.
 */
export function Recording({
  takeNumber,
  takeName,
  takeGo,
  tracks,
  lastAttempt,
  onStopped,
  onSaveFailed,
}: {
  takeNumber: number
  takeName: string
  takeGo: number | null
  tracks: PlacedTrack[]
  /** The last go at this take's song, to measure this one against. */
  lastAttempt?: LastAttempt | null
  onSaveFailed?: (error: string, take: PendingTake | null) => Promise<void>
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
  // Null until Python has answered once: a tile does not say "not connected"
  // for the moment before it is known.
  const [noted, setNoted] = useState<{ at: number; tracks: Record<string, NoteWatch> } | null>(
    null
  )
  const takesNotes = tracks.some(recordsNotes)
  const [stopping, setStopping] = useState(false)
  const [health, setHealth] = useState<RecordingHealth | null>(null)
  // When Record was pressed, on the page's clock, as the metronome's times
  // are: a take with no click counts from here.
  const startedAt = useRef(performance.now())
  const stopRef = useRef<() => Promise<void>>(async () => {})
  // Turning every raw track into a .wav takes real seconds on a long take.
  const saving = useRunning("stop")

  // A new take is recording: why the last one stopped by itself no longer
  // stands, and "Recording stopped" over a take that is recording is wrong.
  useEffect(() => dismiss(SAID), [])
  // An error Stop said is about this take, and goes with the screen.
  const sayError = useErrorNotice(ERROR)

  // Nothing moves while a take is recording (spec F11): <html> says so for
  // the stylesheet and for motionOff(), and stops saying so when this screen
  // is gone. Before the first paint and after the last, so that no frame
  // starts an animation the attribute would have stopped.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-recording", "")
    return () => document.documentElement.removeAttribute("data-recording")
  }, [])

  // The click: the count-in in the clock's place, then the edge lit on
  // every click, and its row at the footer's left. A take with the click is
  // timed from the count-in's end, which is where its files' bars start; the
  // clock is not shown until it is known whether there is one.
  const metronome = useMetronome()
  const beat = metronome.state
  const waited = useAfter(true, COUNT_IN_WAIT_MS)
  const known = beat !== null || waited
  const counting = beat?.phase === "count" && metronome.countInEnd !== null
  const countInEnd = useRef<number | null>(null)
  useLayoutEffect(() => {
    countInEnd.current = metronome.countInEnd
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      const from = countInEnd.current ?? startedAt.current
      setElapsed(Math.max(0, (performance.now() - from) / 1000))
    }, TIMER_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    let timeout = 0

    // Poll in a chain rather than on an interval: if the bridge stalls, the
    // requests will not pile up on each other. The notes come with the
    // levels, and only for a band that has any, so that a Both tile's two
    // halves move together. The bridge can blink: a call that fails leaves
    // its half of the screen as it was for this tick.
    const poll = async () => {
      const [levelsNow, notesNow] = await Promise.allSettled([
        pollPython("get_levels"),
        takesNotes ? pollPython("midi_activity") : Promise.resolve(null),
      ])
      if (alive) {
        const now = Date.now()
        if (levelsNow.status === "fulfilled") {
          const next = levelsNow.value
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
        if (notesNow.status === "fulfilled" && notesNow.value) {
          const next = notesNow.value
          setNoted((prev) => noteStep(prev, next, now))
        }
      }
      if (alive) timeout = window.setTimeout(poll, LEVELS_POLL_MS)
    }
    poll()

    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [takesNotes])

  const switchClick = async (on: boolean) => {
    const res = await api().metronome_set_on(on)
    if (!res.ok) sayError(res.error || "Could not switch the click")
    await metronome.refresh()
  }

  const stop = async () => {
    if (stopping) return
    setStopping(true)
    dismiss(ERROR)
    const res = await watching(api().control_command("stop_review"))
    if (!res.ok) {
      setStopping(false)
      const message = res.error || "Could not save the recording"
      if (res.transport?.state === "error" && onSaveFailed) await onSaveFailed(message, res.transport.pending_take)
      else sayError(message)
      return
    }
    onStopped(res as unknown as PendingTake)
  }
  stopRef.current = stop

  useSpacebar(stop, !stopping)

  // A take nobody named is "Take 3" big, the sign that a name was forgotten,
  // and the number by Stop would only say it again.
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

  const column = useRef<HTMLDivElement>(null)
  const nameAndClock = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLDivElement>(null)

  // What gives way in a window too short for everything, fitted as the
  // screen comes up and again only when the window, the scale or the name's
  // lines change; nothing in it changes while a take records, so it never
  // moves anything mid-take. Each fit starts from the window's sizes:
  // 1. The clock grows to the left from where "0:00" ends, so it is never
  //    bigger than lets its widest reading, 10:00:00, start inside the
  //    screen's air.
  // 2. While the tiles reach past the screen's bottom, the clock gives way,
  //    and the take's name over it with it (half its size), down to 3rem.
  // 3. Then the tiles' least height gives way, from 12.5rem down to 6rem.
  // Only past that does the screen scroll.
  useLayoutEffect(() => {
    const el = column.current
    const main = el?.closest("main")
    if (!el || !main) return
    const fit = () => {
      const block = nameAndClock.current
      const tiles = tilesRef.current
      const clock = el.querySelector<HTMLElement>("[role=timer]")
      const widest = el.querySelector<HTMLElement>("[data-clock-widest]")
      if (!block || !tiles || !clock || !widest) return
      el.style.removeProperty("--clock")
      tiles.style.removeProperty("--tile-min")
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const size = () => parseFloat(getComputedStyle(clock).fontSize)

      // 1. At a size f, the clock's box is "0:00", a·f wide and centred, and
      //    the widest reading, b·f wide, ends at its right edge: it starts
      //    inside the air while f·(b − a/2) is no more than half the room.
      const px = size()
      const half = el.getBoundingClientRect().width / 2
      const a = clock.getBoundingClientRect().width / px
      const b = widest.getBoundingClientRect().width / px
      const cap = Math.floor((half / (b - a / 2)) * 10) / 10
      if (cap < px) el.style.setProperty("--clock", `${cap}px`)

      // How far the tiles' group reaches past the room the screen has for it,
      // as if the screen were not scrolled.
      const over = () => {
        const inside = parseFloat(getComputedStyle(tiles).paddingBottom) || 0
        const low = Math.max(
          tiles.getBoundingClientRect().bottom,
          ...[...tiles.children].map((t) => t.getBoundingClientRect().bottom + inside)
        )
        const room =
          main.getBoundingClientRect().top +
          main.clientHeight -
          parseFloat(getComputedStyle(main).paddingBottom)
        return low + main.scrollTop - room
      }

      // 2. The name and the clock get smaller together, so the block they
      //    make is smaller by about as much as the tiles are over.
      const clockFloor = CLOCK_FLOOR_REM * rem
      for (let i = 0; i < 4; i++) {
        const by = over()
        const now = size()
        if (by <= 0.5 || now <= clockFloor + 0.5) break
        const next = Math.max(clockFloor, now * (1 - by / block.getBoundingClientRect().height) - 0.5)
        el.style.setProperty("--clock", `${next}px`)
      }

      // Steps that fell short of the room take the clock the rest of the
      // way: the tiles give way only once it is at its floor.
      if (over() > 0.5 && size() > clockFloor + 0.5)
        el.style.setProperty("--clock", `${clockFloor}px`)

      // 3. The tiles stand at their least height when they reach past it.
      const by = over()
      const first = tiles.firstElementChild
      if (by > 0.5 && first) {
        const least = parseFloat(getComputedStyle(first).minHeight)
        tiles.style.setProperty("--tile-min", `${Math.max(TILE_FLOOR_REM * rem, least - by)}px`)
      }
    }
    fit()
    // The window and the scale, and the name once it has settled on its lines.
    const watch = new ResizeObserver(fit)
    watch.observe(main)
    if (nameAndClock.current) watch.observe(nameAndClock.current)
    return () => watch.disconnect()
  }, [])

  // Recording, as written: no capitals by CSS.
  const recordingLine = (
    <div data-recording-line className="flex items-center gap-2 text-sm">
      {/* Still, as nothing else here moves either (F11): a pulse in the
          corner draws the eye from across the room. */}
      <span className="flex size-2.5 shrink-0 rounded-full bg-destructive" />
      <span className="font-semibold text-destructive">Recording</span>
      {named && <span className="text-muted-foreground">Take {takeNumber}</span>}
    </div>
  )

  // The status row, at the footer's right just left of Stop: Recording
  // over the disk line. The metronome's row has the footer's far left, as
  // on the rehearsal screen (q14, «Слева, как было»).
  const statusRow = (
    <div data-status-row className="flex min-w-0 flex-col items-start gap-2">
      {recordingLine}
      <HealthLine health={health} />
    </div>
  )

  const against = lastAttempt && lastAttempt.duration_sec > 0 && (
    <div data-against className="flex w-full max-w-xl flex-col gap-2">
      {/* The shared bar, in grey as it was, not the accent: it is not the
          main action or what plays. It is a reading, so it follows the clock
          with no transition of its own. */}
      <Progress
        value={Math.min(100, (elapsed / lastAttempt.duration_sec) * 100)}
        aria-label="Against the last take"
        aria-valuetext={`${formatMMSS(Math.min(elapsed, lastAttempt.duration_sec))} of ${formatMMSS(lastAttempt.duration_sec)}`}
        className="h-1.5 bg-muted [&>[data-slot=progress-indicator]]:bg-foreground/55 [&>[data-slot=progress-indicator]]:transition-none"
      />
      <div className="flex justify-between gap-4 text-sm text-muted-foreground">
        <span className="tnum">0:00</span>
        {/* The song is over the clock already. The first go of the evening
            is measured against the go before tonight (its newest ★ go, else
            the last at its latest rehearsal), and says which day that was. */}
        <span>
          Took {formatMMSS(lastAttempt.duration_sec)}{" "}
          {lastAttempt.created_at ? `on ${formatDate(lastAttempt.created_at)}` : "last time"}
        </span>
      </div>
    </div>
  )

  return (
    <Shell
      activity={false}
      // The start screen's air: 32 round the screen.
      air
      className="px-8 [--screen-pad-y:2rem]"
      footer={
        <FooterRow
          left={
            // The two give way together in a narrow window, each by its
            // own width, which nothing changes during a take: the row's
            // line and the disk line wrap, and neither moves the other.
            <div className="flex items-center gap-6">
              <div className="min-w-0 flex-1 basis-[24rem]">
                {beat && (
                  <TakeRow state={beat} lit={metronome.lit} onSwitch={(on) => void switchClick(on)} />
                )}
              </div>
              {statusRow}
            </div>
          }
        >
          <StopTake onStop={stop} stopping={stopping} saving={saving} />
        </FooterRow>
      }
    >
      <div ref={column} className="flex h-full min-h-0 flex-col items-center gap-12">
        {/* The take, one group: the name over the clock, and 24 under them
            the bar against the last take. */}
        <div data-take className="flex w-full flex-col items-center gap-6">
          {/* The name was the smallest thing here, grey in the corner, and it
              is what most often goes wrong: the band has moved on to another
              song and nobody changed it. Only shown — a field would invite a
              keypress, and Space stops the take. Up to two lines, then cut
              with the song's go kept, whole on hover; set before the take,
              so it never moves. */}
          <div ref={nameAndClock} className="flex w-full flex-col items-center gap-1">
            <h1
              className="flex w-full justify-center pb-[0.08em] leading-none font-semibold tracking-tight"
              // design-ok(px-text): half the clock's size, so it follows the window's height too
              style={{ fontSize: `calc(${CLOCK} / 2)` }}
            >
              <GoTitle title={takeName} go={takeGo} cut lines={2} />
            </h1>
            {/* The clock grows to the left. Its box is as wide as "0:00",
                centred under the name, and the figures stand at its right
                edge, so the seconds never move when it gains a figure (10:00,
                1:00:00). Digits stand on the baseline, and the room a line
                keeps under it for "g" and "y" is trimmed. The two unseen
                readings are drawn from an attribute, not written in the page:
                the clock's words are its reading alone. */}
            <div className="relative">
              <div
                role="timer"
                aria-label="Take time"
                className="relative leading-none font-semibold tracking-tight tnum [text-box:trim-end_cap_alphabetic]"
                // design-ok(px-text): the recording clock is sized from the window's height (CLOCK_SIZE)
                style={{ fontSize: CLOCK }}
              >
                <span aria-hidden data-text="0:00" className="invisible before:content-[attr(data-text)]" />
                {/* Unseen while the count-in stands in its place, and not
                    there until it is known whether the take counts in. */}
                {known && (
                  <span
                    data-clock
                    className={cn("absolute top-0 right-0 whitespace-nowrap", counting && "invisible")}
                  >
                    {formatClock(elapsed)}
                  </span>
                )}
                {/* The widest it can read, unseen, for the fit above. */}
                <span
                  aria-hidden
                  data-clock-widest
                  data-text={CLOCK_WIDEST}
                  className="pointer-events-none invisible absolute top-0 right-0 whitespace-nowrap before:content-[attr(data-text)]"
                />
              </div>
              {counting && beat && <CountIn count={beat.count} signature={beat.signature} size={CLOCK} />}
            </div>
          </div>
          {against}
        </div>

        {/* The tiles, one group on one fill, each tile's fill on a well of
            its own with 3 px of the group's round it («Волна на подложке»).
            Their least height is 12.5rem: the clock and the name give way
            first (the fit above). */}
        <div
          ref={tilesRef}
          data-tiles
          className="grid min-h-0 w-full flex-1 gap-1.5 rounded-xl bg-card p-[3px] [--tile-min:12.5rem]"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, tracks.length)}, minmax(0, 1fr))`,
          }}
        >
          {tracks.map((t) => {
            const seen = watch.tracks[t.name]
            const port = t.midi_port?.name ?? ""
            const watched = noted?.tracks[t.name]
            // Connected until Python has answered once: no reason before
            // that to say it is not.
            const heard = recordsNotes(t)
              ? {
                  vel: watched?.vel ?? 0,
                  notes: watched?.notes ?? 0,
                  connected: watched?.connected ?? !noted,
                  // What the tooltip says of a port that is not there, for a
                  // tile with no room for words (D7, P5). Held by another app
                  // it reads "not connected" as well, but plugging it in again
                  // will not help.
                  tip: !watched || watched.connected || !port
                    ? undefined
                    : watched.inUse
                      ? portBusyText(port)
                      : portGoneText(port, t.name),
                }
              : undefined
            if (heard && !recordsAudio(t))
              return (
                <TrackTile
                  key={t.name}
                  kind="notes"
                  name={t.name}
                  icon={t.icon}
                  port={port}
                  {...heard}
                />
              )
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
                midi={heard}
              />
            )
          })}
        </div>
      </div>
      <EdgeLight
        accent={
          beat?.phase === "take" && beat.on && metronome.lit !== null
            ? accentOf(beat.signature, metronome.lit)
            : null
        }
      />
    </Shell>
  )
}
