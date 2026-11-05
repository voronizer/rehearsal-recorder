import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { Check, Pencil, X } from "lucide-react"
import { SignatureSelect } from "@/components/metronome/SignatureSelect"
import { TempoField } from "@/components/metronome/TempoField"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Signature } from "@/lib/api"
import { cn } from "@/lib/utils"
import { same, TAKE_NAME } from "../../worker/shared/names"
import { useChangeSong, useSongs, type SongPage } from "../api"

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
  const tempo = held ? held.tempo : song.tempo === null ? null : Math.round(song.tempo)
  const signature = held?.signature ?? signatureOf(song)
  const save = (t: number | null, s: Signature) => {
    setHeld({ tempo: t, signature: s })
    change.mutate({ id: song.id, tempo: t, signature: t === null ? null : s }, { onSettled: () => setHeld(null) })
  }
  return (
    <span className="flex items-center gap-1.5 text-sm font-normal">
      <TempoField tempo={tempo} signature={signature} onChange={(t) => save(t, signature)} />
      <SignatureSelect value={signature} onChange={(s) => tempo !== null && save(tempo, s)} />
      {change.error && (
        <span role="alert" className="text-xs text-destructive">
          {change.error.message}
        </span>
      )}
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
let line: { id: number; text: string; bad: boolean } | null = null
const heard = new Set<() => void>()
function say(next: typeof line) {
  line = next
  heard.forEach((f) => f())
}
const useLine = (id: number) =>
  useSyncExternalStore(
    (f) => (heard.add(f), () => heard.delete(f)),
    () => (line && line.id === id ? line : null)
  )

/**
 * The title, renamed where it stands: ✎ turns it into a field with ✓ and ✕.
 * Enter or ✓ renames, Esc or ✕ leaves it. A line says what only it can: why
 * a title is turned down, or that the takes are renamed with it; on the page
 * in the facts' place, in the panel under the field.
 */
export function InPlaceTitle({ song, size, children }: { song: Song; size: "page" | "panel"; children: ReactNode }) {
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
    if (size === "page" && editing) say({ id: song.id, text, bad })
  }, [size, editing, text, bad, song.id])
  useEffect(() => () => say(null), [])
  if (!editing)
    return (
      <span className={cn("flex min-w-0 gap-1", size === "panel" ? "flex-1 items-start" : "items-center")}>
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
  const field = (
    <span className="flex min-w-0 items-center gap-1">
      <Input
        aria-label="Song title"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        maxLength={100}
        value={title}
        onChange={(e) => {
          change.reset()
          setTitle(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            go()
          } else if (e.key === "Escape") {
            // The panel closes on Esc too; here it only leaves the title.
            e.preventDefault()
            e.stopPropagation()
            stop()
          }
        }}
        className={cn("min-w-0 px-2 font-semibold", size === "page" ? "h-9 w-72 text-xl" : "h-8 w-full text-lg")}
      />
      <Button variant="ghost" size="icon-row" aria-label="Rename" disabled={now.kind === "refused" || change.isPending} onClick={go}>
        <Check />
      </Button>
      <Button variant="ghost" size="icon-row" aria-label="Leave the title as it was" onClick={stop}>
        <X className="text-muted-foreground" />
      </Button>
    </span>
  )
  if (size === "page") return field
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      {field}
      {text && <span className={cn("text-xs font-normal", bad ? "text-destructive" : "text-muted-foreground")}>{text}</span>}
    </span>
  )
}

/** A song page's facts, or while its title is a field, what renaming it does. */
export function TitleFacts({ song, children }: { song: Song; children: ReactNode }) {
  const said = useLine(song.id)
  if (said === null || !said.text) return <>{children}</>
  return <span className={cn("text-xs", said.bad && "text-destructive")}>{said.text}</span>
}
