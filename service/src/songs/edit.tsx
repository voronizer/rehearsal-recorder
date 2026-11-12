import { useEffect, useState, type ReactNode } from "react"
import { Pencil } from "lucide-react"
import { SignatureSelect } from "@/components/metronome/SignatureSelect"
import { TempoField } from "@/components/metronome/TempoField"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Signature } from "@/lib/api"
import { same, TAKE_NAME } from "../../worker/shared/names"
import { useChangeSong, useSongs, type SongPage } from "../api"
import { InPlace, lineUnder } from "../shell/InPlace"

/**
 * A song's title, tempo and signature, changed where they stand (Alex,
 * 5 November: no windows). РЭХА takes them at its next check.
 */

type Song = SongPage["song"]

/** The signature the song has, or 4/4 for the list to start from. */
const signatureOf = (song: { signature: Signature | null }): Signature => song.signature ?? "4/4"

/** − tempo + and the signature, as РЭХА's metronome has them, saved at once as Key is. */
export function TempoControls({ song }: { song: Song }) {
  const change = useChangeSong()
  // What was picked, until the band's answer has it.
  const [held, setHeld] = useState<{ tempo: number | null; signature: Signature } | null>(null)
  // A signature picked before any tempo: kept here, it goes with the tempo.
  const [first, setFirst] = useState<Signature | null>(null)
  const tempo = held ? held.tempo : song.tempo === null ? null : Math.round(song.tempo)
  const signature = held?.signature ?? (tempo === null ? first : null) ?? signatureOf(song)
  const save = (t: number | null, s: Signature) => {
    setHeld({ tempo: t, signature: s })
    change.mutate({ id: song.id, tempo: t, signature: t === null ? null : s }, { onSettled: () => setHeld(null) })
  }
  return (
    <span className="flex items-center gap-1.5 text-sm font-normal">
      <TempoField tempo={tempo} signature={signature} onChange={(t) => save(t, signature)} />
      <SignatureSelect value={signature} onChange={(s) => (tempo === null ? setFirst(s) : save(tempo, s))} />
      <FieldError>{change.error?.message}</FieldError>
    </span>
  )
}

/** What a typed title does: nothing, a rename (with what it says), or a refusal and why. */
function outcome(song: Song, typed: string, titles: { id: number; title: string }[]) {
  const t = typed.trim()
  if (t === "" || t === song.title) return { kind: "none" as const, says: "" }
  if (TAKE_NAME.test(t)) return { kind: "refused" as const, says: `${t} is what a take with no song is called.` }
  const other = titles.find((s) => s.id !== song.id && same(s.title, t))
  if (other) return { kind: "refused" as const, says: `“${other.title}” is another song. Songs are merged in РЭХА: Rename song there.` }
  const n = song.takes
  return { kind: "rename" as const, says: n === 0 ? "" : n === 1 ? "Its take is renamed with it." : `Its ${n} takes are renamed with it.` }
}

/** The line a song page shows in its facts' place while its title is a field. */
const { say, Line: FactsLine } = lineUnder()

/**
 * The title, renamed where it stands: ✎ turns it into a field with ✓ and ✕.
 * Enter or ✓ renames, Esc or ✕ leaves it. A line in the page's facts' place
 * says what only it can: why a title is turned down, or that the takes are
 * renamed with it.
 */
export function InPlaceTitle({ song, children }: { song: Song; children: ReactNode }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(song.title)
  const titles = useSongs().data?.songs ?? []
  const change = useChangeSong()
  const now = outcome(song, title, titles)
  const text = change.error ? change.error.message : now.says
  const bad = !!change.error || now.kind === "refused"
  const stop = () => {
    setEditing(false)
    say(null)
    change.reset()
  }
  const go = () => {
    if (now.kind === "none") return stop()
    if (now.kind === "rename") change.mutate({ id: song.id, title: title.trim() }, { onSuccess: stop })
  }
  useEffect(() => {
    if (editing) say({ id: song.id, text, bad })
  }, [editing, text, bad, song.id])
  useEffect(() => () => say(null), [])
  if (!editing)
    return (
      <span className="flex min-w-0 items-center gap-1">
        {children}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-row"
              aria-label={`Rename song ${song.title}`}
              onClick={() => {
                setTitle(song.title)
                setEditing(true)
              }}
            >
              <Pencil className="text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rename song</TooltipContent>
        </Tooltip>
      </span>
    )
  return (
    <InPlace
      label="Song title"
      selectAll
      maxLength={100}
      value={title}
      onChange={(t) => {
        change.reset()
        setTitle(t)
      }}
      ok={{ label: "Rename", disabled: now.kind === "refused" || change.isPending }}
      onOk={go}
      leave="Leave the title as it was"
      onLeave={stop}
      className="w-80 max-w-full"
      inputClassName="text-xl font-semibold"
    />
  )
}

/**
 * A song page's facts, or while its title is a field, what renaming it does.
 * Why a title is turned down is said as under any field (S11), in the line
 * the facts keep for it, so nothing below moves.
 */
export function TitleFacts({ song, children }: { song: Song; children: ReactNode }) {
  return <FactsLine id={song.id}>{children}</FactsLine>
}
