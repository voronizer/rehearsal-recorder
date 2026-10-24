import { useEffect, useRef, useState } from "react"
import { Metronome, Play, Square } from "lucide-react"
import { BeatDots } from "@/components/metronome/BeatDots"
import { SignatureSelect } from "@/components/metronome/SignatureSelect"
import { TapButton } from "@/components/metronome/TapButton"
import { TempoField } from "@/components/metronome/TempoField"
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
import { useMetronome } from "@/hooks/useMetronome"
import { useTempoCount } from "@/hooks/useTempoCount"
import { api, type Signature, type SongGo } from "@/lib/api"
import { formatDayIn, formatMMSS } from "@/lib/format"
import { songLine, takesToCount } from "@/lib/metronome"
import { dismiss } from "@/lib/notices"

/** The notice the row says a refusal in. */
const SAID = "song-tempo"

/** The song as its page has it. */
export type TempoSong = {
  id: number
  title: string
  tempo: number | null
  signature: Signature | null
}

const LINK = "inline h-auto rounded-sm p-0 text-xs whitespace-normal"

/**
 * A song's tempo on its page in History, under its title (spec Part 7, Q10
 * A): the tempo with − and +, its unit, the signature, Tap and ▶. A change
 * is the song's at once, as Settings save theirs (`set_song_tempo`).
 *
 * A song with no tempo can have it counted from one of its takes, picked
 * from a list with the starred ones first, then the newest. After a count
 * the line offers halve and double, the counter's usual mistake, and the
 * count is kept while the page is open: a signature picked then counts the
 * same take in it (useTempoCount, as the rehearsal screen's row counts).
 * Tap and T listen to the band's pads too (TapButton), which Python opens
 * for the tapping.
 *
 * ▶ is the metronome's, not the head's round ▶ that plays a take (C2): it
 * runs the click at the page's tempo, and a change while it runs plays the
 * new one. Python plays it without touching the rehearsal screen's row or
 * a change held in it (`metronome_play` with a tempo). It stops at ■ and
 * when the page goes. Only one ▶ of the page plays: this one says so
 * through `onPlay`, and shows the click stopped when `stopped` changes,
 * the backing track's ▶ having been pressed, which stops it in Python.
 *
 * What the song has saved goes to `onSaved`, for the backing track's line
 * under the row.
 */
