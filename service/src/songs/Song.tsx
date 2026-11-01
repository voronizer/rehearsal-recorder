import { useNavigate, useParams } from "@tanstack/react-router"
import { useSong, type TakeRow } from "../api"
import { Back, Columns, Group, Groups, Note, Page } from "../shell/parts"
import { clock, count, longDay } from "../shell/words"
import { TakeLine } from "../takes/parts"
import { AddFile, BestTake, Files, Notes, SongMenu, StatusMenu, why } from "./parts"

/** A song's takes by rehearsal, newest first, the newest rehearsal open. */
function AllTakes({ takes }: { takes: TakeRow[] }) {
  const days = [...new Set(takes.map((t) => t.rehearsal_uid))]
  return (
    <div className="flex flex-col gap-3">
      {days.map((d, i) => {
        const these = takes.filter((t) => t.rehearsal_uid === d)
        return (
          <Group key={d} small title={longDay(these[0].date)} hint={count(these.length, "take")} fold={i === 0 ? "open" : "closed"}>
            <div className="flex flex-col gap-1">
              {these.map((t) => (
                <TakeLine key={t.uid} take={t} />
              ))}
            </div>
          </Group>
        )
      })}
    </div>
  )
}

/** A song's page, for close work: its best take with its marks, notes, files, and every take. */
export function Song() {
  const { id } = useParams({ from: "/band/songs/$id" })
  const page = useSong(Number(id))
  const navigate = useNavigate()
  if (page.error) return <Note>{page.error.message}</Note>
  if (!page.data) return null
  const { song, takes, files } = page.data
  const facts = [
    song.key,
    song.tempo && `${Math.round(song.tempo)} bpm`,
    song.best && clock(song.best.duration_sec),
    takes.length ? `${count(takes.length, "take")} on ${count(song.rehearsals, "rehearsal")}` : "no takes yet",
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <Page
      head={<Back to="/songs" label="Songs" />}
      title={
        <span className="flex items-center gap-3">
          {song.title}
          <StatusMenu song={song} />
          <SongMenu song={song} onGone={() => navigate({ to: "/songs" })} />
        </span>
      }
      sub={facts}
    >
      <Groups>
        <Group title="Best take" hint={why(song)}>
          <BestTake song={song} big />
        </Group>
        <Columns
          sideWidth="minmax(0,1fr)"
          main={
            <Group title="Notes">
              <Notes song={song} />
            </Group>
          }
          side={
            <Group title="Files" action={<AddFile song={song} />}>
              <Files song={song} files={files} />
            </Group>
          }
        />
        {takes.length > 0 && (
          <Group title="All takes" hint={String(takes.length)}>
            <AllTakes takes={takes} />
          </Group>
        )}
      </Groups>
    </Page>
  )
}
