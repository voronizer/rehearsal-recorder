import { ChevronRight, Star } from "lucide-react"
import { memo, useEffect, useRef, useState, type ReactNode } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Item } from "@/components/ui/item"
import { MarkLine } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import { TakeColumns } from "@/components/ui/take-columns"
import { FigureLine, Figures, WholeTip, useCut, type FigurePart } from "@/components/ui/whole"
import { EveningStrip } from "@/components/EveningStrip"
import { SongName } from "@/components/SongName"
import { TakeTitle } from "@/components/TakeTitle"
import {
  daysAgo,
  formatDay,
  formatDuration,
  formatMMSS,
  inCloudLabel,
  takesLabel,
} from "@/lib/format"
import { labelOf, useLabels } from "@/lib/labels"
import { playLook } from "@/lib/playLook"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import type { LastTime as LastTimeData, SongPlays, Take } from "@/lib/api"

/** What is playing from here, and where it has got to. */
export type LastTimePlayback = {
  take: Take
  playing: boolean
  loading: boolean
  position: number
}

/** How many notes a song shows here before it says how many more there are:
 *  this is a glance before playing, not the rehearsal itself. */
const NOTES_SHOWN = 2

/**
 * Last time, beside the setup: the rehearsal before this one, song by song,
 * so the band can hear where they left off before they start.
 *
 * Built on what every take has — its song, how many goes it got, how long
 * each ran — and not on marks, which are few: a song's row plays its newest
 * ★ go, wherever it was played, or with none its last go, which is usually
 * the one they settled on. The notes left while listening are added under
 * their song where there are any. Under it, the rehearsals before it, which
 * open in history. History itself opens from the header, so this has no
 * button of its own for it.
 *
 * Every name here keeps its width (Q3): it wraps to a second line only when
 * it is longer than its whole row, and the figures beside it drop whole, the
 * least needed first. What is cut or dropped shows whole on hover and on
 * keyboard focus.
 *
 * Drawn again only when what it is given changes (memo): the start screen is
 * drawn every 80 ms while the check runs, and every name and figure line
 * here is measured each time it is drawn. The screen keeps its handlers and
 * `playback` the same objects between readings for that.
 */
export const LastTime = memo(function LastTime({
  data,
  playback,
  problem,
  onPlay,
  onOpen,
  onOpenSong,
}: {
  data: LastTimeData
  playback: LastTimePlayback | null
  /** Why what was asked for does not play. */
  problem?: string | null
  onPlay: (take: Take) => void
  onOpen: (folder: string) => void
  /** Opens a song's page in History's Songs view; null is Not named's. */
  onOpenSong?: (title: string | null) => void
}) {
  const last = data.last
  if (!last) return null

  const byNumber = new Map(last.takes.map((t) => [t.take_number, t]))
  const songs = last.songs
    .map((s) => ({
      name: s.name,
      plays: s.plays,
      takes: (s.take_numbers ?? [])
        .map((n) => byNumber.get(n))
        .filter((t): t is Take => t !== undefined),
    }))
    .filter((s) => s.takes.length > 0)
  const grouped = new Set(songs.flatMap((s) => s.takes.map((t) => t.take_number)))
  const unnamed = last.takes.filter((t) => !grouped.has(t.take_number))
  const longest = Math.max(1, ...last.takes.map((t) => t.duration_sec || 0))
  const total = last.takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)

  const meta = [
    total >= 30 ? formatDuration(total / 60) : null,
    takesLabel(last.takes.length),
    last.in_cloud > 0 ? inCloudLabel(last.in_cloud) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <aside aria-label="Last time" className="flex min-w-0 flex-col gap-8">
      <Card className="px-6 pt-6 pb-3">
        <CardHead
          day={`Last time · ${formatDay(last.created_at)}, ${daysAgo(last.created_at)}`}
          name={last.name}
          meta={meta}
          onOpen={() => onOpen(last.folder)}
        />

        <EveningStrip runs={last.runs} />

        {problem && (
          <p role="status" className="text-xs text-destructive">
            {problem}
          </p>
        )}

        <div className="flex flex-col">
          {songs.map((s) => (
            <SongRow
              key={s.name}
              name={s.name}
              takes={s.takes}
              plays={s.plays}
              folder={last.folder}
              longest={longest}
              playback={playback}
              problem={problem}
              onPlay={onPlay}
              onOpenSong={onOpenSong}
            />
          ))}
          {unnamed.length > 0 && (
            <SongRow
              name="Not named"
              unnamed
              takes={unnamed}
              plays={null}
              folder={last.folder}
              longest={longest}
              playback={playback}
              problem={problem}
              onPlay={onPlay}
              onOpenSong={onOpenSong}
            />
          )}
        </div>
      </Card>

      {data.earlier.length > 0 && (
        <section aria-label="Earlier" className="flex flex-col gap-1">
          <h2 className="px-1 pb-1 text-xs font-semibold text-muted-foreground">Earlier</h2>
          {data.earlier.map((r) => (
            <EarlierRow key={r.folder} rehearsal={r} onOpen={onOpen} />
          ))}
        </section>
      )}
    </aside>
  )
})

