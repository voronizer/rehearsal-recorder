import { useState, type ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Check, GripVertical, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { usePanel } from "./context"
import { change, useData } from "./data"
import { Diamond, Group, Groups, Page, Rows, Tile } from "./parts"

const PALETTE = ["grey", "red", "amber", "green", "teal", "orange", "violet", "pink"].map((c) => [c[0].toUpperCase() + c.slice(1), `var(--label-${c})`])

function PanelHead({ title }: { title: string }) {
  const { close } = usePanel()
  return (
    <div className="flex items-center gap-2">
      <h2 className="flex-1 text-lg font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
        <X />
      </Button>
    </div>
  )
}

/** One row of an editable list: drag, rename, count, delete; asks where the things go when it has some. */
function EditRow({
  name,
  count,
  colour,
  onColour,
  onName,
  canDelete,
  onDelete,
  others,
  onMove,
  focus,
}: {
  name: string
  count: string
  colour?: string
  onColour?: (c: string) => void
  onName: (v: string) => void
  canDelete: boolean
  onDelete: () => boolean
  others: [number, string, string?][]
  onMove: (to: number) => void
  focus?: boolean
}) {
  const [pal, setPal] = useState(false)
  const [ask, setAsk] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-label="Drag to change the order" />
        {colour && (
          <Button variant="ghost" size="icon-row" aria-label="Colour" onClick={() => setPal(!pal)}>
            <Diamond colour={colour} />
          </Button>
        )}
        <Input autoFocus={focus} defaultValue={name} onChange={(e) => onName(e.target.value)} className="h-8 flex-1 border-transparent bg-transparent shadow-none hover:border-input" />
        <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
        {canDelete && (
          <Button variant="ghost" size="icon-row" aria-label="Delete" onClick={() => !onDelete() && setAsk(!ask)}>
            <Trash2 className="text-muted-foreground" />
          </Button>
        )}
      </div>
      {pal && onColour && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {PALETTE.map(([n, c]) => (
            <button key={n} type="button" title={n} aria-label={n} onClick={() => (onColour(c), setPal(false))} className={cn("flex size-7 items-center justify-center rounded-full", c === colour && "ring-2 ring-ring")} style={{ background: c }}>
              {c === colour && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      )}
      {ask && (
        <div className="flex flex-col gap-2 pl-6">
          <span className="text-xs text-muted-foreground">Its {count} move to:</span>
          <div className="flex flex-wrap gap-1.5">
            {others.map(([i, n, c]) => (
              <Button key={i} variant="outline" size="row" onClick={() => onMove(i)}>
                {c && <Diamond colour={c} />}
                {n}
              </Button>
            ))}
            <Button variant="ghost" size="row" onClick={() => setAsk(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function LabelsPanel() {
  const data = useData()
  const [added, setAdded] = useState(-1)
  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="Labels" />
      <p className="text-muted-foreground">
        What a moment in a take can be marked with. The whole band has the same labels. Renaming or recolouring one changes every mark that has it. A mark from РЭХА with a label the band has not got yet adds that label here. A label renamed here still gets the marks РЭХА sends under its old name.
      </p>
      <Groups>
        <Group>
          <Rows>
            {data.labels.map((l, i) => {
              const n = data.marks.filter((k) => k.label === i).length
              return (
                <EditRow
                  key={i}
                  focus={i === added}
                  name={l.name}
                  colour={l.colour}
                  count={`${n} mark${n === 1 ? "" : "s"}`}
                  onColour={(c) => change((s) => ({ labels: s.labels.map((x, j) => (j === i ? { ...x, colour: c } : x)) }))}
                  onName={(v) => change((s) => ({ labels: s.labels.map((x, j) => (j === i ? { ...x, name: v } : x)) }))}
                  canDelete={data.labels.length > 1}
                  onDelete={() => {
                    if (n) return false
                    change((s) => ({ labels: s.labels.filter((_, j) => j !== i), marks: s.marks.map((k) => (k.label > i ? { ...k, label: k.label - 1 } : k)) }))
                    return true
                  }}
                  others={data.labels.flatMap((o, j) => (j === i ? [] : [[j, o.name, o.colour] as [number, string, string]]))}
                  onMove={(to) =>
                    change((s) => ({
                      labels: s.labels.filter((_, j) => j !== i),
                      marks: s.marks.map((k) => {
                        const lab = k.label === i ? to : k.label
                        return { ...k, label: lab > i ? lab - 1 : lab }
                      }),
                    }))
                  }
                />
              )
            })}
          </Rows>
          <Button
            variant="outline"
            size="row"
            className="self-start"
            onClick={() => {
              setAdded(data.labels.length)
              change((s) => ({ labels: [...s.labels, { name: "New label", colour: "var(--label-grey)" }] }))
            }}
          >
            <Plus />
            New label
          </Button>
        </Group>
      </Groups>
    </div>
  )
}

export function StatusesPanel() {
  const data = useData()
  const [added, setAdded] = useState(-1)
  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="Statuses" />
      <p className="text-muted-foreground">Where a song stands with the band. Everyone in the band sees the same statuses. The Songs page groups songs by them, in this order. Statuses live only here: РЭХА has none.</p>
      <Groups>
        <Group>
          <Rows>
            {data.statuses.map((st, i) => {
              const n = data.songs.filter((g) => g.status === st).length
              return (
                <EditRow
                  key={i}
                  focus={i === added}
                  name={st}
                  count={`${n} song${n === 1 ? "" : "s"}`}
                  onName={(v) => change((s) => ({ statuses: s.statuses.map((x, j) => (j === i ? v : x)), songs: s.songs.map((g) => (g.status === st ? { ...g, status: v } : g)) }))}
                  canDelete={data.statuses.length > 1}
                  onDelete={() => {
                    if (n) return false
                    change((s) => ({ statuses: s.statuses.filter((_, j) => j !== i) }))
                    return true
                  }}
                  others={data.statuses.flatMap((o, j) => (j === i ? [] : [[j, o] as [number, string]]))}
                  onMove={(to) =>
                    change((s) => ({
                      songs: s.songs.map((g) => (g.status === st ? { ...g, status: s.statuses[to] } : g)),
                      statuses: s.statuses.filter((_, j) => j !== i),
                    }))
                  }
                />
              )
            })}
          </Rows>
          <Button
            variant="outline"
            size="row"
            className="self-start"
            onClick={() => {
              setAdded(data.statuses.length)
              change((s) => ({ statuses: [...s.statuses, "New status"] }))
            }}
          >
            <Plus />
            New status
          </Button>
        </Group>
      </Groups>
    </div>
  )
}

export function NewSongPanel() {
  const data = useData()
  const { open, close } = usePanel()
  const [title, setTitle] = useState("")
  const [error, setError] = useState("")
  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="New song" />
      <p className="text-muted-foreground">For a song before its first take: its notes and files can go here now. Takes come to it from РЭХА when a take has the same title.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const v = title.trim()
          if (!v) return
          const ex = data.songs.find((g) => g.title.toLowerCase() === v.toLowerCase())
          if (ex) return setError(`There is already a song called “${ex.title}”.`)
          const id = v.toLowerCase().replace(/\s+/g, "-")
          change((s) => ({ songs: [...s.songs, { id, title: v, status: s.statuses[0], key: "", bpm: null, notes: "", files: [] }] }))
          open({ kind: "song", id })
        }}
      >
        <Label htmlFor="new-title">Title</Label>
        <Input id="new-title" autoFocus value={title} onChange={(e) => (setTitle(e.target.value), setError(""))} placeholder="Zorka" aria-invalid={!!error} />
        {error && <p className="text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit">Add song</Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

// ---------- signing in and your name, as part 1, with the band's picture and name on top ----------

function SignFrame({ children }: { children: ReactNode }) {
  const data = useData()
  return (
    <div className="flex h-full items-center justify-center bg-panel p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl bg-background p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">{(data.bandName || "B")[0]}</span>
          <span className={cn("font-semibold", !data.bandName && "text-muted-foreground")}>{data.bandName || "Band name"}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

export function SignIn({ done }: { done: (needsName: boolean) => void }) {
  const [mail, setMail] = useState("")
  const [sent, setSent] = useState(false)
  return (
    <SignFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">The band's takes</h1>
        <p className="text-muted-foreground">Type your email address. A letter brings a code to sign in with: no password.</p>
      </div>
      <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), mail.includes("@") && setSent(true))}>
        <Label htmlFor="mail">Email address</Label>
        <Input id="mail" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="name@example.com" />
        <Button type="submit" variant={sent ? "outline" : "default"}>
          Send code
        </Button>
      </form>
      {sent && (
        <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), done(mail.startsWith("new")))}>
          <p>If this address is in the band, a code is on its way.</p>
          <Label htmlFor="code">Code</Label>
          <Input id="code" inputMode="numeric" maxLength={6} placeholder="Six digits from the letter" autoFocus />
          <Button type="submit">Sign in</Button>
        </form>
      )}
    </SignFrame>
  )
}

export function NameScreen({ initial = "", done, cancel }: { initial?: string; done: (name: string) => void; cancel?: () => void }) {
  const [name, setName] = useState(initial)
  return (
    <SignFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">What should the band call you?</h1>
        <p className="text-muted-foreground">The others see it on your stars, marks and comments.</p>
      </div>
      <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), name.trim() && done(name.trim()))}>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          {cancel && (
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </SignFrame>
  )
}

// ---------- the first day: a band with no takes yet ----------

export function FirstDay() {
  const data = useData()
  const navigate = useNavigate()
  const steps: [boolean, string, string, string?][] = [
    [!!data.bandName, "Name the band", "Its name and picture show at the top and when someone signs in.", "The band's name"],
    [data.keys.length > 0, "Make a key for РЭХА", "РЭХА sends takes here with it. Paste it into РЭХА on the computer that records.", "Make a key"],
    [data.members.length > 1, "Add the band", "Type each member's email address. Cloudflare sends them a letter to confirm it.", "Add members"],
    [false, "Record a rehearsal", "Takes, stars and marks appear here once РЭХА has sent them."],
  ]
  return (
    <Page title="Home" sub="No takes yet. They come here from РЭХА after a rehearsal.">
      {data.owner ? (
        <Group title="Before the first rehearsal">
          <Rows>
            {steps.map(([done, title, text, button]) => (
              <div key={title} className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border", done && "border-signal bg-signal text-white")}>{done && <Check className="size-3.5" />}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={cn("font-semibold", done && "text-muted-foreground line-through")}>{title}</span>
                  <span className="text-muted-foreground">{text}</span>
                </div>
                {button && !done && (
                  <Button variant="outline" size="row" onClick={() => navigate({ to: "/members" })}>
                    {button}
                  </Button>
                )}
              </div>
            ))}
          </Rows>
        </Group>
      ) : (
        <Tile>
          <p>After the next rehearsal its takes appear here, with what the band starred and marked.</p>
        </Tile>
      )}
    </Page>
  )
}
