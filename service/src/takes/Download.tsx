import { useEffect, useRef, useState } from "react"
import { Download as DownloadIcon, Layers, Music4 } from "lucide-react"
import { ShareOption } from "@/components/ShareOption"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogButtons, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { TakePage } from "../api"
import { count, quoted, takeText } from "../shell/words"
import { gainsOf, makeMix, mixName, type Heard } from "./player/mix"
import type { ServiceSound } from "./player/sound"

/*
  **Download** by the take's name (Alex's pick, 2026-11-04 10:16): a window
  with the mix, made in the page as you hear it (10:19), and the tracks in
  MP3 or FLAC, ticked in a list and each a file of its own (10:25). It took
  the place of the **Download tracks** group at the foot of the page.
*/

type Kind = "mp3" | "flac"
type Line = { label: string; href: string }

/** What the old group's line said while the FLAC files were on their way. */
const COMING = "The originals are still coming from РЭХА."
/** Said where a mix could not be made, here and in the link window. */
export const MIX_FAILED = "Could not make the mix. Try again."
export const MIX_SILENT = "Every track is muted, so the mix would be silent."

/**
 * The files of one kind, a line each: a track's sound, then its notes under
 * it, then the notes of a track that recorded notes alone. The .mid files
 * are in both lists: the same small file, and there before the FLAC files.
 */
export function linesOf(take: Pick<TakePage, "files_at" | "files">, kind: Kind): Line[] {
  // Where the take page says its files are: the band's, or a link's own (#106).
  const href = (position: number, ext: string) => `${take.files_at}/${position}.${ext}?download=1`
  const sound = take.files.filter((f) => f[kind])
  const notes = take.files.filter((f) => f.mid)
  const notesLine = (f: (typeof notes)[number]) => ({ label: `${f.name}, notes (MIDI)`, href: href(f.position, "mid") })
  return [
    ...sound.flatMap((f) => [
      { label: f.name, href: href(f.position, kind) },
      ...notes.filter((n) => n.name === f.name).map(notesLine),
    ]),
    ...notes.filter((n) => !sound.some((f) => f.name === n.name)).map(notesLine),
  ]
}

