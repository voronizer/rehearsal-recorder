import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ITEM_CHOSEN, Item } from "@/components/ui/item"
import { cn } from "@/lib/utils"
import { useMakeSet, useSets, useSongs, type BandSet, type SongItem } from "../api"
import { Empty, Page, Trouble, useTitle } from "../shell/parts"
import { useSize } from "../shell/size"
import { setLine, songsOf } from "./length"
import { madeNow, SetPage, SetPane } from "./SetPage"

/** A name no set in use has: “New set”, then “New set 2”, as РЭХА's Settings › Sets gives. */
export function freeName(sets: { name: string }[]) {
  const taken = new Set(sets.map((s) => s.name.toLocaleLowerCase()))
  if (!taken.has("new set")) return "New set"
  for (let i = 2; ; i++) if (!taken.has(`new set ${i}`)) return `New set ${i}`
}

/** A set in the list: its name over how many songs and how long, as РЭХА's Settings › Sets rows. */
function SetRow({ set, all, picked }: { set: BandSet; all: SongItem[]; picked: boolean }) {
  return (
    <li>
      <Item asChild size="sm">
        <Button
          asChild
          variant="ghost"
          className={cn("h-auto w-full flex-col flex-nowrap items-stretch gap-0.5 px-3 py-2 text-left whitespace-normal", picked && ITEM_CHOSEN)}
        >
          <Link to="/sets/$id" params={{ id: String(set.id) }} aria-current={picked ? "page" : undefined}>
            <span className="truncate font-semibold">{set.name}</span>
            <span className="tnum text-xs text-muted-foreground">{setLine(songsOf(set.songs, all), true)}</span>
          </Link>
        </Button>
      </Item>
    </li>
  )
}

/**
 * Sets: on a computer the list down the left with **New set** under it, and
 * the picked set beside it, as in РЭХА; on a phone the list, and a set opens
 * on its own page. **New set** makes the set at once and opens it.
 */
export function Sets() {
  const sets = useSets()
  const songs = useSongs()
  const make = useMakeSet()
  const size = useSize()
  const navigate = useNavigate()
  const { id } = useParams({ strict: false })
  const all = sets.data?.sets ?? []
  const chosen = id === undefined ? undefined : all.find((s) => s.id === Number(id))
  useTitle(chosen?.name ?? "Sets")
  const error = sets.error ?? songs.error
  if (error) return <Trouble error={error} retry={() => void Promise.all([sets.refetch(), songs.refetch()])} />
  if (!sets.data || !songs.data) return null
  if (size === "phone" && chosen) return <SetPage key={chosen.id} set={chosen} />
  const newSet = (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant={all.length ? "ghost" : "outline"}
        size="row"
        disabled={make.isPending}
        onClick={() =>
          make.mutate(freeName(all), {
            onSuccess: (made) => {
              madeNow(made.id)
              void navigate({ to: "/sets/$id", params: { id: String(made.id) } })
            },
            // A name taken meanwhile, by РЭХА say: the next press picks from the sets as they are now.
            onError: () => void sets.refetch(),
          })
        }
      >
        <Plus />
        New set
      </Button>
      {make.error && (
        <p role="alert" className="text-destructive">
          {make.error.message}
        </p>
      )}
    </div>
  )
  if (!all.length) return <Empty title="Sets" text="No sets yet. A set is the songs in the order you play them at a gig." top={newSet} />
  const picked = chosen ?? all[0]
  const list = (
    <div className={cn("flex shrink-0 flex-col gap-2", size !== "phone" && "w-54")}>
      {/* 24 px from one set's words to the next: each row's own room and 8 px. */}
      <ul aria-label="Sets" className="flex flex-col gap-2">
        {all.map((s) => (
          <SetRow key={s.id} set={s} all={songs.data.songs} picked={size !== "phone" && s.id === picked.id} />
        ))}
      </ul>
      {newSet}
    </div>
  )
  if (size === "phone") return <Page title="Sets">{list}</Page>
  return (
    <Page title="Sets">
      <div className="flex items-start gap-6">
        {list}
        <SetPane key={picked.id} set={picked} />
      </div>
    </Page>
  )
}
