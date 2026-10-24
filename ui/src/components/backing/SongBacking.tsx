import { useEffect, useRef, useState } from "react"
import { Ellipsis, Play, Square, TriangleAlert } from "lucide-react"
import { BarOneField } from "@/components/backing/BarOneField"
import { FileStart } from "@/components/backing/FileStart"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { api, poll, type Signature, type SongBacking as Backing } from "@/lib/api"
import { beatShift, drawnRange, pageLine } from "@/lib/backing"
import { formatMMSS } from "@/lib/format"
import { instrument } from "@/lib/instruments"
import { clampTempo } from "@/lib/metronome"
import { dismiss } from "@/lib/notices"

/** The notice the section says a refusal in. */
const SAID = "song-backing"

/** How many bars of peaks the start of the file is drawn with. */
const BUCKETS = 320

/** How often Python is asked where ▶ has got to, in ms; the playhead is
 *  counted on between answers. */
const POLL_MS = 250

const LINK = "inline h-auto rounded-sm p-0 text-xs whitespace-normal"

const BackingIcon = instrument("backing").Glyph

/** The song as its page has it: its tempo as the tempo row shows it now. */
export type BackingSong = {
  id: number
  title: string
  tempo: number | null
  signature: Signature | null
  backing: Backing | null
}

/**
 * A song's backing track on its page in History, under the tempo row (spec
 * Part 6, the Q6 mockup's variant B). On its line the file's name, its
 * length and mono or stereo, Bar 1 at, ▶ and ⋯ with Replace… and Remove;
 * with none, Add backing track…. Under it the start of the file drawn with
 * the song's bars over it (FileStart), and the line that says what counting
 * found and what to do next (`pageLine`), in two lines' room.
 *
 * Every change is saved to the song at once, as the tempo row's are; one
 * that gives the song a tempo goes to `onTempo` at once, for the tempo row,
 * and to `onChanged` once saved, which reads the song again. ▶ plays the
 * file from its start with the click from bar 1 (`backing_play`), and stops
 * the tempo row's click: it says so through `onPlay`, and stops when
 * `stopped` changes, the tempo row's ▶ having been pressed. It stops at ■,
 * at the file's end and when the page goes.
 */