/** Hands the browser a file to save, as a link pressed with `download` would. */
function save(href: string, name = "") {
  const a = document.createElement("a")
  a.href = href
  a.download = name
  a.hidden = true
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** How far apart the ticked files start: a browser may drop downloads asked for all at once. */
const APART_MS = 300

/**
 * What a link's page lets download (#106). `mix`: a link that shows only
 * the mix gives the MP3 the band made for it, at that address. `tracks`
 * false: no tracks, only the mix.
 */
export type LinkDownload = { mix: string | null; tracks: boolean }

export function Download({ take, sound, phone, link }: { take: TakePage; sound: ServiceSound; phone: boolean; link?: LinkDownload }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Kind | null>(null)
  // Opened again, it starts from the three choices; closing leaves its words in place while it fades (C3).
  const show = () => {
    setList(null)
    setOpen(true)
  }
  return (
    <>
      {phone ? (
        <Button variant="ghost" size="icon-row" aria-label="Download" onClick={show}>
          <DownloadIcon />
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-row" aria-label="Download" onClick={show}>
              <DownloadIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span aria-hidden>Download</span>
          </TooltipContent>
        </Tooltip>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {list ? (
            <TrackList key={list} take={take} kind={list} onBack={() => setList(null)} onDone={() => setOpen(false)} />
          ) : (
            <Choices take={take} sound={sound} link={link} open={open} onList={setList} onDone={() => setOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The three choices. They act at once, so the window's one button is **Close** (C3). */
function Choices({
  take,
  sound,
  link,
  open,
  onList,
  onDone,
}: {
  take: TakePage
  sound: ServiceSound
  link?: LinkDownload
  open: boolean
  onList: (kind: Kind) => void
  onDone: () => void
}) {
  const [mixing, setMixing] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [silent, setSilent] = useState(false)
  const stop = useRef<AbortController | null>(null)
  // The window closing, by Close, Esc or ✕, stops the mixing; nothing is saved.
  useEffect(() => {
    if (!open) stop.current?.abort()
  }, [open])
  useEffect(() => () => stop.current?.abort(), [])

  const mix = async () => {
    if (link?.mix) {
      save(`${link.mix}?download=1`)
      return onDone()
    }
    const state = await sound.state()
    const heard: Heard = { volumes: state.volumes ?? {}, muted: state.muted ?? [], soloed: state.soloed ?? [] }
    const names = take.tracks.map((t) => t.name)
    const heardAny = gainsOf(names, heard).some((g) => g > 0)
    setFailed(false)
    setSilent(!heardAny)
    if (!heardAny) return
    const controller = new AbortController()
    stop.current = controller
    setMixing(0)
    try {
      const blob = await makeMix(take, heard, { signal: controller.signal, progress: (done) => setMixing(Math.round(done * 100)) })
      const url = URL.createObjectURL(blob)
      save(url, mixName(take.name, names, heard))
      // Long enough for the browser to have taken the file.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      onDone()
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (stop.current === controller) stop.current = null
      setMixing(null)
    }
  }

  const busy = mixing !== null
  return (
    <>
      <DialogHeader>
        <DialogTitle>Download {quoted(takeText(take))}</DialogTitle>
        <DialogDescription>Pick what you need. It goes to your Downloads folder.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        {take.tracks.length > 0 && (
          <ShareOption
            icon={<Music4 />}
            title="The mix"
            hint={link?.mix ? "The MP3 the band made for this link." : "One MP3 of the take as you hear it on this page: your levels, mute and solo."}
            trouble={failed ? MIX_FAILED : silent ? MIX_SILENT : null}
            busy={busy}
            progress={mixing === null ? null : `Mixing… ${mixing}%`}
            disabled={busy}
            onClick={() => void mix()}
          />
        )}
        {link?.tracks !== false && (
          <>
            <ShareOption
              icon={<Layers />}
              title="Tracks in MP3"
              hint="Every track on its own, small files for a phone or a quick look."
              disabled={busy || !linesOf(take, "mp3").length}
              onClick={() => onList("mp3")}
            />
            <ShareOption
              icon={<Layers />}
              title="Tracks in FLAC"
              hint={take.flac_coming ? COMING : "Every track as РЭХА recorded it, and the notes as .mid, to open in a DAW."}
              disabled={busy || take.flac_coming || !linesOf(take, "flac").length}
              onClick={() => onList("flac")}
            />
          </>
        )}
      </div>
      <DialogButtons cancel="Close" />
    </>
  )
}

/** The files of one kind, all ticked at first; each ticked one downloads on its own. */
function TrackList({ take, kind, onBack, onDone }: { take: TakePage; kind: Kind; onBack: () => void; onDone: () => void }) {
  const lines = linesOf(take, kind)
  const [ticked, setTicked] = useState(() => new Set(lines.map((l) => l.href)))
  const n = ticked.size
  const download = () => {
    lines.filter((l) => ticked.has(l.href)).forEach((l, i) => setTimeout(() => save(l.href), i * APART_MS))
    onDone()
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Tracks of {quoted(takeText(take))} in {kind.toUpperCase()}
        </DialogTitle>
        <DialogDescription>Each one is a file of its own.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1">
        {lines.map((l) => (
          <Label key={l.href} data-file={l.label} className="flex h-8 cursor-pointer items-center gap-3 rounded-md px-2 text-sm leading-5 font-normal hover:bg-accent">
            <Checkbox
              checked={ticked.has(l.href)}
              onCheckedChange={(on) => {
                const next = new Set(ticked)
                if (on) next.add(l.href)
                else next.delete(l.href)
                setTicked(next)
              }}
            />
            {l.label}
          </Label>
        ))}
      </div>
      <DialogButtons
        aside={
          <Button variant="ghost" size="row" onClick={onBack}>
            Back
          </Button>
        }
        action={
          // The row pressed to come here is gone: the keyboard starts on the button Enter presses.
          <Button autoFocus disabled={!n} onClick={download}>
            Download {count(n, "file")}
          </Button>
        }
      />
    </>
  )
}
