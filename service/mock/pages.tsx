import { useState, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ChevronLeft, Ellipsis, Plus } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { usePanel, useWide } from "./context"
import {
  bestOf,
  change,
  dayOf,
  fmt,
  inTrash,
  isNew,
  lastOf,
  marksOf,
  restore,
  songIsNew,
  takeOf,
  takesOf,
  useData,
  type Take,
} from "./data"
import { MarkItem, TakeMarks, Lanes } from "./panels"
import { Avatar } from "./Shell"
import { Columns, Dot, Group, Groups, Page, Play, Rows, StarButton, TakeLine, TakeLink, TakeName, Tile, Wave, takesN } from "./parts"

/** A take in a list: РЭХА's take bar (parts.tsx TakeLine). `marks`: its marks under it. */
export function TakeRow({ take, marks }: { take: Take; short?: boolean; marks?: boolean }) {
  return <TakeLine take={take} marks={marks} />
}

// ---------- Rehearsals ----------

/** A rehearsal's takes as bars, as РЭХА draws them: height by length, green when starred. */
function TakeBars({ takes }: { takes: Take[] }) {
  return (
    <span className="flex h-7 items-end gap-0.5">
      {takes.map((t) => (
        <i key={t.uid} className={cn("w-1 rounded-sm", t.stars.length ? "bg-signal" : "bg-muted-foreground/40")} style={{ height: Math.max(6, Math.round((t.len / 312) * 28)) }} />
      ))}
    </span>
  )
}

