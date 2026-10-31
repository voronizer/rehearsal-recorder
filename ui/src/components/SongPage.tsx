import { useCallback, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { MarkLine } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import { useCut, WholeTip } from "@/components/ui/whole"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import type { Label, Marker, SendTo, Signature, SongDetail, SongGo } from "@/lib/api"
import { formatDayIn } from "@/lib/format"
import { labelOf, markText, useLabels } from "@/lib/labels"
import { rise } from "@/lib/motion"
import { playLook } from "@/lib/playLook"
import {
  fromLastTime,
  hereFor,
  pageLine,
  placed,
  rungsOf,
  type PlacedPlayback,
  type PlacedTake,
} from "@/lib/songs"
import { OldNames } from "@/components/OldNames"
import { PaneHead } from "@/components/PaneHead"
import { TakeRow } from "@/components/RehearsalOverview"
import { SongLadder } from "@/components/SongLadder"
import { SongBacking, type BackingSong } from "@/components/backing/SongBacking"
import { SongTempoRow } from "@/components/metronome/SongTempoRow"
import { TakeTitle } from "@/components/TakeTitle"

/**
 * A song's page, on the right of History's Songs view: every take of it,
 * from every rehearsal. Its head is the pane head the rehearsal's page has:
 * the ▶ that plays the take worth hearing first (the newest ★ one, or the
 * last) from a rehearsal on disk, the title with the pencil for Rename song,
 * how much it was played and when, what ▶ plays, the names it is also
 * typed as, each to forget, its tempo (SongTempoRow) and its backing track
 * (SongBacking). A song with no takes yet, made with New song or kept for
 * its backing track, says where its first comes from, and has nothing to
 * play.
 *
 * Under the head, one group, its parts split by lines: the ★ takes on their
 * own, then what the band marked on the song last time, then every take as a
 * ladder (`SongLadder`). A part with nothing in it is left out.
 *
 * The takes nobody named have a page too, so they can be found and given a
 * song; it has nothing to play first, no pencil, and no ★ takes or marks of
 * its own.
 */
export function SongPage({
  page,
  playback,
  open,
  onToggle,
  onPlay,
  onOpen,
  onOpenAt,
  onRename,
  onStar,
  onShare,
  onDelete,
  onOpenRehearsal,
  onRenameSong,
  onForgetName,
  onChanged,
  sendTo,
}: {
  page: SongDetail
  playback: PlacedPlayback | null
  /** The rungs open, by their rehearsal's folder. */
  open: ReadonlySet<string>
  onToggle: (folder: string) => void
  onPlay: (take: PlacedTake) => void
  onOpen: (take: PlacedTake) => void
  onOpenAt: (take: PlacedTake, at: number) => void
  onRename: (take: PlacedTake) => void
  onStar: (take: PlacedTake, starred: boolean) => void
  onShare: (take: PlacedTake) => void
  onDelete: (take: PlacedTake) => void
  onOpenRehearsal: (folder: string) => void
  /** Where takes go: the cloud button's words are its. */
  sendTo?: SendTo
  onRenameSong: () => void
  onForgetName: (name: string) => void
  /** The song was changed on its page: the list and the page are read
   *  again. */
  onChanged: () => void
}) {
  const labels = useLabels()
  const goes = page.goes ?? []
  const unnamed = page.title == null
  const plays = unnamed ? null : (page.plays ?? null)
  const here = plays ? hereFor(playback, plays.folder, plays.take) : null
  // Playing, the head's ▶ has Space while Settings › Keys has it on.
  const spaceKeys = useKeysOn("space")
  const longest = Math.max(1, ...goes.map((g) => g.take.duration_sec || 0))
  // Newest first: the newest rehearsal first, and in it the last take played.
  const starred = unnamed
    ? []
    : goes
        .filter((g) => g.take.starred)
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) || b.take.take_number - a.take.take_number
        )
  const marks = unnamed ? [] : fromLastTime(goes)
  const rungs = rungsOf(goes)

  const parts: { name: string; title: ReactNode; body: ReactNode }[] = []
  if (starred.length > 0)
    parts.push({
      name: "Starred",
      title: (
        <>
          <span aria-hidden className="text-signal">
            ★
          </span>{" "}
          Starred
        </>
      ),
      body: (
        <div className="flex flex-col gap-1">
          {starred.map((go) => (
            <TakeRow
              key={`${go.folder}#${go.take.take_number}`}
              take={go.take}
              unnamed={false}
              longest={longest}
              missing={go.missing}
              where={`${go.rehearsal} · ${formatDayIn(go.created_at)}`}
              here={hereFor(playback, go.folder, go.take)}
              onPlay={(t) => onPlay(placed(go.folder, t))}
              onOpen={(t) => onOpen(placed(go.folder, t))}
              onOpenAt={(t, sec) => onOpenAt(placed(go.folder, t), sec)}
              onRename={(t) => onRename(placed(go.folder, t))}
              onStar={(t, on) => onStar(placed(go.folder, t), on)}
              onShare={(t) => onShare(placed(go.folder, t))}
              onDelete={(t) => onDelete(placed(go.folder, t))}
              sendTo={sendTo}
            />
          ))}
        </div>
      ),
    })
  if (marks.length > 0)
    parts.push({
      name: "From last time",
      title: `From last time · ${formatDayIn(marks[0].go.created_at)}`,
      // The notes reach 8 px further out than the title, as a take's row
      // does, so the dots line up with it.
      body: (
        <div className="-mx-2 flex flex-col">
          {marks.map(({ go, marker }) => (
            <Note
              key={`${go.take.take_number}-${marker.at}`}
              go={go}
              marker={marker}
              label={labelOf(labels, marker.label_id)}
              onOpen={() => onOpenAt(placed(go.folder, go.take), marker.at)}
            />
          ))}
        </div>
      ),
    })
  if (rungs.length > 0)
    parts.push({
      name: "Every take",
      title: "Every take",
      body: (
        <SongLadder
          rungs={rungs}
          longest={longest}
          unnamed={unnamed}
          open={open}
          onToggle={onToggle}
          playback={playback}
          onPlay={onPlay}
          onOpen={onOpen}
          onOpenAt={onOpenAt}
          onRename={onRename}
          onStar={onStar}
          onShare={onShare}
          onDelete={onDelete}
          onOpenRehearsal={onOpenRehearsal}
          sendTo={sendTo}
        />
      ),
    })

  return (
    <div className="flex flex-col gap-8">
      {/* The head holds its place from the first frame: it does not rise. */}
      <PaneHead
        data-song-head
        lead={
          plays && (
            <PlayButton
              size="head"
              look={playLook({
                loaded: here !== null,
                playing: here?.playing ?? false,
                loading: here?.loading ?? false,
                failed: here?.failed ?? false,
                missing: false,
              })}
              name={plays.take.name}
              onClick={() => onPlay(placed(plays.folder, plays.take))}
              aria-keyshortcuts={here && spaceKeys ? "Space" : undefined}
            />
          )
        }
        title={page.title ?? "Not named"}
        muted={unnamed}
        rename={
          unnamed
            ? undefined
            : { label: `Rename song ${page.title}`, tip: "Rename song", onClick: onRenameSong }
        }
        lines={
          <>
            <p className="text-sm text-muted-foreground">{pageLine(goes, unnamed)}</p>
            {goes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {unnamed ? (
                "Takes nobody named. Rename one to give it a song."
              ) : !plays ? (
                "Nothing to play: every take is on a drive that is not plugged in"
              ) : plays.take.starred ? (
                <>
                  ▶ plays <span className="text-signal">★</span> {plays.take.name} ·{" "}
                  {formatDayIn(plays.created_at)}
                </>
              ) : (
                `▶ plays the last take, ${plays.take.name} · ${formatDayIn(plays.created_at)}`
              )}
            </p>
            )}
            {!unnamed && <OldNames names={page.also ?? []} onForget={onForgetName} />}
            {/* Its tempo and backing track, under what it is: changed here,
                saved at once. */}
            {!unnamed && page.id != null && page.title != null && (
              <SongSetup
                key={page.id}
                song={{
                  id: page.id,
                  title: page.title,
                  tempo: page.tempo ?? null,
                  signature: page.signature ?? null,
                  backing: page.backing ?? null,
                }}
                takes={goes}
                onChanged={onChanged}
              />
            )}
          </>
        }
      />

      {parts.length > 0 && (
        <div
          data-song-parts
          className="flex animate-rise flex-col rounded-xl bg-card"
          style={rise(1)}
        >
          {parts.map((part, i) => (
            <section
              key={part.name}
              aria-label={part.name}
              className={cn("flex flex-col gap-3 px-6 py-6", i > 0 && "border-t")}
            >
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">{part.title}</h3>
              {part.body}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A song's tempo row and its backing track, which go by the same tempo: the
 * one the tempo row has saved, or the backing track's once the song takes
 * it, shown in both at once, before the page is read again. One ▶ plays at
 * a time: each stops the other.
 */
function SongSetup({
  song,
  takes,
  onChanged,
}: {
  song: BackingSong
  takes: SongGo[]
  onChanged: () => void
}) {
  const [meter, setMeter] = useState({ tempo: song.tempo, signature: song.signature })
  // The song as the page reads it again: its tempo now.
  const [read, setRead] = useState({ tempo: song.tempo, signature: song.signature })
  if (read.tempo !== song.tempo || read.signature !== song.signature) {
    setRead({ tempo: song.tempo, signature: song.signature })
    setMeter({ tempo: song.tempo, signature: song.signature })
  }
  const onSaved = useCallback(
    (tempo: number | null, signature: Signature) =>
      setMeter((m) => (m.tempo === tempo && m.signature === signature ? m : { tempo, signature })),
    []
  )
  // How many times each ▶ was stopped by the other's.
  const [stops, setStops] = useState({ click: 0, backing: 0 })
  const now = { ...song, tempo: meter.tempo, signature: meter.signature }
  return (
    <>
      <SongTempoRow
        song={now}
        takes={takes}
        onSaved={onSaved}
        stopped={stops.click}
        onPlay={() => setStops((s) => ({ ...s, backing: s.backing + 1 }))}
      />
      <SongBacking
        song={now}
        onTempo={(tempo) => setMeter((m) => ({ ...m, tempo }))}
        onChanged={onChanged}
        stopped={stops.backing}
        onPlay={() => setStops((s) => ({ ...s, click: s.click + 1 }))}
      />
    </>
  )
}

/**
 * A mark from last time, as the shared button that opens its take at the
 * mark. MarkLine cuts the take's name and the words at the end of the line;
 * cut, they show whole in the shared tip, on hover and from the keys, as a
 * comment in Marks does.
 */
function Note({
  go,
  marker,
  label,
  onOpen,
}: {
  go: SongGo
  marker: Marker
  label: Label
  onOpen: () => void
}) {
  const [cutRef, cut] = useCut<HTMLElement>()
  // MarkLine, in components/ui, takes no ref, so the part of it that is
  // cut is found in the button and measured there.
  const measure = useCallback(
    (button: HTMLButtonElement | null) =>
      cutRef(button?.querySelector<HTMLElement>("span[data-note] > .truncate") ?? null),
    [cutRef]
  )
  return (
    <WholeTip
      cut={cut}
      text={
        <>
          <TakeTitle take={go.take} /> · {markText(label, marker.note)}
        </>
      }
    >
      <Button
        ref={measure}
        variant="ghost"
        data-note
        onClick={onOpen}
        className="h-auto w-full justify-start px-2 py-1 text-sm font-normal"
      >
        <MarkLine label={label} at={marker.at} note={marker.note} take={<TakeTitle take={go.take} />} />
      </Button>
    </WholeTip>
  )
}
