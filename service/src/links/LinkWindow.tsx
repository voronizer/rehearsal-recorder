import { useEffect, useRef, useState } from "react"
import { Check, CircleAlert, Copy, Link2 } from "lucide-react"
import { Said } from "@/components/TakePlayer"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogButtons, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { PickRow } from "@/components/ui/pick-row"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { closeLinkNow, linkAddress, putMix, useCloseLink, useLinks, useMakeLink, type LinkItem, type TakePage } from "../api"
import { Trouble } from "../shell/parts"
import { dayMonth, localDay, quoted, takeText } from "../shell/words"
import { MIX_FAILED, MIX_SILENT } from "../takes/Download"
import { TakeLink } from "../takes/parts"
import { gainsOf, makeMix, type Heard } from "../takes/player/mix"
import { peaksOf } from "../takes/player/peaks"
import type { ServiceSound } from "../takes/player/sound"

/*
  A link to one take for someone outside the band (#106): the chain button
  beside **Download** on the take's page (Alex's pick А, 2026-11-15 22:39),
  and its window with the take's links and **New link**. What the link
  shows, what can be downloaded and how long it lasts are chosen for each
  link (22:28, 22:30, 22:32), starting at The mix, Nothing and A month
  (23:37, 23:38); it plays as the maker hears it (22:31). A link that shows
  only the mix plays an MP3 made here at **Make link**, as **Download** makes
  one (22:43). The rows act at once, so the window's way out is **Close** (C3).
*/

type Shows = LinkItem["shows"]
type Takes = LinkItem["download"]
type Lasts = "never" | "month" | "week" | "day"

const SHOWS: Record<Shows, string> = { mix: "The mix", tracks: "Mix and tracks", marks: "Mix, tracks and marks" }
const TAKES: Record<Takes, string> = { none: "no download", mix: "download the mix", all: "download everything" }

const TOO_LONG = "This take is too long for a link with the mix alone: pick Mix and tracks."
const NOT_SENT = "Could not send the mix. Try again."
const NOT_MADE = "Could not make the link. Try again."
const NOT_CLOSED = "Could not close the link. Try again."
/** The most a request may carry to the band's service. */
const MAX_MIX = 100 * 1024 * 1024
/** A mix link's wave: as many numbers as a track's .peaks has. */
const PEAKS = 1200
const LINK = "Link for someone outside the band"

/** "12 November", on the member's own day. */
const dayOf = (stamp: string) => dayMonth(localDay(stamp))

const upper = (s: string) => s.replace(/^./, (c) => c.toUpperCase())

/** A row's lines: who it is for (or what it shows), then what it shows and
 *  lets download, then who made it and when, its end, and its plays. */
export function linkLines(link: LinkItem) {
  const played = link.plays
    ? `played ${link.plays === 1 ? "once" : `${link.plays} times`}${link.last_played_at ? `, last ${dayOf(link.last_played_at)}` : ""}`
    : "not played yet"
  return {
    title: link.for || SHOWS[link.shows],
    what: link.for ? `${SHOWS[link.shows]}, ${TAKES[link.download]}` : upper(TAKES[link.download]),
    when: [`${link.by}, ${dayOf(link.made_at)}`, link.until ? `until ${dayOf(link.until)}` : "no end", played].join(" · "),
  }
}

/** Copies the address; ✓ for a moment. Where the browser will not copy, the row shows the address to copy by hand. */
function CopyButton({ id, onRefused, inGroup }: { id: string; onRefused: () => void; inGroup?: boolean }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = () => {
    const writing = navigator.clipboard?.writeText(linkAddress(id))
    if (!writing) return onRefused()
    writing.then(
      () => {
        setDone(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setDone(false), 1500)
      },
      onRefused
    )
  }
  const icon = done ? <Check /> : <Copy />
  return inGroup ? (
    <InputGroupButton size="icon-xs" aria-label="Copy link" onClick={copy}>
      {icon}
    </InputGroupButton>
  ) : (
    <Button variant="ghost" size="icon-row" aria-label="Copy link" onClick={copy}>
      {icon}
    </Button>
  )
}

/** The whole address in a field, selected when it opens for copying by hand. */
function Address({ id, select, onRefused }: { id: string; select?: boolean; onRefused: () => void }) {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!select) return
    field.current?.focus()
    field.current?.select()
  }, [select])
  return (
    <InputGroup>
      <InputGroupInput
        ref={field}
        readOnly
        value={linkAddress(id)}
        aria-label="The link"
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
      />
      <InputGroupAddon align="inline-end">
        <CopyButton id={id} inGroup onRefused={() => field.current?.select()} />
      </InputGroupAddon>
    </InputGroup>
  )
}

