import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMarks, type Show } from "../api"
import { Empty, Group, Groups, Note, Page, Rows, TitleWith } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { MarkItem } from "./MarkItem"

const SHOWS: [Show, string][] = [
  ["open", "Open"],
  ["closed", "Closed"],
  ["all", "All"],
]

/** **Marks**: open, closed or all, grouped by song, with **Labels** at the top right. */
export function Marks() {
  const [show, setShow] = useState<Show>("open")
  const list = useMarks(show)
  const { open } = usePanel()
  const head = (
    <TitleWith title="Marks">
      <Button variant="outline" size="row" onClick={() => open({ kind: "labels" })}>
        Labels
      </Button>
    </TitleWith>
  )
  if (list.error) return <Note>{list.error.message}</Note>
  if (!list.data) return null
  const { counts, marks } = list.data
  if (!counts.all) return <Empty title={head} text="No marks yet. Marks set in РЭХА come with the takes, and anyone can set one on a take here." />
  const songs = [...new Set(marks.map((k) => k.take.song_title ?? "Not named"))]
  return (
    <Page
      title={head}
      sub="A mark sits on a moment of a take, with a label and its colour. It comes from РЭХА or is set here, the band comments under it, and it is closed once the place is fixed."
    >
      <ToggleGroup type="single" variant="outline" value={show} onValueChange={(v) => v && setShow(v as Show)} className="self-start" aria-label="Which marks">
        {SHOWS.map(([value, label]) => (
          <ToggleGroupItem key={value} value={value} className="gap-1.5 px-3">
            {label}
            <span className="tnum text-muted-foreground">{counts[value]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {marks.length ? (
        <Groups>
          {songs.map((s) => {
            const ks = marks.filter((k) => (k.take.song_title ?? "Not named") === s)
            return (
              <Group key={s} title={s} hint={String(ks.length)} fold="open">
                <Rows>
                  {ks.map((k) => (
                    <MarkItem key={k.id} mark={k} take={k.take.song_title ? "short" : "full"} />
                  ))}
                </Rows>
              </Group>
            )
          })}
        </Groups>
      ) : (
        <p className="text-muted-foreground">{show === "open" ? "Every mark is closed." : "No mark is closed yet."}</p>
      )}
    </Page>
  )
}
