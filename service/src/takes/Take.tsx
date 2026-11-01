import { useEffect } from "react"
import { useParams, useSearch } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useRestore, useTake, type TakePage } from "../api"
import { TakeMarks } from "../marks/MarkItem"
import { Back, Columns, Group, Groups, Note, Page, Tile } from "../shell/parts"
import { useSize } from "../shell/size"
import { clock, count, longDay } from "../shell/words"
import { Downloads } from "./Downloads"
import { CANNOT_PLAY, usePlayer } from "./player/one"
import { StarButton, TakeName } from "./parts"
import { Lanes, TakePlayer } from "./TakePanel"

/**
 * A take's page, for close work: its player, a lane per track with M and
 * S, the tracks to download, and its marks. A link from the band's chat
 * carries ?at= (the playhead goes there) and the mark or comment it is about.
 */
export function Take() {
  const { uid } = useParams({ from: "/band/takes/$uid" })
  const { at, mark, comment } = useSearch({ from: "/band/takes/$uid" })
  const take = useTake(uid)
  const p = usePlayer()
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
    if (about) document.querySelector(`[data-mark="${about.id}"]`)?.scrollIntoView({ block: "center" })
  }, [take.data, mark, comment])
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

function TakeView({ take }: { take: TakePage }) {
  const p = usePlayer()
  const size = useSize()
  const song = take.song
  const player = (
    <Group>
      {p.supported === false ? <p className="text-muted-foreground">{CANNOT_PLAY}</p> : <TakePlayer take={take} height={72} />}
    </Group>
  )
  const tracks = (
    <Group title="Tracks" hint={String(take.tracks.length)}>
      <Lanes take={take} />
    </Group>
  )
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
      {size === "wide" ? (
        <Columns
          main={
            <Groups>
              {player}
              {tracks}
              <Downloads take={take} />
            </Groups>
          }
          sideWidth="minmax(0,0.8fr)"
          side={
            <Groups>
              <TakeMarks take={take} />
            </Groups>
          }
        />
      ) : (
        // One under another: the marks before the downloads, which are for the computer at home.
        <Groups>
          {player}
          {tracks}
          <TakeMarks take={take} />
          <Downloads take={take} />
        </Groups>
      )}
    </Page>
  )
}