/** One link: its lines, **Copy link** and **Close link**; the address in full on the one just made. */
export function LinkRow({ link, withTake, fresh, onClose }: { link: LinkItem; withTake?: boolean; fresh?: boolean; onClose: () => void }) {
  const [byHand, setByHand] = useState(false)
  const lines = linkLines(link)
  const field = fresh || byHand
  return (
    <Item data-link-row={link.id} variant="outline" size="sm" className={cn("flex-col items-stretch gap-1", fresh && "border-primary/50")}>
      <div className="flex min-w-0 items-center gap-1">
        <ItemTitle className="min-w-0 flex-1">
          <span className="min-w-0 break-words">
            {withTake && (
              <>
                <TakeLink take={link.take} className="align-baseline" />
                {" · "}
              </>
            )}
            {lines.title}
          </span>
        </ItemTitle>
        <ItemActions className="-my-1 -mr-2 shrink-0 gap-0">
          {!field && <CopyButton id={link.id} onRefused={() => setByHand(true)} />}
          <Button variant="ghost" size="row" className="text-muted-foreground hover:text-destructive" onClick={onClose}>
            Close link
          </Button>
        </ItemActions>
      </div>
      <ItemContent className="min-w-0">
        <ItemDescription className="line-clamp-none">
          {lines.what}
          <br />
          {lines.when}
        </ItemDescription>
      </ItemContent>
      {field && <Address id={link.id} select={byHand} onRefused={() => setByHand(true)} />}
    </Item>
  )
}

/** Links as rows; **Close link** acts at once, and a close the service did not take says so under them. */
export function LinkList({ links, withTake, fresh }: { links: LinkItem[]; withTake?: boolean; fresh?: string | null }) {
  const close = useCloseLink()
  return (
    <div className="flex flex-col gap-2">
      <ItemGroup className="gap-2">
        {links.map((l) => (
          <LinkRow key={l.id} link={l} withTake={withTake} fresh={l.id === fresh} onClose={() => close.mutate(l.id)} />
        ))}
      </ItemGroup>
      {close.isError && <Said variant="destructive" text={NOT_CLOSED} />}
    </div>
  )
}

/** The line under the choices: how the mix goes, or what went wrong. */
type Line = { text: string; trouble: boolean } | null

