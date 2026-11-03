import { useEffect } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Refused, useRehearsal, useSongs, type TakeRow } from "../api"
import { Back, Group, Groups, Page, Rows, Trouble, useTitle } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock, count, day, longDay } from "../shell/words"
import { TakeLine } from "../takes/parts"

/**
 * A rehearsal's page: its takes by song, in the order they were played,
 * each song a fold with **Notes and files** at its right. Takes nobody
 * named a song are under **Not named**, last. Each take has its marks
 * under it. A rehearsal with no takes left, its last one deleted, opens
 * **Rehearsals** in its place.
 */
export function Rehearsal() {
  const { uid } = useParams({ from: "/band/rehearsals/$uid" })
  const page = useRehearsal(uid)
  useTitle(page.data ? day(page.data.rehearsal.date) : undefined)
  const songs = useSongs()
  const { open } = usePanel()
  const navigate = useNavigate()
  const empty = page.error instanceof Refused && page.error.status === 404
  useEffect(() => {
    if (empty) void navigate({ to: "/rehearsals", replace: true })
  }, [empty, navigate])
  if (empty) return null
  if (page.error) return <Trouble error={page.error} retry={() => void page.refetch()} />
  if (songs.error) return <Trouble error={songs.error} retry={() => void songs.refetch()} />
  // The takes go under their songs' titles. Drawn before the titles came,
  // they would stand with no headings and be drawn again once they did.
  if (!page.data || !songs.data) return null
  const { rehearsal, takes } = page.data
  const titles = new Map(songs.data.songs.map((s) => [s.id, s.title]))
  const ids = [...new Set(takes.map((t) => t.song_id).filter((id) => id !== null))]
  const groups: [number | null, TakeRow[]][] = ids.map((id) => [id, takes.filter((t) => t.song_id === id)])
  const loose = takes.filter((t) => t.song_id === null)
  if (loose.length) groups.push([null, loose])
  const length = takes.reduce((n, t) => n + t.duration_sec, 0)
  return (
    <Page
      head={<Back to="/rehearsals" label="Rehearsals" />}
      title={longDay(rehearsal.date)}
      sub={`${count(takes.length, "take")} · ${count(ids.length, "song")} · ${clock(length)} recorded`}
    >
      <Groups>
        {groups.map(([id, ts]) => (
          <Group
            key={id ?? "none"}
            title={id === null ? "Not named" : (titles.get(id) ?? "")}
            hint={id === null ? "recorded in РЭХА without a song's title" : count(ts.length, "take")}
            fold="open"
            action={
              id !== null && (
                // Says what it opens: the song's panel, with what a rehearsal needs from it.
                <Button variant="ghost" size="row" onClick={() => open({ kind: "song", id })}>
                  Notes and files
                </Button>
              )
            }
          >
            <Rows>
              {ts.map((t) => (
                <TakeLine key={t.uid} take={t} marks />
              ))}
            </Rows>
          </Group>
        ))}
      </Groups>
    </Page>
  )
}