export function SongBacking({
  song,
  onTempo,
  onChanged,
  stopped,
  onPlay,
}: {
  song: BackingSong
  onTempo: (tempo: number) => void
  onChanged: () => void
  stopped: number
  onPlay: () => void
}) {
  const sayError = useErrorNotice(SAID)
  const [own, setOwn] = useState(song.backing)
  // The song as the page reads it again, after a change: its backing track
  // now.
  const [read, setRead] = useState(song.backing)
  if (read !== song.backing) {
    setRead(song.backing)
    setOwn(song.backing)
  }
  // The file's name while it is added and counted.
  const [counting, setCounting] = useState<string | null>(null)
  // The song has just taken the counted tempo, having none: halve and
  // double are offered (pageLine).
  const [took, setTook] = useState(false)
  // Each change of bar 1 is numbered: an answer to one that is not the last
  // is not put on screen over a later one.
  const moves = useRef(0)

  const play = usePlaying(song.id, sayError, onPlay, stopped)

  // The drawing's scale, worked out when the file, the tempo or the
  // signature changes, and not as bar 1 moves.
  const scaleKey = own ? `${own.name}|${song.tempo}|${song.signature}` : null
  const [scale, setScale] = useState<{ key: string | null; end: number }>({ key: null, end: 8 })
  if (scale.key !== scaleKey && own) {
    setScale({ key: scaleKey, end: drawnRange(own.first_bar, song.tempo, song.signature).end })
  }
  const end = scale.end
  const [peaks, setPeaks] = useState<{ key: string; rows: number[][] } | null>(null)
  const drawn = own !== null && !own.missing && counting === null
  const peaksKey = drawn ? `${song.id}|${own.name}|${end}` : null
  useEffect(() => {
    if (peaksKey === null) return
    let alive = true
    void (async () => {
      try {
        const res = await api().song_backing_peaks(song.id, end, BUCKETS)
        if (alive && res.ok && res.peaks) setPeaks({ key: peaksKey, rows: res.peaks })
      } catch {
        /* the bar across the top says why */
      }
    })()
    return () => {
      alive = false
    }
  }, [peaksKey, song.id, end])

  const add = async () => {
    dismiss(SAID)
    try {
      const picked = await api().pick_backing_file()
      if (!picked.ok) {
        if (!picked.cancelled) sayError(picked.error ?? "Could not open the file")
        return
      }
      if (!picked.path) return
      play.stop(false)
      setCounting(picked.name ?? picked.path)
      const res = await api().add_backing(song.id, picked.path)
      setCounting(null)
      if (!res.ok) {
        sayError(res.error ?? "Could not add the backing track")
        return
      }
      const counted = res.tempo ?? null
      setOwn({
        name: res.name ?? picked.name ?? "",
        seconds: res.seconds ?? null,
        channels: res.channels ?? null,
        tempo: counted,
        first_bar: res.first_bar ?? 0,
        missing: false,
      })
      const takes = song.tempo === null && counted !== null
      setTook(takes)
      if (takes) onTempo(counted)
      onChanged()
    } catch {
      setCounting(null)
      /* the bar across the top says why */
    }
  }

  const remove = async () => {
    dismiss(SAID)
    play.stop(false)
    try {
      const res = await api().remove_backing(song.id)
      if (!res.ok) {
        sayError(res.error ?? "Could not remove the backing track")
        return
      }
      setOwn(null)
      setTook(false)
      onChanged()
    } catch {
      /* the bar across the top says why */
    }
  }

  const moveBarOne = async (seconds: number) => {
    if (!own) return
    dismiss(SAID)
    const n = ++moves.current
    const was = own.first_bar
    setOwn({ ...own, first_bar: seconds })
    try {
      const res = await api().set_backing_first_bar(song.id, seconds)
      if (n !== moves.current) return
      if (!res.ok) {
        sayError(res.error ?? "Could not move bar 1")
        setOwn((o) => o && { ...o, first_bar: was })
        return
      }
      setOwn((o) => o && { ...o, first_bar: res.first_bar ?? seconds })
    } catch {
      /* the bar across the top says why */
    }
  }

  /** The counted tempo, halved, doubled or as it is, made the song's. */
  const setTempo = async (tempo: number) => {
    if (!own) return
    dismiss(SAID)
    try {
      const res = await api().set_backing_tempo(song.id, tempo, true)
      if (!res.ok) {
        sayError(res.error ?? "Could not change the tempo")
        return
      }
      const now = res.tempo ?? tempo
      setOwn((o) => o && { ...o, tempo: now })
      onTempo(now)
      onChanged()
    } catch {
      /* the bar across the top says why */
    }
  }

  const act = (action: "earlier" | "later" | "halve" | "double" | "take") => {
    if (!own || own.tempo === null) return
    const signature = song.signature ?? "4/4"
    if (action === "earlier" || action === "later") {
      void moveBarOne(beatShift(own.first_bar, own.tempo, signature, action === "later" ? 1 : -1))
    } else if (action === "take") {
      void setTempo(own.tempo)
    } else {
      void setTempo(clampTempo(own.tempo * (action === "halve" ? 0.5 : 2), signature))
    }
  }

  const line = pageLine(song, own, counting, took)
  const missing = own?.missing ?? false

  return (
    <section aria-label="Backing track" className="mt-2 flex flex-col gap-1.5">
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-2">
        <BackingIcon aria-hidden className="mr-1 size-4 shrink-0 text-muted-foreground" />
        {own === null && counting === null ? (
          <>
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">No backing track</span>
            <Button variant="outline" size="row" onClick={() => void add()}>
              Add backing track…
            </Button>
          </>
        ) : (
          <>
            {/* 10rem at least before what follows wraps under it, so a narrow
                page cuts the name only so far and never lays the time over Bar
                1 at. */}
            <span data-backing-file className="flex min-w-0 flex-[1_1_10rem] items-baseline gap-1.5 text-sm">
              <span className="truncate font-medium">{counting ?? own?.name}</span>
              {counting === null && own && !missing && own.seconds !== null && (
                <span className="tnum shrink-0 text-xs text-muted-foreground">
                  {play.position !== null
                    ? `${formatMMSS(play.position)} / ${formatMMSS(own.seconds)}`
                    : formatMMSS(own.seconds)}{" "}
                  · {own.channels === 1 ? "mono" : "stereo"}
                </span>
              )}
            </span>
            {counting === null && own && !missing && (
              <>
                <BarOneField value={own.first_bar} length={own.seconds} onChange={(s) => void moveBarOne(s)} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-row"
                      aria-label={play.playing ? "Stop the backing track" : "Play the backing track with the click"}
                      onClick={() => (play.playing ? play.stop(true) : play.start())}
                    >
                      {play.playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span aria-hidden>
                      {play.playing
                        ? "Stop the backing track"
                        : song.tempo === null
                          ? "Play the backing track: the song has no tempo, so no click"
                          : "Play the backing track from its start, the click from bar 1: they should land together"}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {counting === null && <MoreMenu onReplace={() => void add()} onRemove={() => void remove()} />}
          </>
        )}
      </div>
      {drawn && own && (
        <FileStart
          peaks={peaks?.key === peaksKey ? peaks.rows : null}
          length={own.seconds}
          firstBar={own.first_bar}
          tempo={song.tempo}
          signature={song.signature}
          end={end}
          playhead={play.position}
          onFirstBar={(s) => void moveBarOne(s)}
        />
      )}
      <p
        data-backing-line
        data-amber={missing ? "" : undefined}
        className={missing ? "min-h-[2lh] text-xs text-foreground" : "min-h-[2lh] text-xs text-muted-foreground"}
      >
        {missing && <TriangleAlert className="mr-1 inline size-3.5 align-[-0.2em] text-warn" />}
        {line.parts.map((part, i) =>
          typeof part === "string" ? (
            <span key={i}>{part}</span>
          ) : (
            <Button key={i} variant="link" className={LINK} onClick={() => act(part.action)}>
              {part.label}
            </Button>
          )
        )}
      </p>
    </section>
  )
}

/** ⋯: Replace… and Remove, and what becomes of the takes recorded. */
function MoreMenu({ onReplace, onRemove }: { onReplace: () => void; onRemove: () => void }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-row" aria-label="More for the backing track">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <span aria-hidden>Replace or remove</span>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={onReplace}>Replace…</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          Remove
        </DropdownMenuItem>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Takes already recorded keep the backing track they were played with.
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One press of ▶, numbered: an answer or a frame for a press before it
 *  changes nothing. `heard` once Python has started it. */
type Run = { id: number; heard: boolean; position: number }

/**
 * ▶ on the page: whether the file plays, and where it has got to, from what
 * Python says (`metronome_state`'s `backing`), counted on between answers.
 * Python is asked only while it plays; it stops on its own at the file's
 * end, or for the click's ▶, and the page then shows it still.
 */
function usePlaying(
  songId: number,
  sayError: (text: string) => void,
  onPlay: () => void,
  stopped: number
) {
  const [run, setRun] = useState<Run | null>(null)
  const runs = useRef(0)
  /** Changes the press `id`'s run, if it is still the one on screen. */
  const update = (id: number, next: (r: Run) => Run | null) =>
    setRun((r) => (r !== null && r.id === id ? next(r) : r))
  // Whether it plays as the page goes, so it stops with it.
  const running = useRef(false)
  useEffect(() => {
    running.current = run !== null
  })
  useEffect(
    () => () => {
      if (running.current) void api().backing_stop()
    },
    []
  )
  const [hushed, setHushed] = useState(stopped)
  if (hushed !== stopped) {
    setHushed(stopped)
    setRun(null)
  }

  // Where it plays: asked four times a second, and counted on with each
  // frame from the last answer.
  const heard = run !== null && run.heard ? run.id : null
  useEffect(() => {
    if (heard === null) return
    const id = heard
    let alive = true
    let anchor: { position: number; at: number } | null = null
    let frame = 0
    let timer = 0
    const tick = () => {
      if (!alive || anchor === null) return
      // Still in the click's lead-in: nothing to count on from.
      const on = anchor.position > 0 ? (performance.now() - anchor.at) / 1000 : 0
      const position = anchor.position + on
      setRun((r) => (r !== null && r.id === id ? { ...r, position } : r))
      frame = requestAnimationFrame(tick)
    }
    const ask = async () => {
      try {
        const state = await poll("metronome_state")
        if (!alive) return
        if (!state.backing.playing) {
          setRun((r) => (r !== null && r.id === id ? null : r))
          return
        }
        anchor = { position: state.backing.position_sec, at: performance.now() }
        if (frame === 0) frame = requestAnimationFrame(tick)
      } catch {
        /* asked again on the next round */
      }
      if (alive) timer = window.setTimeout(() => void ask(), POLL_MS)
    }
    void ask()
    return () => {
      alive = false
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [heard])

  const start = async () => {
    dismiss(SAID)
    const id = ++runs.current
    setRun({ id, heard: false, position: 0 })
    onPlay()
    try {
      const res = await api().backing_play(songId, true)
      if (!res.ok) {
        sayError(res.error ?? "Could not play the backing track")
        update(id, () => null)
        return
      }
      update(id, (r) => ({ ...r, heard: true }))
    } catch {
      update(id, () => null)
    }
  }

  /** ■, or before the file changes; `say` for ■ itself, which Python is
   *  told of. A file added or removed stops it in Python already. */
  const stop = (say: boolean) => {
    if (!running.current) return
    setRun(null)
    if (say) void api().backing_stop().catch(() => undefined)
  }

  return { playing: run !== null, position: run?.position ?? null, start, stop }
}
