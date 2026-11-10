import { useNavigate, useParams } from "@tanstack/react-router"
import { useSong, type TakeRow } from "../api"
import { Back, Columns, Group, Groups, Page, Pill, Rows, Trouble, useTitle } from "../shell/parts"
import { clock, count, longDay } from "../shell/words"
import { TakeLine } from "../takes/parts"
import { InPlaceTitle, TempoControls, TitleFacts } from "./edit"
import { AddFile, BestTake, Files, KeySelect, Notes, SongMenu, StatusMenu, why } from "./parts"

/** A song's takes by rehearsal, newest first, the newest rehearsal open; each day a pill to its rehearsal. */
function AllTakes({ takes }: { takes: TakeRow[] }) {
  const days = [...new Set(takes.map((t) => t.rehearsal_uid))]
  return (
    <div className="flex flex-col gap-3">
      {days.map((d, i) => {
        const these = takes.filter((t) => t.rehearsal_uid === d)
        return (
          <Group
            key={d}
            small
            name={longDay(these[0].date)}
            title={
              <Pill kind="rehearsal" to="/rehearsals/$uid" params={{ uid: d }}>
                {longDay(these[0].date)}
              </Pill>
            }
            hint={count(these.length, "take")}
            fold={i === 0 ? "open" : "closed"}
          >
            <Rows takes>
              {these.map((t) => (
                <TakeLine key={t.uid} take={t} />
              ))}
            </Rows>
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
  useTitle(page.data?.song.title)
  const navigate = useNavigate()
  if (page.error) return <Trouble error={page.error} retry={() => void page.refetch()} />
  if (!page.data) return null
  const { song, takes, files } = page.data
  // The tempo is not among them: its field stands by the key.
  const facts = [
    song.best && clock(song.best.duration_sec),
    takes.length ? `${count(takes.length, "take")} on ${count(song.rehearsals, "rehearsal")}` : "no takes yet",
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <Page
      head={<Back to="/songs" label="Songs" />}
      title={
        <span className="flex flex-wrap items-center gap-3">
          <InPlaceTitle song={song}>
            <span className="min-w-0 [overflow-wrap:anywhere]">{song.title}</span>
          </InPlaceTitle>
          <StatusMenu song={song} />
          <KeySelect song={song} />
          <TempoControls song={song} />
          {/* ⋯ is the song's, not the tempo's: at the row's far end (Alex, 5 November). */}
          <span className="flex-1" />
          <SongMenu song={song} onGone={() => navigate({ to: "/songs", replace: true })} />
        </span>
      }
      sub={<TitleFacts song={song}>{facts}</TitleFacts>}
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