export function SongTempoRow({
  song,
  takes,
  onSaved,
  stopped = 0,
  onPlay,
}: {
  song: TempoSong
  takes: SongGo[]
  onSaved?: (tempo: number | null, signature: Signature) => void
  stopped?: number
  onPlay?: () => void
}) {
  const sayError = useErrorNotice(SAID)
  const [saved, setSaved] = useState({ tempo: song.tempo, signature: song.signature ?? "4/4" })
  const [playing, setPlaying] = useState(false)
  const [hushed, setHushed] = useState(stopped)
  if (hushed !== stopped) {
    setHushed(stopped)
    setPlaying(false)
  }
  useEffect(() => onSaved?.(saved.tempo, saved.signature), [saved, onSaved])
  // Whether the click runs as the page goes, so it stops with it.
  const running = useRef(playing)
  useEffect(() => {
    running.current = playing
  })
  // Each change is numbered: an answer to one that is not the last is
  // not put on screen over a later one.
  const changes = useRef(0)

  // The song as the page reads it again, merged since: its tempo now.
  const [read, setRead] = useState({ tempo: song.tempo, signature: song.signature })
  if (read.tempo !== song.tempo || read.signature !== song.signature) {
    setRead({ tempo: song.tempo, signature: song.signature })
    setSaved((was) => ({ tempo: song.tempo, signature: song.signature ?? was.signature }))
  }

  const count = useTempoCount({
    song: song.title,
    tempo: saved.tempo,
    signature: saved.signature,
    set: (next, sig) => save(next, sig),
    sayError,
    said: SAID,
  })
  const tempo = count.held?.tempo ?? saved.tempo
  const signature = count.held?.signature ?? saved.signature

  useEffect(
    () => () => {
      if (running.current) void api().metronome_stop()
    },
    []
  )

  const play = async (t: number | null, sig: Signature) => {
    dismiss(SAID)
    if (t === null) return
    // Playing from the press, so a change made before Python answers
    // retunes the click too.
    if (!playing) onPlay?.()
    setPlaying(true)
    try {
      const res = await api().metronome_play(t, sig)
      if (!res.ok) {
        sayError(res.error ?? "Could not play the click")
        setPlaying(false)
      }
    } catch {
      setPlaying(false)
      /* the bar across the top says why */
    }
  }

  const stop = async () => {
    setPlaying(false)
    try {
      await api().metronome_stop()
    } catch {
      /* the bar across the top says why */
    }
  }

  /** Saves a tempo and signature to the song, shown at once, and plays it
   *  if the click runs. A tempo of none keeps the signature picked here:
   *  there is nothing to save yet. */
  const save = async (next: number | null, sig: Signature) => {
    count.changed()
    const n = ++changes.current
    const was = saved
    setSaved({ tempo: next, signature: sig })
    dismiss(SAID)
    if (playing) void (next === null ? stop() : play(next, sig))
    // No tempo, before or now: a signature picked waits for one.
    if (next === null && was.tempo === null) return
    try {
      const res = await api().set_song_tempo(song.id, next, next === null ? null : sig)
      if (n !== changes.current) return
      if (!res.ok) {
        sayError(res.error ?? "Could not save the tempo")
        setSaved(was)
        return
      }
      setSaved({ tempo: res.tempo ?? null, signature: res.signature ?? sig })
    } catch {
      /* the bar across the top says why */
    }
  }

  const line = songLine(song.title, tempo, count.shown ? count.shown.take.name : null)

  return (
    <section aria-label="Tempo" className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Metronome aria-hidden className="mr-1 size-4 shrink-0 text-muted-foreground" />
        <TempoField tempo={tempo} signature={signature} onChange={(next) => void save(next, signature)} />
        <SignatureSelect value={signature} onChange={(sig) => void count.pickSignature(sig)} />
        <TapButton
          signature={signature}
          onTempo={(next) => void save(next, signature)}
          onError={sayError}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-row"
              aria-label={playing ? "Stop the click" : "Play the click"}
              disabled={tempo === null}
              onClick={() => void (playing ? stop() : play(tempo, signature))}
            >
              {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span aria-hidden>{playing ? "Stop the click" : "Play the click"}</span>
          </TooltipContent>
        </Tooltip>
        {playing ? <LitDots signature={signature} /> : <BeatDots signature={signature} lit={null} />}
      </div>
      <p data-song-tempo-line className="min-h-[2lh] text-xs text-muted-foreground">
        {count.counting
          ? `Counting the tempo from ${count.counting}…`
          : line.parts.map((part, i) =>
              typeof part === "string" ? (
                <span key={i}>{part}</span>
              ) : part.action === "count" ? (
                <CountMenu
                  key={i}
                  label={part.label}
                  takes={takes}
                  onPick={(go) => void count.countFrom({ ...go.take, folder: go.folder }, signature)}
                />
              ) : (
                <Button
                  key={i}
                  variant="link"
                  className={LINK}
                  onClick={() => void count.mend(part.action === "halve" ? 0.5 : 2)}
                >
                  {part.label}
                </Button>
              )
            )}
      </p>
    </section>
  )
}

/** The dots lit on the click ▶ runs, from what Python says it plays: its
 *  tempo and signature while it is between takes (`preview`), which are
 *  this page's and not the row's. */
function LitDots({ signature }: { signature: Signature }) {
  const { state, lit } = useMetronome()
  const playing = state?.phase === "preview"
  return <BeatDots signature={playing ? state.signature : signature} lit={playing ? lit : null} />
}

/** "count it from a take": the song's takes to count from, the starred
 *  first, then the newest. One whose rehearsal is not on disk cannot be. */
function CountMenu({
  label,
  takes,
  onPick,
}: {
  label: string
  takes: SongGo[]
  onPick: (go: SongGo) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="link" className={LINK}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Count the tempo from a whole take of the song:
        </DropdownMenuLabel>
        {takesToCount(takes).map((go) => (
          <DropdownMenuItem
            key={`${go.folder}#${go.take.take_number}`}
            data-take={go.take.name}
            disabled={go.missing}
            onSelect={() => onPick(go)}
            className="items-baseline"
          >
            <span aria-hidden className="w-3 shrink-0 text-signal">
              {go.take.starred ? "★" : ""}
            </span>
            <span className="min-w-0 flex-1 break-words">{go.take.name}</span>
            <span className="tnum shrink-0 text-xs text-muted-foreground">
              {formatMMSS(go.take.duration_sec)} · {formatDayIn(go.created_at)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