/**
 * One song of last time: its goes as columns as tall as they ran (Q2), the
 * starred ones green, and the one its button plays at full strength while
 * the others are dimmed, when it is one of them.
 */
function SongRow({
  name,
  takes,
  plays,
  folder,
  longest,
  unnamed = false,
  playback,
  problem,
  onPlay,
  onOpenSong,
}: {
  name: string
  takes: Take[]
  /** What ▶ plays: the song's newest ★ go, or its last go here. null for
   *  the takes nobody named, which have no song and play their last take. */
  plays: SongPlays | null
  /** Last time's folder, to tell its own takes from another rehearsal's. */
  folder: string
  longest: number
  unnamed?: boolean
  playback: LastTimePlayback | null
  problem?: string | null
  onPlay: (take: Take) => void
  onOpenSong?: (title: string | null) => void
}) {
  const labels = useLabels()
  const lastGo = takes[takes.length - 1]
  const target = plays?.take ?? lastGo
  const isTarget = (t: Take) =>
    plays ? plays.folder === folder && plays.take.take_number === t.take_number : t === lastGo
  // Said in words only when ▶ plays something the columns do not end on.
  const elsewhere = plays !== null && !isTarget(lastGo)
  const here = playback?.take === target ? playback : null
  const total = takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)
  // Every mark is listed, a plain one with nothing written included (spec D2).
  const notes = takes.flatMap((t) => (t.markers ?? []).map((m) => ({ take: t, marker: m })))
  // How many takes go first, then how long they ran: the columns show both.
  const parts: FigurePart[] = here
    ? [playingPart(here)]
    : [
        { text: takesLabel(takes.length), keep: 1 },
        { text: formatMMSS(total), keep: 0 },
      ]

  return (
    <div
      data-song={name}
      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t py-3"
    >
      <RowPlay
        take={target}
        here={here}
        problem={problem}
        label={unnamed ? target.name : playLabel(target, name)}
        onPlay={onPlay}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <NameAndFigures
          parts={parts}
          name={(figures) => (
            <SongName
              title={unnamed ? null : name}
              onOpen={onOpenSong}
              className={cn("flex-[0_1_auto] text-sm", unnamed ? "text-muted-foreground" : "font-semibold")}
              textClassName="line-clamp-2 break-words"
              figures={figures}
            />
          )}
        />
        {elsewhere && plays && (
          <span data-plays className="text-xs break-words text-muted-foreground">
            <StarMark /> <TakeTitle take={plays.take} /> · {formatDay(plays.created_at)}
          </span>
        )}
        {notes.slice(0, NOTES_SHOWN).map(({ take, marker }) => (
          <MarkLine
            key={`${take.take_number}-${marker.at}`}
            label={labelOf(labels, marker.label_id)}
            at={marker.at}
            note={marker.note}
            take={<TakeTitle take={take} />}
            className="text-xs"
          />
        ))}
        {notes.length > NOTES_SHOWN && (
          <span className="text-xs text-muted-foreground">
            and {notes.length - NOTES_SHOWN} more
          </span>
        )}
      </div>
      <TakeColumns
        height={24}
        longest={longest}
        columns={takes.map((t) => ({
          key: t.take_number,
          sec: t.duration_sec,
          starred: t.starred ?? false,
          lit: isTarget(t),
        }))}
      />
    </div>
  )
}

