import { useEffect, useState } from "react"
import { useParams, useSearch } from "@tanstack/react-router"
import { RotateCcw } from "lucide-react"
import { TakePlayer as RehaPlayer } from "@/components/TakePlayer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import { usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import type { Label as RehaLabel, Marker } from "@/lib/api"
import { labelsChanged } from "@/lib/labels"
import { useLabels, useLevels, useLevelsTrouble, useRestore, useTake, type TakePage } from "../api"
import { TakeMarks } from "../marks/MarkItem"
import { usePanel } from "../shell/panel"
import { Back, Group, Groups, Note, Page, Tile } from "../shell/parts"
import { useSize } from "../shell/size"
import { clock, count, longDay } from "../shell/words"
import { chipsOf } from "./chips"
import { Desk } from "./Desk"
import { Downloads } from "./Downloads"
import { CANNOT_PLAY, useHeardAgain, usePlayer } from "./player/one"
import { useServiceSound, type ServiceSound } from "./player/sound"
import { StarButton, TakeName } from "./parts"
import { TakePlayer } from "./TakePanel"

/**
 * A take's page, for close work. On a computer, РЭХА's own player: a lane
 * per track with its level, M and S, a piece on repeat, the marks as chips
 * whose talk opens in the panel; the tracks to download under it. On a
 * phone, the take's wave, a row per track as РЭХА's desk has them, its
 * marks and the downloads. A link from the band's chat carries ?at= (the
 * playhead goes there) and the mark or comment it is about.
 */
export function Take() {
  const { uid } = useParams({ from: "/band/takes/$uid" })
  const { at, mark, comment } = useSearch({ from: "/band/takes/$uid" })
  const take = useTake(uid)
  const p = usePlayer()
  const size = useSize()
  const { open } = usePanel()
  const [shown, setShown] = useState("")
  useHeardAgain(take.data)
  const ready = !!take.data
  useEffect(() => {
    if (!ready) return
    p.heard(uid)
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
    else open({ kind: "mark", uid, id: about.id })
  }, [take.data, mark, comment, uid, size, shown, open])
  if (take.error) return <Note>{take.error.message}</Note>
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

/** The line under the player: whose levels these are, and the way back to РЭХА's. */
function Levels({ take, sound }: { take: TakePage; sound: ServiceSound }) {
  const yours = useLevels().data?.levels
  const trouble = useLevelsTrouble()
  const mine = take.tracks.some((t) => yours?.[t.name] !== undefined)
  const [busy, setBusy] = useState(false)
  return (
    <div data-levels className="flex items-center gap-2 text-sm text-muted-foreground">
      {/* On the same line, so nothing under it moves. */}
      {trouble ? (
        <span role="alert" className="min-w-0 flex-1 text-destructive">
          Your levels were not kept: {trouble}
        </span>
      ) : (
        <span className="min-w-0 flex-1">{mine ? "Your levels. Only you hear them." : "Levels as РЭХА sent them."}</span>
      )}
      <Button
        variant="outline"
        size="row"
        disabled={!mine || busy}
        onClick={() => {
          setBusy(true)
          // A failure is said on the line.
          sound
            .backToReha()
            .catch(() => {})
            .finally(() => setBusy(false))
        }}
      >
        <RotateCcw />
        РЭХА's levels
      </Button>
    </div>
  )
}

/** РЭХА's player on the page itself, with no frame round it, as in РЭХА. */
function Full({ take }: { take: TakePage }) {
  const sound = useServiceSound(take)
  const player = useMultitrackPlayer(sound.tracks, take.duration_sec, null, sound)
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
          master={false}
          markers={markers}
          onAddMarker={(at) => open({ kind: "mark", uid: take.uid, at })}
          onEditMarker={talk}
          spaceKey
        />
      </div>
      <Levels take={take} sound={sound} />
    </div>
  )
}

/**
 * On a phone: the take's wave with ▶, a row per track as on РЭХА's desk,
 * the marks, then the downloads, which are for the computer at home.
 */
function Phone({ take }: { take: TakePage }) {
  const sound = useServiceSound(take)
  const player = useMultitrackPlayer(sound.tracks, take.duration_sec, null, sound)
  return (
    <Groups>
      <Group>
        <TakePlayer take={take} height={72} />
      </Group>
      <Group title="Tracks" hint={String(take.tracks.length)}>
        <Desk take={take} player={player} />
        <Levels take={take} sound={sound} />
      </Group>
      <TakeMarks take={take} />
      <Downloads take={take} />
    </Groups>
  )
}

function TakeView({ take }: { take: TakePage }) {
  const p = usePlayer()
  const size = useSize()
  const song = take.song
  const phone = size === "phone"
  const cannot = p.supported === false
  return (
    <Page
      head={song ? <Back to="/songs/$id" params={{ id: String(song.id) }} label={song.title} /> : <Back to="/songs" label="Songs" />}
      title={
        <span className="flex flex-wrap items-center gap-3">
          <TakeName take={take} />
          {take.starred_at_rehearsal && (
            <Badge variant="signal" className="text-xs font-normal">
              ★ at rehearsal
            </Badge>
          )}
          <span className="flex-1" />
          <span className="text-sm font-normal">
            <StarButton take={take} who disabled={!!take.trashed_at} />
          </span>
        </span>
      }
      sub={`${longDay(take.date)} · ${clock(take.duration_sec)} · ${count(take.tracks.length, "track")}`}
    >
      {take.trashed_at && <InTrash uid={take.uid} />}
      {phone && !cannot ? (
        <Phone take={take} />
      ) : (
        <>
          {/* On a computer РЭХА's player sits on the page itself, as in РЭХА, with no card round it. */}
          {!cannot && <Full take={take} />}
          <Groups>
            {cannot && (
              <Group>
                <p className="text-muted-foreground">{CANNOT_PLAY}</p>
              </Group>
            )}
            {/* The marks are the player's chips here; on a phone, or with no player, a list. */}
            {(phone || cannot) && <TakeMarks take={take} />}
            <Downloads take={take} />
          </Groups>
        </>
      )}
    </Page>
  )
}
