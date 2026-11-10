import { useState, type MouseEvent } from "react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LabelDot } from "@/components/ui/mark"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useMarks, type Mark, type Show } from "../api"
import { Empty, Group, Groups, Page, Rows, TitleWith, Trouble, useTitle } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { useSize } from "../shell/size"
import { clock, count, day, localDay } from "../shell/words"
import { useLabelOf } from "../takes/parts"
import { OnTake } from "./MarkItem"

const SHOWS: [Show, string][] = [
  ["open", "To do"],
  ["closed", "Done"],
  ["all", "All"],
]

/**
 * A mark on one line (Alex's pick B, 2026-11-02): its colour, its moment,
 * its words, the take, how many comments, who and when. Pressing it opens
 * the mark in the panel, with the talk and what can be done to it. On a
 * phone the take, who and when go to a second line.
 */
function MarkLine({ mark }: { mark: Mark }) {
  const { open } = usePanel()
  const size = useSize()
  const label = useLabelOf()(mark.label_id)
  const go = () => open({ kind: "mark", uid: mark.take.uid, id: mark.id })
  // The take's name opens the take; anywhere else on the line opens the mark.
  const row = (e: MouseEvent) => !(e.target as HTMLElement).closest("button, a") && go()
  const talk = mark.comments.length
  const who = (
    <span className="min-w-0 truncate text-xs text-muted-foreground">
      {mark.from_reha ? "Set in РЭХА" : mark.author} · {day(localDay(mark.created_at))}
      {mark.closed && " · done"}
    </span>
  )
  // On a phone's second line the take keeps its room; who and when give way.
  const take = (
    <span className={cn("flex min-w-0 text-xs text-muted-foreground", size === "phone" && "shrink-0")}>
      <OnTake take={mark.take} short={false} />
    </span>
  )
  return (
    <div
      data-mark={mark.id}
      data-closed={mark.closed}
      onClick={row}
      className={cn(
        "grid cursor-pointer items-center gap-x-3 gap-y-0.5 text-sm",
        size === "phone"
          ? "grid-cols-[0.5rem_2.5rem_minmax(0,1fr)_auto]"
          : size === "narrow"
            ? "grid-cols-[0.5rem_2.5rem_minmax(0,1fr)_7rem_2.5rem]"
            : "grid-cols-[0.5rem_2.5rem_minmax(0,1fr)_8rem_2.5rem_11rem]",
        mark.closed && "opacity-60"
      )}
    >
      <span title={label.name} className="flex">
        <LabelDot colour={label.colour} />
      </span>
      <span className="tnum text-muted-foreground">{clock(mark.at)}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <button type="button" title={mark.note || label.name} onClick={go} className="min-w-0 truncate text-left">
          {mark.note || label.name}
        </button>
      </span>
      {size !== "phone" && take}
      <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-label={talk ? count(talk, "comment") : undefined}>
        {talk > 0 && (
          <>
            <MessageSquare className="size-3.5" />
            <span className="tnum text-foreground">{talk}</span>
          </>
        )}
      </span>
      {size === "wide" && who}
      {size === "phone" && (
        <span className="col-span-2 col-start-3 flex min-w-0 items-center gap-1.5">
          {take}
          <span className="text-xs text-muted-foreground">·</span>
          {who}
        </span>
      )}
    </div>
  )
}

/** **Marks**: to do, done or all (Alex's pick: **Done**, not Close, 2026-11-02), grouped by song, a mark to a line, with **Labels** at the top right. */
export function Marks() {
  useTitle("Marks")
  const [show, setShow] = useState<Show>("open")
  const list = useMarks(show)
  const { panel, open } = usePanel()
  const head = (
    <TitleWith title="Marks">
      <Button variant="outline" size="row" aria-pressed={panel?.kind === "labels"} onClick={() => open({ kind: "labels" })}>
        Labels
      </Button>
    </TitleWith>
  )
  if (list.error) return <Trouble error={list.error} retry={() => void list.refetch()} />
  if (!list.data) return null
  const { counts, marks } = list.data
  if (!counts.all) return <Empty title={head} text="No marks yet. Marks set in РЭХА come with the takes, and anyone can set one on a take here." />
  const songs = [...new Set(marks.map((k) => k.take.song_title ?? "Not named"))]
  return (
    <Page title={head}>
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
                <Rows opens>
                  {ks.map((k) => (
                    <MarkLine key={k.id} mark={k} />
                  ))}
                </Rows>
              </Group>
            )
          })}
        </Groups>
      ) : (
        <p className="text-muted-foreground">{show === "open" ? "Every mark is done." : "No mark is done yet."}</p>
      )}
    </Page>
  )
}