export function Rehearsals() {
  const data = useData()
  const wide = useWide()
  const navigate = useNavigate()
  const live = data.takes.filter((t) => !inTrash(data, t.uid))
  if (!live.length) return <Empty title="Rehearsals" text="No rehearsals yet. A rehearsal appears here when РЭХА sends its first take." />
  const rows = data.days.map((d) => {
    const ts = live.filter((t) => t.day === d.id)
    const songs = [...new Set(ts.map((t) => t.song ?? "Not named"))]
    const marks = ts.reduce((k, t) => k + marksOf(data, t.uid).length, 0)
    const starred = ts.filter((t) => t.stars.length).length
    const isNewDay = ts.some((t) => isNew(data, t.uid))
    return { d, ts, songs, marks, starred, isNewDay }
  })
  const cols = "grid-cols-[7rem_minmax(0,1fr)_minmax(9rem,1.2fr)_4rem_4rem]"
  return (
    <Page title="Rehearsals" sub={`${data.days.length} rehearsals since 8 October · ${live.length} takes`}>
      <Group title="October 2026" hint={`${data.days.length} rehearsals`} fold="open">
        {wide === "wide" && (
          <div className={cn("grid gap-3 px-4 text-xs text-muted-foreground", cols)}>
            <span>Date</span>
            <span>Songs</span>
            <span>Takes</span>
            <span>Starred</span>
            <span>Marks</span>
          </div>
        )}
        <Rows>
          {rows.map(({ d, ts, songs, marks, starred, isNewDay }) =>
            wide === "wide" ? (
              <button key={d.id} type="button" className={cn("grid w-full items-center gap-3 text-left", cols)} onClick={() => navigate({ to: "/rehearsals/$id", params: { id: d.id } })}>
                <span className="flex items-center gap-2">
                  {d.short}
                  {isNewDay && <Dot />}
                </span>
                <span className="truncate">{songs.join(", ")}</span>
                <span className="flex items-center gap-2.5">
                  <TakeBars takes={ts} />
                  <span className="tnum">{ts.length}</span>
                </span>
                <span className="tnum">{starred ? `★ ${starred}` : ""}</span>
                <span className="tnum">{marks || ""}</span>
              </button>
            ) : (
              <button key={d.id} type="button" className="flex w-full items-center gap-3 text-left" onClick={() => navigate({ to: "/rehearsals/$id", params: { id: d.id } })}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {d.short}
                    {isNewDay && <Dot />}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{songs.join(", ")}</span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="flex items-center gap-2">
                    <TakeBars takes={ts} />
                    <span className="tnum">{ts.length}</span>
                  </span>
                  <span className="tnum text-xs text-muted-foreground">{[starred && `★ ${starred}`, marks && `${marks} mark${marks > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ),
          )}
        </Rows>
      </Group>
    </Page>
  )
}

export function Rehearsal() {
  const { id } = useParams({ from: "/rehearsals/$id" })
  const data = useData()
  const { open } = usePanel()
  const d = dayOf(data, id)
  const ts = data.takes.filter((t) => t.day === id && !inTrash(data, t.uid))
  const songs = [...new Set(ts.map((t) => t.song))]
  return (
    <Page
      head={<Back to="/rehearsals" label="Rehearsals" />}
      title={d.long}
      sub={`${ts.length} takes · ${songs.length} song${songs.length > 1 ? "s" : ""} · ${fmt(ts.reduce((k, t) => k + t.len, 0))} recorded`}
    >
      <Groups>
        {songs.map((s) => (
          <Group
            key={s ?? "none"}
            title={s ?? "Not named"}
            hint={s ? takesN(ts.filter((t) => t.song === s).length) : "recorded in РЭХА without a song's title"}
            fold="open"
            action={
              s && (
                <Button variant="ghost" size="row" onClick={() => open({ kind: "song", id: data.songs.find((g) => g.title === s)!.id })}>
                  The song
                </Button>
              )
            }
          >
            <Rows>
              {ts
                .filter((t) => t.song === s)
                .map((t) => (
                  <TakeRow key={t.uid} take={t} marks />
                ))}
            </Rows>
          </Group>
        ))}
      </Groups>
    </Page>
  )
}

// ---------- Songs ----------

export function Songs() {
  const data = useData()
  const wide = useWide()
  const { open } = usePanel()
  const total = data.takes.filter((t) => !inTrash(data, t.uid)).length
  const notNamed = data.takes.filter((t) => !t.song && !inTrash(data, t.uid))
  const head = (
    <span className="flex items-center gap-2">
      <span className="flex-1">Songs</span>
      <Button variant="outline" size="row" onClick={() => open({ kind: "statuses" })}>
        Statuses
      </Button>
      <Button variant="outline" size="row" onClick={() => open({ kind: "new-song" })}>
        <Plus />
        New song
      </Button>
    </span>
  )
  if (!data.songs.length) return <Empty title={head} text="No songs yet. A song appears with its first take from РЭХА, or press New song to keep its notes and files here before that." />
  const cols = "grid-cols-[minmax(0,1fr)_6rem_4rem_4rem_4rem_6rem_minmax(8rem,1fr)]"
  return (
    <Page title={head} sub={`${data.songs.length} songs · ${total} takes`}>
      {wide === "wide" && (
        <div className={cn("-mb-4 grid gap-3 px-4 text-xs text-muted-foreground", cols)}>
          <span>Song</span>
          <span>Key</span>
          <span>Tempo</span>
          <span>Length</span>
          <span>Takes</span>
          <span>Last played</span>
          <span>Best take</span>
        </div>
      )}
      <Groups>
        {data.statuses.map((st) => {
          const gs = data.songs.filter((g) => g.status === st)
          return (
            <Group key={st} title={st} hint={String(gs.length)} fold={st === data.statuses[data.statuses.length - 1] ? "closed" : "open"}>
              {gs.length ? (
                <Rows>
                  {gs.map((g) => {
                    const best = bestOf(data, g.title)
                    const n = takesOf(data, g.title).length
                    const name = (
                      <span className="flex items-center gap-2">
                        {g.title}
                        {songIsNew(data, g.title) && <Dot />}
                      </span>
                    )
                    return wide === "wide" ? (
                      <div key={g.id} className={cn("grid cursor-pointer items-center gap-3", cols)} onClick={() => open({ kind: "song", id: g.id })}>
                        {name}
                        <span>{g.key}</span>
                        <span className="tnum">{g.bpm ?? ""}</span>
                        <span className="tnum">{best ? fmt(best.take.len) : ""}</span>
                        <span className="tnum">{n || ""}</span>
                        <span>{lastOf(data, g.title)}</span>
                        {best ? (
                          <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Play uid={best.take.uid} />
                            <TakeLink uid={best.take.uid} short />
                            <span className="text-xs text-muted-foreground">{best.why}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No takes yet</span>
                        )}
                      </div>
                    ) : (
                      <div key={g.id} className="flex cursor-pointer items-center gap-3" onClick={() => open({ kind: "song", id: g.id })}>
                        <span className="min-w-0 flex-1">
                          {name}
                          <span className="block truncate text-xs text-muted-foreground">{[g.key, g.bpm && `${g.bpm} bpm`, n && `${n} takes`].filter(Boolean).join(" · ")}</span>
                        </span>
                        {best && (
                          <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <TakeLink uid={best.take.uid} short />
                            <Play uid={best.take.uid} />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </Rows>
              ) : (
                <p className="text-muted-foreground">No songs with this status.</p>
              )}
            </Group>
          )
        })}
        {notNamed.length > 0 && (
          <Group title="Not named" hint="takes recorded in РЭХА without a song's title" fold="open">
            <Rows>
              {notNamed.map((t) => (
                <TakeRow key={t.uid} take={t} />
              ))}
            </Rows>
          </Group>
        )}
      </Groups>
    </Page>
  )
}

// ---------- Marks ----------

export function Marks() {
  const data = useData()
  const { open } = usePanel()
  const [show, setShow] = useState("Open")
  const head = (
    <span className="flex items-center gap-2">
      <span className="flex-1">Marks</span>
      <Button variant="outline" size="row" onClick={() => open({ kind: "labels" })}>
        Labels
      </Button>
    </span>
  )
  if (!data.marks.length) return <Empty title={head} text="No marks yet. Marks set in РЭХА come with the takes, and anyone can set one on a take here." />
  const shown = data.marks.filter((k) => (show === "All" ? true : show === "Open" ? !k.closed : k.closed))
  const count = (x: string) => data.marks.filter((k) => (x === "All" ? true : x === "Open" ? !k.closed : k.closed)).length
  const songs = [...new Set(shown.map((k) => takeOf(data, k.take).song ?? "Not named"))]
  return (
    <Page title={head} sub="A mark sits on a moment of a take, with a label and its colour. It comes from РЭХА or is set here, the band comments under it, and it is closed once the place is fixed.">
      <ToggleGroup type="single" variant="outline" value={show} onValueChange={(v) => v && setShow(v)} className="self-start">
        {["Open", "Closed", "All"].map((x) => (
          <ToggleGroupItem key={x} value={x} className="gap-1.5 px-3">
            {x}
            <span className="tnum text-muted-foreground">{count(x)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {shown.length ? (
        <Groups>
          {songs.map((s) => {
            const ks = shown.filter((k) => (takeOf(data, k.take).song ?? "Not named") === s)
            return (
              <Group key={s} title={s} hint={String(ks.length)} fold="open">
                <Rows>
                  {ks.map((k) => (
                    <MarkItem key={k.id} mark={k} take={takeOf(data, k.take).song ? "short" : "full"} />
                  ))}
                </Rows>
              </Group>
            )
          })}
        </Groups>
      ) : (
        <p className="text-muted-foreground">Nothing here.</p>
      )}
    </Page>
  )
}

// ---------- Members ----------

export function Members() {
  const data = useData()
  const [rm, setRm] = useState<string | null>(null)
  const [out, setOut] = useState<string | null>(null)
  const [mail, setMail] = useState("")
  const [keyName, setKeyName] = useState("")
  const [newKey, setNewKey] = useState<string | null>(null)
  const owner = data.owner
  const people = owner ? data.members : data.members.filter((m) => !m.unconfirmed)
  return (
    <Page title="Members" sub={owner ? "Only you see the addresses, the buttons and the keys." : "Who is in the band."}>
      <Groups>
        {owner && (
          <Group title="The band">
            <Tile>
              <div className="flex items-center gap-4">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-2xl font-semibold text-primary-foreground">{(data.bandName || "B")[0]}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Input value={data.bandName} onChange={(e) => change(() => ({ bandName: e.target.value }))} placeholder="The band's name" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="row">
                      Add a picture
                    </Button>
                    <span className="text-xs text-muted-foreground">Without a picture the logo is the name's first letter.</span>
                  </div>
                </div>
              </div>
            </Tile>
          </Group>
        )}
        <Group title="People" hint={String(people.filter((m) => !m.unconfirmed).length)}>
          <Rows>
            {people.map((m) => (
              <div key={m.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Avatar letter={m.initial || "?"} />
                  <div className="min-w-0 flex-1">
                    <div>
                      {m.name || m.email}
                      {m.id === data.me && <span className="text-muted-foreground"> · you</span>}
                    </div>
                    {owner && m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
                    {owner && m.unconfirmed && <div className="text-xs text-warn">Has not confirmed the address yet</div>}
                  </div>
                  {owner && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-row" aria-label={`What to do with ${m.name || m.email}`}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => setOut(m.id)}>Sign out everywhere</DropdownMenuItem>
                        {!m.owner && (
                          <DropdownMenuItem variant="destructive" onSelect={() => setRm(m.id)}>
                            Remove
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {out === m.id && <p className="pl-10 text-xs text-muted-foreground">{m.name || m.email} is signed out on every phone and computer. Signing in again takes a new code from a letter.</p>}
                {rm === m.id && (
                  <div className="ml-10 flex flex-col gap-2 rounded-lg border p-3">
                    <span>Remove “{m.name || m.email}”? They are signed out everywhere and can no longer sign in. Their marks, comments and stars stay. Add the address again to bring them back.</span>
                    <div className="flex gap-2">
                      <Button variant="destructive" size="row" onClick={() => (change((s) => ({ members: s.members.filter((x) => x.id !== m.id) })), setRm(null))}>
                        Remove
                      </Button>
                      <Button variant="ghost" size="row" onClick={() => setRm(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </Rows>
        </Group>
        {owner && (
          <Group title="Add a member" hint="Cloudflare sends them a letter to confirm the address; then they sign in here and give their name.">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!mail.includes("@")) return
                change((s) => ({ members: [...s.members, { id: mail, name: "", initial: "", email: mail, unconfirmed: true }] }))
                setMail("")
              }}
            >
              <Input value={mail} onChange={(e) => setMail(e.target.value)} placeholder="name@example.com" />
              <Button type="submit">Add member</Button>
            </form>
          </Group>
        )}
        {owner && (
          <Group title="Keys for РЭХА" hint={data.keys.length ? `${data.keys.length} key${data.keys.length > 1 ? "s" : ""}` : undefined} fold={data.keys.length ? "closed" : "open"}>
            <p className="text-muted-foreground">РЭХА sends its takes here with a key: one for each computer that records.</p>
            {data.keys.length > 0 && (
              <Rows>
                {data.keys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3">
                    <span className="flex-1">{k.name}</span>
                    <Button variant="ghost" size="row" onClick={() => change((s) => ({ keys: s.keys.filter((x) => x.id !== k.id) }))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </Rows>
            )}
            {newKey && (
              <Tile boxed className="border-primary/40">
                <span>Paste this key into РЭХА now, under “I have a band service key”. It is shown only this once.</span>
                <code className="font-mono text-xs break-all">{newKey}</code>
              </Tile>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const name = keyName.trim() || "Rehearsal room"
                change((s) => ({ keys: [...s.keys, { id: `k${Date.now()}`, name }] }))
                setNewKey("reha_k7Qx2mVn8ZpL4tRw9cYs3bHd6fJg1aEu5oKi0")
                setKeyName("")
              }}
            >
              <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Where РЭХА runs, such as Rehearsal room" />
              <Button type="submit">Make a key for РЭХА</Button>
            </form>
          </Group>
        )}
      </Groups>
    </Page>
  )
}

// ---------- Trash ----------

export function Trash() {
  const data = useData()
  const [back, setBack] = useState<string | null>(null)
  return (
    <Page title="Trash" sub="Takes removed in РЭХА wait here for 30 days, then they are deleted for good. Anyone in the band can put one back.">
      {back && <Tile boxed className="border-primary/40">{back}</Tile>}
      {data.trash.length ? (
        <Group>
        <Rows>
          {data.trash.map((t) => {
            const take = takeOf(data, t.uid)
            return (
              <div key={t.uid} className="flex items-center gap-3">
                <Play uid={take.uid} />
                <div className="min-w-0 flex-1">
                  <TakeLink uid={take.uid} />
                  <div className="text-xs text-muted-foreground">
                    {dayOf(data, take.day).short} · removed in РЭХА {t.removed} · deleted for good in {t.left} days
                  </div>
                </div>
                <Button
                    variant="outline"
                    size="row"
                    onClick={() => {
                      restore(t.uid)
                      setBack(`${take.song ?? "Take"} ${take.n} is back in ${dayOf(data, take.day).long}.`)
                    }}
                  >
                  Restore
                </Button>
              </div>
            )
          })}
        </Rows>
        </Group>
      ) : (
        <p className="text-muted-foreground">The trash is empty.</p>
      )}
    </Page>
  )
}

// ---------- the take's page, until the player of #94: part 1's page in the new frame ----------

export function TakePage() {
  const { uid } = useParams({ from: "/takes/$uid" })
  const data = useData()
  const t = takeOf(data, uid)
  const song = data.songs.find((g) => g.title === t.song)
  const trashed = data.trash.find((x) => x.uid === uid)
  return (
    <Page
      head={song ? <Back to="/songs/$id" params={{ id: song.id }} label={song.title} /> : <Back to="/songs" label="Songs" />}
      title={
        <span className="flex flex-wrap items-center gap-3">
          <TakeName take={t} />
          {t.atReh && (
            <Badge variant="signal" className="text-xs font-normal">
              ★ at rehearsal
            </Badge>
          )}
          <span className="flex-1" />
          <span className="text-sm font-normal">
            <StarButton take={t} who />
          </span>
        </span>
      }
      sub={`${dayOf(data, t.day).long} · ${fmt(t.len)} · 4 tracks`}
    >
      {trashed && (
        <Tile boxed className="border-warn/50">
          <span>In the Trash. Deleted for good in {trashed.left} days.</span>
          <Button variant="outline" size="row" className="self-start" onClick={() => restore(uid)}>
            Restore
          </Button>
        </Tile>
      )}
      <Columns
        main={
          <Groups>
            <Group>
              <div className="flex items-center gap-4">
                <Play uid={uid} className="size-12" />
                <Wave uid={uid} height={72} className="flex-1" />
              </div>
            </Group>
            <Group title="Tracks" hint="4">
              <Lanes uid={uid} />
            </Group>
            <Group title="Download tracks" hint="FLAC, as РЭХА recorded them">
            <Rows>
              {["Drums", "Bass", "Guitar", "Vocals"].map((tr) => (
                <div key={tr} className="flex items-center gap-2">
                  <span className="flex-1">{tr}</span>
                  <Button variant="outline" size="row">
                    FLAC
                  </Button>
                  {tr === "Drums" && (
                    <Button variant="outline" size="row">
                      MIDI
                    </Button>
                  )}
                </div>
              ))}
            </Rows>
            </Group>
          </Groups>
        }
        // Alex's pick B (17:40Z): tracks and downloads on the left, marks on the right.
        sideWidth="minmax(0,0.8fr)"
        side={
          <Groups>
            <TakeMarks uid={uid} />
          </Groups>
        }
      />
    </Page>
  )
}

// ---------- shared ----------

function Back(props: { to: "/rehearsals" | "/songs" | "/songs/$id"; params?: { id: string }; label: string }) {
  return (
    <Link to={props.to} params={props.params as never} className="mb-2 flex items-center gap-1 self-start text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" />
      {props.label}
    </Link>
  )
}

/** A section with nothing in it yet: what will come, and how. */
export function Empty({ title, text }: { title: ReactNode; text: string }) {
  return (
    <Page title={title}>
      <Tile>
        <p className="text-muted-foreground">{text}</p>
      </Tile>
    </Page>
  )
}

