import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { RotateCcw } from "lucide-react"
import { TakePlayer as RehaPlayer } from "@/components/TakePlayer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import { usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import type { Label as RehaLabel, Marker, NotesFile } from "@/lib/api"
import { labelsChanged } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useLabels, useLevels, useLevelsTrouble, useRestore, useTake, type TakePage } from "../api"
import { TakeMarks } from "../marks/MarkItem"
import { usePanel } from "../shell/panel"
import { Group, Groups, Page, Pill, Tile, Trouble, useTitle } from "../shell/parts"
import { useSize } from "../shell/size"
import { clock, count, longDay, takeText } from "../shell/words"
import { chipsOf } from "./chips"
import { Desk } from "./Desk"
import { Download } from "./Download"
import { useBackingSong } from "./player/backing"
import { notesAlone, notesOf } from "./player/lanes"
import { CANNOT_PLAY, usePlayer, useTime } from "./player/one"
import { useServiceSound, type ServiceSound } from "./player/sound"
import { Play, StarButton, TakeName, Wave } from "./parts"
import { SongWord } from "./move"
import { TakeMenu } from "./TakeMenu"

/**
 * A take's page, for close work. On a computer, РЭХА's own player: a lane
 * per track with its level, M and S, the notes of a track that sent its
 * .mid, Master with its level and meter, a piece on repeat, the marks as
 * chips whose talk opens in the panel. On a phone, the take's wave, a row
 * per track as РЭХА's desk has them, the MIDI sign on a track that sent
 * notes, Master and its marks. The take's Backing track is last, muted the
 * first time a take of its song opens, and after that as you last left its
 * M for that song (player/backing.ts). **Download**, by the take's name, gives
 * the mix and the tracks (Download.tsx). A link from the band's chat carries
 * ?at= (the playhead goes there) and the mark or comment it is about.
 */
export function Take() {
  const { uid } = useParams({ from: "/band/takes/$uid" })
  const { at, mark, comment } = useSearch({ from: "/band/takes/$uid" })
  const take = useTake(uid)
  useTitle(take.data && takeText(take.data))
  const p = usePlayer()
  const size = useSize()
  const { open } = usePanel()
  const navigate = useNavigate()
  const [shown, setShown] = useState("")
  const ready = !!take.data
  useEffect(() => {
    if (!ready) return
    p.cue(uid, at ?? 0)
    // Once a take's page has come; the player's own changes are not a reason to cue again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, ready])
  useEffect(() => {
    if (!take.data || (mark === undefined && comment === undefined)) return
    const about = take.data.marks.find((m) => m.id === mark || m.comments.some((c) => c.id === comment))
    // Once for each link: the page is read again after every change.
    const link = `${uid}/${mark}/${comment}`
    if (!about || shown === link) return
    setShown(link)
    if (size === "phone") document.querySelector(`[data-mark="${about.id}"]`)?.scrollIntoView({ block: "center" })
    // The page under the mark without what the link was about: folding the
    // drawer, Esc or Back come back to it, and a reload does not open the
    // mark again.
    else
      void navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => ({ ...prev, mark: undefined, comment: undefined })) as never,
        replace: true,
        resetScroll: false,
      }).then(() => open({ kind: "mark", uid, id: about.id }))
  }, [take.data, mark, comment, uid, size, shown, open, navigate])
  if (take.error) return <Trouble error={take.error} retry={() => void take.refetch()} />
  if (!take.data) return null
  return <TakeView take={take.data} />
}

function InTrash({ uid }: { uid: string }) {
  const restore = useRestore()
  return (
    <Tile boxed className="border-warn/50">
      <span>This take is in the Trash. It is deleted for good 30 days after it was put there.</span>
      <Button variant="outline" size="row" className="self-start" disabled={restore.isPending} onClick={() => restore.mutate(uid)}>
        Restore
      </Button>
    </Tile>
  )
}

/** The band's labels in РЭХА's own store, which its player draws the marks with. */
function useRehaLabels() {
  const labels = useLabels().data
  useEffect(() => {
    if (labels) labelsChanged(labels as RehaLabel[])
  }, [labels])
}