/** A rehearsal before last time, which opens in History: its day, its name,
 *  and how long it ran, or that its folder is gone. */
function EarlierRow({
  rehearsal: r,
  onOpen,
}: {
  rehearsal: LastTimeData["earlier"][number]
  onOpen: (folder: string) => void
}) {
  const [nameRef, cut] = useCut<HTMLSpanElement>()
  const [dropped, setDropped] = useState(false)
  const parts: FigurePart[] = [
    ...(r.total_duration_sec >= 30 ? [{ text: formatDuration(r.total_duration_sec / 60), keep: 0 }] : []),
    { text: takesLabel(r.take_count), keep: 1 },
  ]
  return (
    // The row is one button, so its one tip says what the row could not
    // show: the name whole, and the figures whole once any has dropped. A
    // row whose folder is gone has no figures, so none have dropped.
    <WholeTip
      cut={cut}
      text={r.name}
      figures={dropped && !r.missing ? <FigureLine parts={parts} /> : null}
    >
      <Item asChild size="sm" className="flex-nowrap items-baseline gap-3 px-2 py-2">
        <Button
          variant="ghost"
          data-earlier={r.folder}
          onClick={() => onOpen(r.folder)}
          className="h-auto w-full justify-start text-left whitespace-normal"
        >
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDay(r.created_at)}</span>
          <span ref={nameRef} className="line-clamp-2 min-w-0 flex-[0_1_auto] break-words">
            {r.name}
          </span>
          {r.missing ? (
            <span className="ml-auto shrink-0 text-xs text-destructive">Not found on disk</span>
          ) : (
            <Figures
              parts={parts}
              onDropped={setDropped}
              tip={false}
              className="tnum text-right text-xs text-muted-foreground"
            />
          )}
        </Button>
      </Item>
    </WholeTip>
  )
}

/**
 * A name and its figure line (Q3): the name keeps its width, wrapping only
 * past its whole row, and the figures take what is left, dropping whole.
 * Once any has dropped, the name's tip says the line whole too: the name is
 * what a keyboard reaches, and with none left there is nothing to hover.
 */
function NameAndFigures({
  parts,
  name,
}: {
  parts: FigurePart[]
  /** The name, given the figures its tip is to say, or null. */
  name: (figures: ReactNode) => ReactNode
}) {
  const [dropped, setDropped] = useState(false)
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {name(dropped ? <FigureLine parts={parts} /> : null)}
      <Figures parts={parts} onDropped={setDropped} className="tnum text-xs text-muted-foreground" />
    </div>
  )
}

/** ★: the one star (C8), filled in the starred green, in a line of text. */
function StarMark() {
  return (
    <Star
      role="img"
      aria-label="Starred"
      className="inline size-3 fill-current align-text-bottom text-signal"
    />
  )
}

/** A row's figures while its go plays from here: where it has got to, of
 *  how long it runs. Kept above every other figure. */
function playingPart(here: LastTimePlayback): FigurePart {
  return { text: `${formatMMSS(here.position)} / ${formatMMSS(here.take.duration_sec)}`, keep: 9 }
}

