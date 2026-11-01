import { Link, useParams } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import { bestOf, dayOf, fmt, rehearsalsOf, songOf, takesOf, useData } from "./data"
import { Play } from "./Home"
import { AddFile, BestTake, Files, Notes, StatusMenu } from "./panels"
import { Columns, Group, Groups, Page, Rows, StarButton, TakeLink, Wave, takesN } from "./parts"

/** A song's takes by rehearsal, newest first. */
export function AllTakes({ title }: { title: string }) {
  const data = useData()
  const ts = takesOf(data, title)
  const days = [...new Set(ts.map((t) => t.day))].reverse()
  return (
    <div className="flex flex-col gap-3">
      {days.map((d, i) => (
        <Group key={d} small title={dayOf(data, d).long} hint={takesN(ts.filter((t) => t.day === d).length)} fold={i === 0 ? "open" : "closed"}>
          <Rows>
            {ts
              .filter((t) => t.day === d)
              .reverse()
              .map((t) => (
                <div key={t.uid} className="flex items-center gap-3">
                  <Play uid={t.uid} />
                  <TakeLink uid={t.uid} short className="w-12 shrink-0" />
                  <Wave uid={t.uid} height={28} className="flex-1" />
                  <span className="tnum w-10 shrink-0 text-right text-xs text-muted-foreground">{fmt(t.len)}</span>
                  <StarButton take={t} />
                </div>
              ))}
          </Rows>
        </Group>
      ))}
    </div>
  )
}

export function Song() {
  const { id } = useParams({ from: "/songs/$id" })
  const data = useData()
  const g = songOf(data, id)
  const best = bestOf(data, g.title)
  const n = takesOf(data, g.title).length
  const facts = [g.key, g.bpm && `${g.bpm} bpm`, best && fmt(best.take.len), n ? `${n} takes on ${rehearsalsOf(data, g.title)} rehearsals` : "no takes yet"].filter(Boolean).join(" · ")
  return (
    <Page
      head={
        <Link to="/songs" className="mb-2 flex items-center gap-1 self-start text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          Songs
        </Link>
      }
      title={
        <span className="flex items-center gap-3">
          {g.title}
          <StatusMenu song={g} />
        </span>
      }
      sub={facts}
    >
      <Groups>
        <Group title="Best take" hint={best?.why}>
          <BestTake song={g} big />
        </Group>
        <Columns
          sideWidth="minmax(0,1fr)"
          main={
            <Group title="Notes">
              <Notes song={g} />
            </Group>
          }
          side={
            <Group title="Files" action={<AddFile />}>
              <Files song={g} />
            </Group>
          }
        />
        {n > 0 && (
          <Group title="All takes" hint={String(n)}>
            <AllTakes title={g.title} />
          </Group>
        )}
      </Groups>
    </Page>
  )
}
