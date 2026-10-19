import { Fragment, useEffect, useId, useRef, useState } from "react"
import { LaneControls, MasterControls } from "@/components/LaneControls"
import { MasterClick } from "@/components/metronome/MasterClick"
import { MasterClickLane } from "@/components/metronome/MasterClickLane"
import { RegionTag, type RegionCrop } from "@/components/RegionTag"
import { TakeMap } from "@/components/TakeMap"
import { Waveform } from "@/components/Waveform"
import { NotesLane } from "@/components/midi/NotesLane"
import { NotesPlate } from "@/components/midi/NotesPlate"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { labelLook, labelOf, useLabels } from "@/lib/labels"
import { laneOrder } from "@/lib/midi"
import type { TakeClick } from "@/lib/metronome"
import type { DriftView } from "@/lib/drift"
import { MIN_VIEW_SEC, tickTimes } from "@/lib/timeline"
import type { Marker, MissingNotes, NotesFile, TakeNotes } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

/** A press that never travelled this far is a click, and a click seeks. */
const DRAG_THRESHOLD_PX = 5
const GUTTER_PX = 200
/** The name row of 1rem, the fader's row of 1.25rem under it (the fader and
 *  its meter 1rem, M and S 1.25rem after it), 0.25rem apart, and 0.5rem above
 *  and below: 3.5rem, 56 px at the Appearance scale of 1. In rem because all
 *  of that is, and a row that stayed 56 px at 150 % left the name and the
 *  fader's row on top of each other. No taller than that: at 160 a lane's
 *  plate was mostly empty card, and at 96 five tracks took a laptop's screen
 *  and more. A lane of notes has neither, and is as tall as its plate needs
 *  instead. */
const LANE_REM = 3.5
const RULER_PX = 44
/** What a tick label needs to the right of its line: "10:00" at 12 px and
 *  its padding, with a little to spare. */
const TICK_LABEL_PX = 44
/** Between the ruler and the lanes group under it. */
const ROW_GAP_PX = 8
/** Between the track controls and the waveforms; the map above keeps it. */
const COLUMN_GAP_PX = 12
/** The lanes group's room right of the pictures, as a plate has 12 px left of
 *  its name. The ruler and the map above end there too, so the time axis is
 *  the same line all the way down, and the loop band, the marks and the
 *  playhead never reach the group's round corner.
 *
 *  It must be at least COLUMN_GAP_PX. The column gap before the last column
 *  (COLUMNS) gives the first COLUMN_GAP_PX of this room and the column the
 *  rest, END_PX - COLUMN_GAP_PX, 0 today: below 0 that is a width no grid
 *  column can have, and the template would be dropped whole. */
const END_PX = 12
/** The plates' column, the time axis, and the group's room after it. The
 *  grid round the ruler and every row of the lanes group lay their columns
 *  out by this one template, over the same width, so a waveform lies exactly
 *  under the ruler and the band drawn across them. */
const COLUMNS = `${GUTTER_PX}px minmax(0, 1fr) ${END_PX - COLUMN_GAP_PX}px`
/** How fast the wheel zooms. One notch of a mouse wheel is about 100 units,
 *  so this makes a notch a fifth of the window. */
const ZOOM_PER_PIXEL = 0.002

/**
 * Every track of the take on one time axis: a ruler, a lane each, and one
 * A–B band drawn through all of them. A track that took notes has a lane of
 * them too: right under its audio, sharing its well, for a Both track, and
 * where the band has it for a track that records MIDI only (lib/midi.ts
 * laneOrder).
 *
 * The lanes are one group (the owner, 2026-10-12: «и я бы дорожки сделал
 * одной группой»): one fill for every track's lane, its plate and its picture
 * side by side in a row, and no line between the rows. What tells one lane
 * from the next is its picture, a waveform or a lane of notes, each on a well
 * of its own (--well, 8 px corners) with 3 px of the group's fill
 * above and below it, so 6 px between two tracks' wells. A Both track's audio
 * and notes share one well, split by a 1 px line. The master is its own group
 * under them.
 *
 * This component is the only place that knows how an x position becomes a
 * second. That mapping used to be copied into every waveform, which is why
 * four tracks were four pictures that happened to be the same length rather
 * than one picture of one take.
 */