/** What a song's ▶ is called after "Play" or "Pause": the go and which one
 *  it is. reha.stream finds Pałyn 7's by the start of it. */
function playLabel(take: Take, song: string) {
  return `${take.name}, the ${take.starred ? "starred" : "last"} take of ${song}`
}

/** The small player on a row (C2), its look worked out from what plays. */
function RowPlay({
  take,
  here,
  problem,
  label,
  onPlay,
}: {
  take: Take
  here: LastTimePlayback | null
  problem?: string | null
  label: string
  onPlay: (take: Take) => void
}) {
  const look = playLook({
    loaded: !!here,
    playing: here?.playing ?? false,
    loading: here?.loading ?? false,
    failed: !!here && !!problem,
    missing: false,
  })
  // Playing, it has Space while Settings › Keys has it on.
  const spaceKeys = useKeysOn("space")
  return (
    <PlayButton
      look={look}
      name={label}
      onClick={() => onPlay(take)}
      aria-keyshortcuts={here && spaceKeys ? "Space" : undefined}
    />
  )
}

/**
 * Last time's head: the day, the rehearsal's name, its figures, and Open.
 * The name keeps its width (Q3): Open gives up its word first, becoming a
 * chevron, and only then does the name wrap, to two lines, cut past that.
 *
 * Open's tip says what its button cannot: where it goes once it is a
 * chevron, and the name whole while the name is cut, since a keyboard
 * reaches Open and not the name. The name shows whole on hover as well.
 */
function CardHead({
  day,
  name,
  meta,
  onOpen,
}: {
  day: string
  name: string
  meta: string
  onOpen: () => void
}) {
  const row = useRef<HTMLDivElement>(null)
  const [iconOnly, setIconOnly] = useState(false)
  const [nameRef, cut] = useCut<HTMLDivElement>()
  // Unseen and on one line: the name, for how wide it wants to be, and Open
  // with its word, for how wide that is. Each is watched as the row is, so a
  // new Appearance size or a font coming in is measured afresh.
  const natural = useRef<HTMLSpanElement>(null)
  const openWide = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const r = row.current
    const n = natural.current
    const o = openWide.current
    if (!r || !n || !o) return
    // Open gives up its word when the name is wider than the room Open with
    // its word would leave.
    const look = () => {
      const gap = parseFloat(getComputedStyle(r).columnGap) || 0
      setIconOnly(n.offsetWidth > r.clientWidth - o.offsetWidth - gap)
    }
    look()
    const watch = new ResizeObserver(look)
    for (const el of [r, n, o]) watch.observe(el)
    return () => watch.disconnect()
  }, [])

  return (
    <div ref={row} className="relative flex items-start gap-2">
      <span aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
        <span ref={natural} className="absolute text-base font-semibold whitespace-nowrap">
          {name}
        </span>
        <span ref={openWide} className={cn(buttonVariants({ variant: "outline", size: "row" }), "absolute")}>
          Open
          <ChevronRight />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-xs font-semibold text-muted-foreground">{day}</h2>
        <WholeTip cut={cut} text={name}>
          <div
            ref={nameRef}
            data-card-name
            data-cut={cut || undefined}
            className="mt-1 line-clamp-2 text-base font-semibold break-words"
          >
            {name}
          </div>
        </WholeTip>
        <div className="tnum mt-0.5 text-xs text-muted-foreground">{meta}</div>
      </div>
      <WholeTip
        cut={cut || iconOnly}
        text={
          <>
            {cut && <span className="block">{name}</span>}
            {iconOnly && <span className="block">Open in History</span>}
          </>
        }
      >
        <Button
          variant="outline"
          size={iconOnly ? "icon-row" : "row"}
          onClick={onOpen}
          aria-label={`Open ${name} in History`}
          className="shrink-0"
        >
          {!iconOnly && "Open"}
          <ChevronRight />
        </Button>
      </WholeTip>
    </div>
  )
}