/** The way back to РЭХА's levels, under the faders it sets (Alex,
 *  2026-11-04): under Master's plate on a computer (`under`, the player's
 *  row there), under the desk's Master on a phone. It is always there, so
 *  nothing moves, and faded while the levels are the ones РЭХА sent; the
 *  tip says whose they are. Moving a fader makes them yours and the button
 *  live. A failure to keep them is said beside it. */
function Levels({ take, sound, under = false }: { take: TakePage; sound: ServiceSound; under?: boolean }) {
  const yours = useLevels().data?.levels
  const trouble = useLevelsTrouble()
  const mine = take.tracks.some((t) => yours?.[t.name] !== undefined)
  const [busy, setBusy] = useState(false)
  const button = (
    <Tooltip>
      {/* On the span: a button that is off takes no pointer, and its tip
          would never open. */}
      <TooltipTrigger asChild>
        <span className={cn("flex w-fit", under && "px-3")}>
          <Button
            variant="outline"
            size="row"
            disabled={!mine || busy}
            onClick={() => {
              setBusy(true)
              // A failure is said beside it.
              sound
                .backToReha()
                .catch(() => {})
                .finally(() => setBusy(false))
            }}
          >
            <RotateCcw />
            РЭХА's levels
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {mine ? "Your levels: only you hear them. This puts back the ones РЭХА sent." : "The levels as РЭХА sent them"}
      </TooltipContent>
    </Tooltip>
  )
  const said = trouble && <FieldError className="min-w-0">Your levels were not kept: {trouble}</FieldError>
  // Under Master the two are cells of the player's row, on its columns.
  return (
    <div data-levels className={under ? "contents" : "flex items-center gap-3"}>
      {button}
      {said}
    </div>
  )
}

/** The take's lanes of notes, made again only when its files are. */
function useNotes(take: TakePage) {
  // The page is read again after every change; its files keep their identity unless they changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => notesOf(take), [take.uid, take.gen, take.tracks, take.notes])
}

/** РЭХА's player for the take, opened once the take's song says how its Backing track opens. */
function useTakePlayer(take: TakePage, sound: ServiceSound) {
  const song = useBackingSong(take)
  return useMultitrackPlayer(song === undefined ? null : sound.tracks, take.duration_sec, song ?? null, sound)
}

/** РЭХА's player on the page itself, with no frame round it, as in РЭХА. */
function Full({ take, notes, sound }: { take: TakePage; notes: NotesFile[]; sound: ServiceSound }) {
  // РЭХА counts it after the take's files are up: until then, the click alone.
  const drift = useMemo(() => ({ answer: take.drift, counting: false }), [take.drift])
  const player = useTakePlayer(take, sound)
  const { open } = usePanel()
  useRehaLabels()
  useSpacebar(player.toggle)
  usePlayerKeys(player.skip)
  const { markers, markOf } = chipsOf(take.marks)
  const talk = (m: Marker) => {
    const k = markOf(m)
    if (k) open({ kind: "mark", uid: take.uid, id: k.id })
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div data-take-player className="flex flex-col">
        <RehaPlayer
          player={player}
          // No click button: the service plays none (Alex's pick, 2026-11-03). Master's lane is as in
          // РЭХА, the click's stripes and the band's tempo РЭХА counted (his picks, 2026-11-03 22:24 and 22:26).
          click={false}
          take={take.meter}
          drift={drift}
          notes={notes}
          markers={markers}
          onAddMarker={(at) => open({ kind: "mark", uid: take.uid, at })}
          onEditMarker={talk}
          // A talk sign and how many comments, where РЭХА has its pencil (Alex's pick B, 2026-11-02).
          talkOf={(m) => markOf(m)?.comments.length ?? 0}
          spaceKey
          underMaster={<Levels take={take} sound={sound} under />}
        />
      </div>
    </div>
  )
}

/**
 * The take's player on one line: ▶ on the wave's level, the wave with the
 * time in its corner (Alex, 2026-11-04: «На волне»).
 */