export function Timeline({
  player,
  markers = [],
  crop,
  notes,
  notesMissing,
  notesRead,
  take = null,
  drift = null,
}: {
  player: MultitrackPlayer
  /** The take's click, for Master's button and lane: its tempo and
   *  signature, and whether it was recorded to the click. */
  take?: TakeClick | null
  /** The band's tempo through the take, drawn along Master's lane. */
  drift?: DriftView | null
  markers?: Marker[]
  /** Crop, offered under the region's times, where the take can be cut. */
  crop?: RegionCrop
  /** The take's .mid files, and the tracks that took notes and have none. */
  notes?: NotesFile[]
  notesMissing?: MissingNotes[]
  /** What take_notes read back for each of them, by name; null while it
   *  reads. */
  notesRead?: Map<string, TakeNotes> | null
}) {
  const labels = useLabels()
  const surfaceId = useId()
  const { media, duration, position, region } = player
  const from = player.view?.from ?? 0
  const to = player.view?.to ?? duration
  const span = Math.max(0.001, to - from)
  // While the user is panning by hand during playback, the window does not
  // chase the playhead — it resumes when the playhead comes back into view.
  const followingRef = useRef(true)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<{
    fromX: number
    from: number
    toX: number
    to: number
  } | null>(null)
  // The live value of whichever edge (or the playhead) is currently grabbed.
  // It stays local while the pointer is down and is sent to Python exactly
  // once, on release — not on every move, which would fire dozens of racing
  // IPC round-trips whose answers can arrive back out of order.
  const [grab, setGrab] = useState<
    { which: "a" | "b" | "position"; at: number } | null
  >(null)

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The wheel on its own is the page's: it scrolls the tracks, over the
  // waveforms as over the names beside them. It used to zoom, and a page with
  // the tracks below the fold could not be scrolled from the middle of it.
  // Ctrl and the wheel zoom, and ⌘ and the wheel on a Mac; Shift and the
  // wheel, or sideways on a trackpad, move along the take. Those need a
  // non-passive listener: React's onWheel cannot preventDefault, and without
  // that the scroll container, or the page's own zoom, takes the gesture.
  const { setView } = player
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (duration <= 0) return
      const box = el.getBoundingClientRect()
      if (box.width === 0) return
      const zoom = e.ctrlKey || e.metaKey
      // Whichever axis carries the value, and that is not belt and braces:
      // Chromium leaves a shifted wheel in deltaY, while WebKit and Firefox
      // move it to deltaX and leave deltaY at zero — and WebKit is what this
      // app runs in on macOS, where reading deltaY would pan by nothing.
      const along = !zoom && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))
      if (!zoom && !along) return
      e.preventDefault()
      followingRef.current = false

      if (along) {
        const by = ((e.deltaX || e.deltaY) / box.width) * span
        setView(from + by, to + by)
        return
      }

      // Anchored zoom: the second under the pointer stays under the pointer.
      // A trackpad pinch arrives here too — the browser sends it as a wheel
      // event with ctrlKey set — and lands in this branch, which is what
      // stops it zooming the whole page instead.
      const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
      const anchor = from + ratio * span
      const next = Math.min(
        duration,
        Math.max(MIN_VIEW_SEC, span * Math.exp(e.deltaY * ZOOM_PER_PIXEL))
      )
      setView(anchor - ratio * next, anchor + (1 - ratio) * next)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [setView, duration, from, to, span])

  // Zoomed in, playback leaves the window within seconds. The window pages
  // forward rather than sliding, which is calmer to watch.
  useEffect(() => {
    if (!player.playing || !player.view) {
      followingRef.current = true
      return
    }
    if (position >= from && position <= to) {
      followingRef.current = true
      return
    }
    if (!followingRef.current) return
    setView(position - span / 8, position + (span * 7) / 8)
  }, [setView, player.playing, player.view, position, from, to, span])

  const secondsAt = (clientX: number) => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || duration <= 0) return 0
    const ratio = (clientX - box.left) / box.width
    return Math.min(duration, Math.max(0, from + ratio * span))
  }

  const pct = (seconds: number) =>
    duration > 0 ? ((seconds - from) / span) * 100 : 0

  const travelled = drag ? Math.abs(drag.toX - drag.fromX) : 0
  // While the pointer is down the band follows it; the committed region only
  // takes over once the drag is over.
  const freshLive =
    drag && travelled >= DRAG_THRESHOLD_PX
      ? { a: Math.min(drag.from, drag.to), b: Math.max(drag.from, drag.to) }
      : null
  // While an edge is being grabbed, the band tracks that edge's local value;
  // the region itself only commits once, on release (see finishPointer).
  const grabLive =
    grab?.which === "a"
      ? { a: grab.at, b: region.b ?? duration }
      : grab?.which === "b"
        ? { a: region.a ?? 0, b: grab.at }
        : null
  // The region is shown on the timeline as soon as either end is set, before
  // the repeat itself is switched on.
  const committed =
    region.a !== null || region.b !== null
      ? { a: region.a ?? 0, b: region.b ?? duration }
      : null
  const band = freshLive ?? grabLive ?? committed

  // The playhead follows the pointer while it is being dragged, and only
  // tells Python where it landed once the pointer is released.
  const displayPosition = grab?.which === "position" ? grab.at : position

  const onPointerDown = (e: React.PointerEvent) => {
    // Move already filters everything but the primary button (e.buttons !==
    // 1), but a right- or middle-click still reaches release with zero
    // travel, which finishPointer reads as a click and commits a seek.
    if (e.button !== 0) return
    if (duration <= 0) return
    surfaceRef.current?.setPointerCapture(e.pointerId)
    const at = secondsAt(e.clientX)
    setDrag({ fromX: e.clientX, from: at, toX: e.clientX, to: at })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // A second pointer's release can clear one piece of gesture state and
    // leave the other stranded (see finishPointer); without this guard a
    // stranded `drag`/`grab` would keep following the bare cursor on hover
    // and commit a region the next time anything is pressed.
    if (e.buttons !== 1) return
    if (grab) {
      const raw = secondsAt(e.clientX)
      // An edge dragged past its opposite stops there rather than turning
      // the region inside out, which is disorienting when you are watching
      // it.
      if (grab.which === "a") {
        setGrab({ ...grab, at: Math.min(raw, region.b ?? duration) })
      } else if (grab.which === "b") {
        setGrab({ ...grab, at: Math.max(raw, region.a ?? 0) })
      } else {
        setGrab({ ...grab, at: raw })
      }
      return
    }
    if (!drag) return
    setDrag({ ...drag, toX: e.clientX, to: secondsAt(e.clientX) })
  }

  // Committing happens exactly once, here — not on every move — so Python
  // sees one call per gesture instead of a burst of racing seeks or loop
  // updates whose answers could arrive back out of order.
  const finishPointer = () => {
    if (grab) {
      if (grab.which === "position") player.seek(grab.at)
      else if (grab.which === "a") player.setRegion(grab.at, region.b ?? duration)
      else player.setRegion(region.a ?? 0, grab.at)
    } else if (drag) {
      if (Math.abs(drag.toX - drag.fromX) < DRAG_THRESHOLD_PX) player.seek(drag.from)
      else player.setRegion(drag.from, drag.to)
    }
    setDrag(null)
    setGrab(null)
  }

  // A cancelled gesture (the browser taking a touch over for scrolling, most
  // often) commits nothing — the user didn't let go on purpose.
  const cancelPointer = () => {
    setDrag(null)
    setGrab(null)
  }

  const grabHandle = (which: "a" | "b" | "position") => (e: React.PointerEvent) => {
    e.stopPropagation()
    surfaceRef.current?.setPointerCapture(e.pointerId)
    const at =
      which === "a" ? (region.a ?? 0) : which === "b" ? (region.b ?? duration) : position
    setGrab({ which, at })
  }

  // The notes lanes come with the audio lanes, not before them: laid out
  // around nothing, they would move down the moment the audio arrived.
  const lanes = media.length > 0 ? laneOrder(media, notes ?? [], notesMissing ?? []) : []
  const rows = lanes.length
  const ticks = tickTimes(from, to, width)

  return (
    <>
      {/* Zoomed out too, the frame round all of it: a row that came and went
          with the zoom moved every track down the moment the wheel turned. */}
      {duration > 0 && (
        <TakeMap
          duration={duration}
          from={from}
          to={to}
          zoomed={player.view !== null}
          position={displayPosition}
          region={committed}
          closest={span <= MIN_VIEW_SEC + 0.01}
          gutterPx={GUTTER_PX}
          gapPx={COLUMN_GAP_PX}
          endPx={END_PX}
          controls={surfaceId}
          onMove={(a, b) => {
            // Moved by hand, the window stops chasing the playhead, as it
            // does for the wheel.
            followingRef.current = false
            setView(a, b)
          }}
          onWhole={player.resetView}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          className="grid min-h-0"
          style={{
            gridTemplateColumns: COLUMNS,
            // The ruler, and under it the lanes as one group, none before the
            // first track's media arrives (never, once loadError is set). The
            // group is as tall as its rows, and no row takes a share of what
            // is left, so two tracks in a tall window are two lanes of 3.5rem
            // and the room under them stays empty, which is honest about
            // there being room for more tracks.
            gridTemplateRows: rows > 0 ? `${RULER_PX}px auto` : `${RULER_PX}px`,
            gap: `${ROW_GAP_PX}px ${COLUMN_GAP_PX}px`,
          }}
        >
          {/* Every child below is placed explicitly. The surface (after the
              ruler) is also explicitly placed, spanning all of column 2 —
              leaving any other child to auto-place would make CSS grid skip
              that occupied column entirely and stack everything into column 1
              instead. */}
          <div
            className="flex items-end justify-between gap-2 pb-1 text-xs text-muted-foreground"
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            {/* Zoomed in, which part of the take is on screen is said by the
                map above, with Whole take beside it. */}
            <span>{band ? "Drag the edges" : "Drag across to loop"}</span>
          </div>

          <div
            role="group"
            aria-label="Timeline clock"
            className="relative border-b"
            style={{ gridColumn: 2, gridRow: 1 }}
          >
            {ticks.map((t) => (
              <Fragment key={t}>
                <span
                  className="absolute top-4 bottom-0 w-px bg-border"
                  style={{ left: `${pct(t)}%` }}
                />
                {/* A tick just short of the end has no room for its label on
                    the right, so it goes on the left of the line instead.
                    Left hanging past the edge, it widened the lanes' scroll
                    container — overflow-y: auto makes overflow-x auto too — and
                    a sideways scrollbar appeared under the last track. */}
                <span
                  className={cn(
                    "tnum absolute top-0 text-xs text-muted-foreground",
                    ((to - t) / (to - from)) * width < TICK_LABEL_PX
                      ? "-translate-x-full pr-1.5"
                      : "pl-1.5"
                  )}
                  style={{ left: `${pct(t)}%` }}
                >
                  {formatMMSS(t)}
                </span>
              </Fragment>
            ))}
          </div>

          {/* Before the lanes rather than after them, so Tab reaches Clear and
              Crop, at the top, before the tracks' faders and not between the
              last of them and the master. Drawn over the waveforms all the
              same: the z-index, not the order, puts it there. */}
          <div
            ref={surfaceRef}
            id={surfaceId}
            role="group"
            aria-label="Take timeline"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={cancelPointer}
            className="relative z-[1] cursor-crosshair overflow-hidden select-none"
            style={{ gridColumn: 2, gridRow: "1 / -1", touchAction: "none" }}
          >
            {band && (
              <span
                data-region
                className="pointer-events-none absolute border-x border-warn/60 bg-warn/10"
                style={{
                  left: `${pct(band.a)}%`,
                  width: `${pct(band.b) - pct(band.a)}%`,
                  top: RULER_PX,
                  bottom: 0,
                }}
              />
            )}

            {/* Only while the band actually overlaps the window — otherwise the
                rectangle is correctly clipped away by overflow-hidden, but the
                tag has nowhere honest to sit and would be left pinned to an
                edge, labelling a stretch of the take it has nothing to do
                with. Its Clear and Crop go with it. */}
            {band && band.b >= from && band.a <= to && (
              <RegionTag
                a={band.a}
                b={band.b}
                leftPx={(Math.max(0, pct(band.a)) / 100) * width + 8}
                topPx={RULER_PX + 6}
                roomPx={width}
                actions={band === committed}
                looping={player.looping}
                onToggleLoop={player.toggleLoop}
                onClear={player.clearRegion}
                crop={crop}
              />
            )}

            {markers
              .filter((m) => m.at >= from && m.at <= to)
              .map((m) => {
                const label = labelOf(labels, m.label_id)
                const colour = `var(${labelLook(label.colour).cssVar})`
                return (
                  <Fragment key={m.at}>
                    <span
                      className="pointer-events-none absolute w-0.5 opacity-60"
                      style={{ left: `${pct(m.at)}%`, top: RULER_PX, bottom: 0, background: colour }}
                    />
                    <span
                      data-marker-at={m.at}
                      data-colour={label.colour}
                      // design-ok(radius): the marker's diamond on the waveform, a graphic that keeps its own corner
                      className="pointer-events-none absolute size-2.5 -translate-x-1 rotate-45 rounded-[2px]"
                      style={{ left: `${pct(m.at)}%`, top: RULER_PX - 13, background: colour }}
                    />
                  </Fragment>
                )
              })}

            {/* The grab target lives entirely inside the ruler band, not down
                the whole lane height — a press anywhere on the tracks always
                starts a fresh region. The full-height band border above still
                marks the edge through the lanes; this is only where you take
                hold of it. The ruler's own height is this project's minimum
                touch target, and a higher z-index keeps it from losing presses
                to the playhead grip, which occupies the same band. Each handle
                only appears once its own end is actually set — a region with
                just an A has nothing to grab at B yet. */}
            {region.a !== null && (
              <span
                onPointerDown={grabHandle("a")}
                className="absolute z-10 flex w-4 -translate-x-2 cursor-ew-resize items-center justify-center"
                style={{ left: `${pct(region.a)}%`, top: 0, height: RULER_PX }}
              >
                <span className="h-11 w-1.5 rounded-full bg-warn" />
              </span>
            )}
            {region.b !== null && (
              <span
                onPointerDown={grabHandle("b")}
                className="absolute z-10 flex w-4 -translate-x-2 cursor-ew-resize items-center justify-center"
                style={{ left: `${pct(region.b)}%`, top: 0, height: RULER_PX }}
              >
                <span className="h-11 w-1.5 rounded-full bg-warn" />
              </span>
            )}

            <span
              className="pointer-events-none absolute w-0.5 bg-primary"
              style={{ left: `${pct(displayPosition)}%`, top: RULER_PX - 14, bottom: 0 }}
            />
            {/* Dragging the waveform used to scrub. That gesture now draws the
                region, so scrubbing gets a grip of its own rather than being
                quietly dropped. Local while held, same as the edges — see
                `displayPosition`. */}
            <span
              onPointerDown={grabHandle("position")}
              aria-hidden="true"
              className="absolute size-3 -translate-x-1.5 cursor-ew-resize rounded-full bg-primary"
              style={{ left: `${pct(displayPosition)}%`, top: RULER_PX - 20 }}
            />
          </div>

          {rows > 0 && (
            <div
              data-lanes
              className="flex flex-col rounded-lg bg-card"
              style={{ gridColumn: "1 / -1", gridRow: 2 }}
            >
              {lanes.map((lane, i) => {
                // A row of the group: the plate, the picture, and the group's
                // room after it, on the grid's own columns, with no line or
                // border. The picture's cell pads it 3 px from the row's
                // edges, so it sits on its well with the group's fill round
                // it. A Both track is its audio row and its notes row under
                // it: their two pictures touch, with nothing padding them
                // apart, and read as one well.
                if (lane.kind !== "audio") {
                  // A Both track's notes are the row under its audio: its
                  // plate says MIDI and has no name, the track's name being
                  // on the row above.
                  const before = lanes[i - 1]
                  const paired = before?.kind === "audio" && before.name === lane.name
                  const read = notesRead?.get(lane.name)
                  const port = lane.kind === "notes" ? lane.notes.port : lane.missing.port
                  // As tall as its plate, which a long name or port makes
                  // taller and which is never less than six drum rows' names
                  // and the well round them need (NotesPlate).
                  return (
                    <div
                      key={`notes:${lane.name}`}
                      data-lane-row={lane.name}
                      data-paired={paired || undefined}
                      className="grid"
                      style={{ gridTemplateColumns: COLUMNS, columnGap: COLUMN_GAP_PX }}
                    >
                      <NotesPlate
                        name={lane.name}
                        icon={read?.icon}
                        port={port}
                        paired={paired}
                        missing={lane.kind === "missing"}
                      />
                      <div className={cn("min-w-0", paired ? "pb-[3px]" : "py-[3px]")}>
                        {/* Its own well (NotesLane's rounded-md
                            bg-well); under its audio, the lower part
                            of the track's one well, under the line. */}
                        <NotesLane
                          name={lane.name}
                          data={read ?? null}
                          missing={lane.kind === "missing"}
                          duration={duration}
                          view={{ from, to }}
                          playhead={position}
                          className={cn("h-full", paired && "rounded-t-none border-t")}
                        />
                      </div>
                    </div>
                  )
                }
                const m = lane.track
                const after = lanes[i + 1]
                const paired = after !== undefined && after.kind !== "audio" && after.name === m.name
                const muted = player.isMuted(m.name)
                const soloed = player.isSoloed(m.name)
                const dimmed = muted || (player.hasSolo && !soloed)
                return (
                  <div
                    key={m.name}
                    data-lane-row={m.name}
                    className="grid"
                    style={{
                      gridTemplateColumns: COLUMNS,
                      columnGap: COLUMN_GAP_PX,
                      // 3.5rem, whatever its waveform's canvas was last drawn
                      // at: the one track of the row is the row's height and
                      // no more. Left to size itself, the row grew to the
                      // canvas, and the canvas to the row.
                      height: `${LANE_REM}rem`,
                      gridTemplateRows: "minmax(0, 1fr)",
                    }}
                  >
                    <div className="min-h-0">
                      <LaneControls
                        name={m.name}
                        icon={m.icon}
                        paired={paired}
                        channels={m.peaks.length}
                        muted={muted}
                        soloed={soloed}
                        dimmed={dimmed}
                        volume={player.getVolume(m.name)}
                        levels={player.getLevels(m.name)}
                        onToggleMute={() => player.toggleMute(m.name)}
                        onToggleSolo={() => player.toggleSolo(m.name)}
                        onVolume={(v) => player.setVolume(m.name, v)}
                        onVolumeCommit={player.persistVolumes}
                      />
                    </div>

                    <div data-lane={m.name} className={cn("min-w-0", paired ? "pt-[3px]" : "py-[3px]")}>
                      {/* On its well (Waveform's own rounded-md
                          bg-well), 50 px in the 56; above its notes,
                          the upper part of the track's one well. */}
                      <Waveform
                        peaks={m.peaks}
                        peaksFrom={player.peaksWindow.from}
                        peaksTo={player.peaksWindow.to}
                        viewFrom={from}
                        viewTo={to}
                        position={position}
                        dimmed={dimmed}
                        className={cn("h-full", paired && "rounded-b-none", dimmed && "opacity-60")}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* The desk's master, under the tracks' faders, its plate as wide as
          theirs. It is outside the box above, whose overflow would make that
          box the one it sticks in — a box that never scrolls; the page does.
          Here it holds to the bottom of the window while the page scrolls the
          tracks under it, and with eight of them in a small window the master
          is still where the hand goes for it.

          Held to the very edge of the page, not the edge of its padding
          (Shell's --screen-pad-y): stuck at that, it left a strip of the next
          track showing beneath it. Its own padding and background cover the
          rest, and the negative margin gives the gap it adds back in the
          flow.

          It is not a row of the lanes group above but a group of its own
          under it, with its own fill: it is the sum of the lanes, not one of
          them, and it is the one that sticks. Its band is as wide as the
          lanes, plates and pictures, in the page's colour: stuck, the lanes
          slide under all of it, and no part of a lane shows beside the
          master or under it.

          The group is a row as a track's is (Q11 D): the plate, and right
          of it the click's lane, on the same columns and on a well 3 px in
          from the group's edges, so its stripes stand under the tracks'
          pictures over the same seconds. It follows the zoom and the region
          as they do, and a drag across it sets the region (spec Part 8). */}
      {rows > 0 && (
        <div
          data-master-band
          className="sticky z-10 -mt-1 -mb-2 bg-background pt-1 pb-2"
          style={{ bottom: "calc(-1 * var(--screen-pad-y))" }}
        >
          <div
            data-master-group
            className="grid rounded-lg bg-card"
            style={{
              gridTemplateColumns: COLUMNS,
              columnGap: COLUMN_GAP_PX,
              height: `${LANE_REM}rem`,
              gridTemplateRows: "minmax(0, 1fr)",
            }}
          >
            <div className="min-h-0">
              <MasterControls
                grouped
                volume={player.master}
                level={player.masterLevel}
                onVolume={player.setMaster}
                onVolumeCommit={player.persistMaster}
                click={<MasterClick take={take} />}
              />
            </div>
            {/* A press here is one on the tracks: the surface above takes
                the pointer from it (onPointerDown captures it there), so a
                drag sets the region and a click moves the playhead. */}
            <div
              className="min-w-0 cursor-crosshair py-[3px] select-none"
              style={{ touchAction: "none" }}
              onPointerDown={onPointerDown}
            >
              <MasterClickLane
                from={from}
                to={to}
                position={displayPosition}
                region={band}
                take={take}
                drift={drift}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
