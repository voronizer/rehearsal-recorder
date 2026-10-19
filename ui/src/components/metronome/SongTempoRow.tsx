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
import { api, poll, type Signature, type SongGo } from "@/lib/api"
import { formatDayIn, formatMMSS } from "@/lib/format"
import { clampTempo, songLine, takesToCount } from "@/lib/metronome"
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

/** What a count gave, kept while the page shows the song: the take it
 *  was counted from, and the number in the signature it was counted in. */
type Count = { go: SongGo; tempo: number; signature: Signature }

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
 * same take in it. Tap and T listen to the band's pads too (TapButton),
 * which Python opens for the tapping.
 *
 * ▶ is the metronome's, not the head's round ▶ that plays a take (C2): it
 * runs the click at this tempo. The metronome's own tempo is put back when
 * it stops, so nothing of it is waiting at the next rehearsal.
 */
export function SongTempoRow({ song, takes }: { song: TempoSong; takes: SongGo[] }) {
  const sayError = useErrorNotice(SAID)
  const [tempo, setTempo] = useState(song.tempo)
  const [signature, setSignature] = useState<Signature>(song.signature ?? "4/4")
  const [count, setCount] = useState<Count | null>(null)
  const [counting, setCounting] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  // The metronome as it was before ▶, put back at ■; and what it plays now.
  const restore = useRef<{ tempo: number | null; signature: Signature } | null>(null)
  const live = useRef({ playing, tempo, signature })
  useEffect(() => {
    live.current = { playing, tempo, signature }
  })
  // Each change is numbered: an answer to one that is not the last is
  // not put on screen over a later one.
  const changes = useRef(0)

  // The song as the page reads it again, merged since: its tempo now.
  const [read, setRead] = useState({ tempo: song.tempo, signature: song.signature })
  if (read.tempo !== song.tempo || read.signature !== song.signature) {
    setRead({ tempo: song.tempo, signature: song.signature })
    setTempo(song.tempo)
    if (song.signature) setSignature(song.signature)
  }

  /** The metronome back as it was before ▶. */
  const putBack = async () => {
    const was = restore.current
    restore.current = null
    if (!was) return
    try {
      await api().metronome_set(was.tempo, was.signature)
    } catch {
      /* the bar across the top says why */
    }
  }

  // The click stops with the page, and the metronome is put back.
  useEffect(
    () => () => {
      if (!live.current.playing) return
      void (async () => {
        try {
          await api().metronome_stop()
        } catch {
          /* said in the bar */
        }
        await putBack()
      })()
    },
    []
  )

  /** Saves a tempo and signature to the song, shown at once. A tempo of
   *  none keeps the signature picked here: there is nothing to save yet. */
  const save = async (next: number | null, sig: Signature) => {
    const n = ++changes.current
    setTempo(next)
    setSignature(sig)
    dismiss(SAID)
    if (live.current.playing) {
      if (next === null) await stop()
      else void api().metronome_set(next, sig)
    }
    // No tempo, before or now: a signature picked waits for one.
    if (next === null && tempo === null) return
    try {
      const res = await api().set_song_tempo(song.id, next, next === null ? null : sig)
      if (n !== changes.current) return
      if (!res.ok) {
        sayError(res.error ?? "Could not save the tempo")
        setTempo(tempo)
        setSignature(signature)
        return
      }
      setTempo(res.tempo ?? null)
      if (res.signature) setSignature(res.signature)
    } catch {
      /* the bar across the top says why */
    }
  }

  /** Counts the tempo from `go` in `sig`, and saves it; false when Python
   *  could not count, which the row's notice says. */
  const countFrom = async (go: SongGo, sig: Signature) => {
    const n = ++changes.current
    setCounting(go.take.name)
    dismiss(SAID)
    let res: { ok: boolean; error?: string; tempo?: number }
    try {
      res = await api().count_tempo(go.folder, go.take.take_number, sig)
    } catch {
      res = { ok: false }
    }
    setCounting(null)
    // Typed or tapped meanwhile: that is the band's tempo, not this.
    if (n !== changes.current) return true
    if (!res.ok || res.tempo == null) {
      sayError(res.error ?? "Could not count the tempo")
      return false
    }
    setCount({ go, tempo: res.tempo, signature: sig })
    await save(res.tempo, sig)
    return true
  }

  const play = async () => {
    dismiss(SAID)
    if (tempo === null) return
    try {
      const before = await poll("metronome_state")
      restore.current = { tempo: before.tempo, signature: before.signature }
      const set = await api().metronome_set(tempo, signature)
      const res = set.ok ? await api().metronome_play() : set
      if (!res.ok) {
        sayError(res.error ?? "Could not play the click")
        await putBack()
        return
      }
      setPlaying(true)
    } catch {
      /* said in the bar */
    }
  }

  const stop = async () => {
    setPlaying(false)
    try {
      await api().metronome_stop()
    } catch {
      /* said in the bar */
    }
    await putBack()
  }

  // The count while the row still shows its number: a signature picked
  // then counts the same take again in it.
  const shown = count && count.tempo === tempo && count.signature === signature ? count : null
  const pickSignature = async (sig: Signature) => {
    const kept = tempo === null ? null : clampTempo(tempo, sig)
    if (!shown || sig === shown.signature) return save(kept, sig)
    setSignature(sig)
    // Should the count fail, the number stays, as with any other.
    if (!(await countFrom(shown.go, sig))) await save(kept, sig)
  }
  // Halved or doubled, it is still the count's, in the same signature.
  const mend = (by: number) => {
    if (tempo === null) return
    const next = clampTempo(tempo * by, signature)
    if (shown) setCount({ ...shown, tempo: next })
    void save(next, signature)
  }

  const line = songLine(song.title, tempo, shown ? shown.go.take.name : null)

  return (
    <section aria-label="Tempo" className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Metronome aria-hidden className="mr-1 size-4 shrink-0 text-muted-foreground" />
        <TempoField tempo={tempo} signature={signature} onChange={(next) => void save(next, signature)} />
        <SignatureSelect value={signature} onChange={(sig) => void pickSignature(sig)} />
        <TapButton signature={signature} onTempo={(next) => void save(next, signature)} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-row"
              aria-label={playing ? "Stop the click" : "Play the click"}
              disabled={tempo === null}
              onClick={() => void (playing ? stop() : play())}
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
        {counting
          ? `Counting the tempo from ${counting}…`
          : line.parts.map((part, i) =>
              typeof part === "string" ? (
                <span key={i}>{part}</span>
              ) : part.action === "count" ? (
                <CountMenu key={i} label={part.label} takes={takes} onPick={(go) => void countFrom(go, signature)} />
              ) : (
                <Button key={i} variant="link" className={LINK} onClick={() => mend(part.action === "halve" ? 0.5 : 2)}>
                  {part.label}
                </Button>
              )
            )}
      </p>
    </section>
  )
}

/** The dots lit on the click while ▶ runs it, from what Python says. */
function LitDots({ signature }: { signature: Signature }) {
  const { lit } = useMetronome()
  return <BeatDots signature={signature} lit={lit} />
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