function LinkWindow({ take, sound, open, onOpenChange }: { take: TakePage; sound: ServiceSound; open: boolean; onOpenChange: (open: boolean) => void }) {
  const links = useLinks()
  const makeLink = useMakeLink(take.uid)
  const [shows, setShows] = useState<Shows>("mix")
  const [download, setDownload] = useState<Takes>("none")
  const [lasts, setLasts] = useState<Lasts>("month")
  const [forWhom, setForWhom] = useState("")
  const [line, setLine] = useState<Line>(null)
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const stop = useRef<AbortController | null>(null)
  /** A mix link made and not sent yet: closed if the window closes first. */
  const unsent = useRef<string | null>(null)
  /** The links and the form, which scroll between the title and the buttons. */
  const area = useRef<HTMLDivElement>(null)
  const giveUp = () => {
    stop.current?.abort()
    if (unsent.current) void closeLinkNow(unsent.current)
    unsent.current = null
  }
  // The window closing, by Close, Esc or ✕, stops the mix, and no link is made.
  useEffect(() => {
    if (!open) giveUp()
  }, [open])
  useEffect(() => giveUp, [])

  const pickShows = (v: Shows) => {
    setShows(v)
    if (v === "mix" && download === "all") setDownload("mix")
  }

  const made = (item: LinkItem) => {
    setFresh(item.id)
    setForWhom("")
    setLine(null)
    // The new link is the first row: back to the top to show it.
    area.current?.scrollTo({ top: 0 })
  }

  const make = async () => {
    setLine(null)
    const state = await sound.state()
    const heard: Heard = { volumes: state.volumes ?? {}, muted: state.muted ?? [], soloed: state.soloed ?? [] }
    const asked = { for: forWhom.trim(), shows, download, lasts }
    setBusy(true)
    try {
      if (shows === "mix") await makeMixLink(asked, heard)
      else made(await makeLink.mutateAsync({ ...asked, heard }))
    } catch {
      setLine({ text: NOT_MADE, trouble: true })
    } finally {
      setBusy(false)
    }
  }

  const makeMixLink = async (asked: { for: string; shows: Shows; download: Takes; lasts: Lasts }, heard: Heard) => {
    if (!gainsOf(take.tracks.map((t) => t.name), heard).some((g) => g > 0)) return setLine({ text: MIX_SILENT, trouble: true })
    const controller = new AbortController()
    stop.current = controller
    const said = (text: string, trouble = false) => !controller.signal.aborted && setLine({ text, trouble })
    let peaks: number[] = []
    let mp3: Blob
    said("Mixing… 0%")
    try {
      mp3 = await makeMix(take, heard, {
        signal: controller.signal,
        progress: (done) => said(`Mixing… ${Math.round(done * 100)}%`),
        onMixed: (mix) => (peaks = peaksOf([mix], PEAKS).map((v) => Math.min(1, v))),
      })
    } catch {
      return said(MIX_FAILED, true)
    }
    if (mp3.size > MAX_MIX) return said(TOO_LONG, true)
    said("Sending the mix…")
    try {
      const item = await makeLink.mutateAsync({ ...asked, peaks })
      unsent.current = item.id
      if (controller.signal.aborted) return giveUp()
      await putMix(item.id, mp3, controller.signal)
      unsent.current = null
      made(item)
    } catch {
      if (unsent.current) void closeLinkNow(unsent.current)
      unsent.current = null
      said(NOT_SENT, true)
    } finally {
      if (stop.current === controller) stop.current = null
    }
  }

  const mine = links.data?.filter((l) => l.take.uid === take.uid) ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="tall">
        <DialogHeader>
          <DialogTitle>Link to {quoted(takeText(take))}</DialogTitle>
          <DialogDescription>For someone outside the band: they open it without signing in.</DialogDescription>
        </DialogHeader>
        <div ref={area} className="-mx-6 flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-1">
          {links.error ? (
            <Trouble error={links.error} retry={() => void links.refetch()} />
          ) : (
            mine.length > 0 && <LinkList links={mine} fresh={fresh} />
          )}
          <div className="flex flex-col gap-3 border-t pt-4">
            <span className="text-sm font-semibold">New link</span>
            <Input
              value={forWhom}
              maxLength={60}
              onChange={(e) => setForWhom(e.target.value)}
              placeholder="Who it is for (only the band sees this)"
              aria-label="Who it is for"
            />
            <PickRow<Shows>
              label="Shows"
              value={shows}
              onChange={pickShows}
              options={[
                { value: "mix", label: "The mix" },
                { value: "tracks", label: "Mix and tracks" },
                { value: "marks", label: "And marks" },
              ]}
            />
            <PickRow<Takes>
              label="Download"
              value={download}
              onChange={setDownload}
              options={[
                { value: "none", label: "Nothing" },
                { value: "mix", label: "The mix" },
                { value: "all", label: "Mix and tracks", disabled: shows === "mix" },
              ]}
            />
            <PickRow<Lasts>
              label="Lasts"
              value={lasts}
              onChange={setLasts}
              options={[
                { value: "never", label: "No end" },
                { value: "month", label: "A month" },
                { value: "week", label: "A week" },
                { value: "day", label: "A day" },
              ]}
            />
            <p className="text-xs text-muted-foreground">The mix goes as you hear it now: your levels, mute and solo.</p>
          </div>
        </div>
        {/* Over the buttons, so it is in sight whatever is scrolled; room for two lines: the longest says what to pick instead. */}
        <div data-link-line className="flex h-8 min-w-0 shrink-0 items-start">
          {line &&
            (line.trouble ? (
              <Alert variant="destructive" size="lines">
                <CircleAlert />
                <AlertDescription>{line.text}</AlertDescription>
              </Alert>
            ) : (
              <span className="text-sm text-muted-foreground">{line.text}</span>
            ))}
        </div>
        <DialogButtons
          cancel="Close"
          action={
            <Button disabled={busy} onClick={() => void make()}>
              Make link
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

/** The chain button by **Download** on a take's page; each opening starts the window afresh. */
export function LinkButton({ take, sound, phone }: { take: TakePage; sound: ServiceSound; phone: boolean }) {
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(0)
  const show = () => {
    setOpening((n) => n + 1)
    setOpen(true)
  }
  return (
    <>
      {phone ? (
        <Button variant="ghost" size="icon-row" aria-label={LINK} onClick={show}>
          <Link2 />
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-row" aria-label={LINK} onClick={show}>
              <Link2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span aria-hidden>{LINK}</span>
          </TooltipContent>
        </Tooltip>
      )}
      <LinkWindow key={opening} take={take} sound={sound} open={open} onOpenChange={setOpen} />
    </>
  )
}