function TakePlayer({ take, height = 64 }: { take: TakePage; height?: number }) {
  const at = useTime(take.uid)
  return (
    <div className="flex items-center gap-3">
      <Play take={take} />
      <div className="relative min-w-0 flex-1">
        <Wave take={take} height={height} starred={take.stars.length > 0} moves />
        <span
          data-testid="clock"
          className="tnum pointer-events-none absolute right-0 bottom-0 rounded bg-background/85 px-1 text-xs leading-4 text-muted-foreground"
        >
          {clock(at)} / {clock(take.duration_sec)}
        </span>
      </div>
    </div>
  )
}

/** On a phone: the take's wave with ▶, a row per track as on РЭХА's desk, then the marks. */
function Phone({ take, notes, tracks, sound }: { take: TakePage; notes: NotesFile[]; tracks: number; sound: ServiceSound }) {
  const player = useTakePlayer(take, sound)
  return (
    <Groups>
      <Group>
        <TakePlayer take={take} height={72} />
      </Group>
      <Group title="Tracks" hint={String(tracks)}>
        <Desk take={take} player={player} notes={notes} />
        <Levels take={take} sound={sound} />
      </Group>
      <TakeMarks take={take} />
    </Groups>
  )
}

function TakeView({ take }: { take: TakePage }) {
  const p = usePlayer()
  const navigate = useNavigate()
  const size = useSize()
  const song = take.song
  const phone = size === "phone"
  const cannot = p.supported === false
  const notes = useNotes(take)
  // One for the page: the player, the desk and Download read the same levels, M and S.
  const sound = useServiceSound(take)
  // A track of notes alone is one of the band's tracks too, as in a lineup.
  const tracks = take.tracks.length + notesAlone(take, notes).length
  return (
    <Page
      title={
        <span className="flex flex-wrap items-center gap-3">
          {/* A long name wraps rather than being cut (2026-11-04). */}
          <TakeName take={take} wrap className="min-w-0" />
          {take.starred_at_rehearsal && (
            <Badge variant="signal" className="text-xs font-normal">
              ★ at rehearsal
            </Badge>
          )}
          <span className="flex-1" />
          <span className="text-sm font-normal">
            <Download take={take} sound={sound} phone={phone} />
          </span>
          <span className="text-sm font-normal">
            <StarButton take={take} who disabled={!!take.trashed_at} />
          </span>
          {!take.trashed_at && (
            <TakeMenu
              take={take}
              // Its rehearsal's page, where the take was, in place of its own.
              onGone={() => void navigate({ to: "/rehearsals/$uid", params: { uid: take.rehearsal.uid }, replace: true })}
            />
          )}
        </span>
      }
      sub={
        // Where the take comes from, each a pill to its page (Alex's pick Б, 2026-11-10).
        <span className="mt-1 flex flex-wrap items-center gap-2">
          {song && (
            <Pill kind="song" to="/songs/$id" params={{ id: String(song.id) }}>
              {song.title}
            </Pill>
          )}
          <Pill kind="rehearsal" to="/rehearsals/$uid" params={{ uid: take.rehearsal.uid }}>
            {longDay(take.date)}
          </Pill>
          <SongWord take={take} />
          <span>{`${clock(take.duration_sec)} · ${count(tracks, "track")}`}</span>
        </span>
      }
    >
      {take.trashed_at && <InTrash uid={take.uid} />}
      {phone && !cannot ? (
        <Phone take={take} notes={notes} tracks={tracks} sound={sound} />
      ) : (
        <>
          {/* On a computer РЭХА's player sits on the page itself, as in РЭХА, with no card round it. */}
          {!cannot && <Full take={take} notes={notes} sound={sound} />}
          {/* The marks are the player's chips; with no player, a list. */}
          {cannot && (
            <Groups>
              <Group>
                <p className="text-muted-foreground">{CANNOT_PLAY}</p>
              </Group>
              <TakeMarks take={take} />
            </Groups>
          )}
        </>
      )}
    </Page>
  )
}
