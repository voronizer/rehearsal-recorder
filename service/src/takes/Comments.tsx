import { useState, type FormEvent } from "react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCloseComment, useComment, type Comment, type TakePage } from "../api"
import { clock } from "../shell/words"
import { colourOf } from "./colours"

/**
 * **Marks and comments**, in time order: РЭХА's marks with their label,
 * colour and note, and what the band wrote, with the answers under each.
 * **Comment at 1:42** writes one at the playhead. A closed one is greyed
 * and stays. Tapping one moves the playhead to it.
 */
export function Comments({ take, at, onSeek }: { take: TakePage; at: number; onSeek: (at: number) => void }) {
  const [writing, setWriting] = useState<number | null>(null)
  const open = !take.trashed_at
  return (
    <section aria-labelledby="comments" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="comments" className="text-sm font-semibold">
          Marks and comments
        </h2>
        {open && (
          <Button variant="ghost" size="row" className="text-primary hover:text-primary" onClick={() => setWriting(at)}>
            <MessageSquare className="size-3.5" />
            Comment at {clock(at)}
          </Button>
        )}
      </div>
      {writing !== null && (
        <Write uid={take.uid} at={writing} label={`Your comment at ${clock(writing)}`} onDone={() => setWriting(null)} />
      )}
      {take.comments.length === 0 && writing === null && (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground">
          No marks or comments yet. Play the take and press Comment at the moment you mean.
        </p>
      )}
      {take.comments.length > 0 && (
        <ul className="flex flex-col rounded-xl bg-card">
          {take.comments.map((c, i) => (
            <Thread key={c.id} take={take} comment={c} first={i === 0} open={open} onSeek={onSeek} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Thread({
  take,
  comment: c,
  first,
  open,
  onSeek,
}: {
  take: TakePage
  comment: TakePage["comments"][number]
  first: boolean
  open: boolean
  onSeek: (at: number) => void
}) {
  const [answering, setAnswering] = useState(false)
  const close = useCloseComment(take.uid)
  return (
    <li data-closed={c.closed} className={cn("flex flex-col gap-2 px-4 py-3", !first && "border-t", c.closed && "opacity-60")}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onSeek(c.at)} className="flex min-w-0 flex-1 items-start gap-2 text-left text-sm">
          <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", colourOf(c.colour).dot)} />
          <span className="w-9 shrink-0 text-xs leading-5 text-muted-foreground tnum">{c.cut_off ? "" : clock(c.at)}</span>
          <Words comment={c} />
        </button>
        {open && (
          <span className="flex shrink-0 gap-1">
            <Button variant="ghost" size="row" className="h-7 px-2 text-xs" onClick={() => setAnswering(true)}>
              Reply
            </Button>
            <Button
              variant="ghost"
              size="row"
              className="h-7 px-2 text-xs"
              disabled={close.isPending}
              onClick={() => close.mutate({ id: c.id, closed: !c.closed })}
            >
              {c.closed ? "Reopen" : "Close"}
            </Button>
          </span>
        )}
      </div>
      {c.replies.map((r) => (
        <div key={r.id} className="ml-[3.25rem] flex flex-col gap-0.5 border-l-2 pl-3 text-sm">
          <span className="whitespace-pre-wrap">{r.text}</span>
          <span className="text-xs text-muted-foreground">{r.author}</span>
        </div>
      ))}
      {answering && (
        <div className="ml-[3.25rem]">
          <Write uid={take.uid} at={c.at} parent={c.id} label={`Your reply to ${c.author ?? "the mark"}`} onDone={() => setAnswering(false)} />
        </div>
      )}
    </li>
  )
}

/** A mark from РЭХА: its note, then its label. A comment: its words, then who wrote it. */
function Words({ comment: c }: { comment: Comment }) {
  const where = c.cut_off ? "In the part cut off" : null
  if (c.from_reha)
    return (
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {c.text && <span className="whitespace-pre-wrap">{c.text}</span>}
        <span className={c.text ? "text-xs text-muted-foreground" : "text-muted-foreground"}>
          {c.label} · mark from РЭХА{where && ` · ${where}`}
        </span>
      </span>
    )
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="whitespace-pre-wrap">{c.text}</span>
      <span className="text-xs text-muted-foreground">
        {c.author}
        {where && ` · ${where}`}
      </span>
    </span>
  )
}

/** The field for a comment or a reply, with **Save** and **Cancel**. */
function Write({
  uid,
  at,
  parent,
  label,
  onDone,
}: {
  uid: string
  at: number
  parent?: number
  label: string
  onDone: () => void
}) {
  const [text, setText] = useState("")
  const say = useComment(uid)
  async function submit(e: FormEvent) {
    e.preventDefault()
    await say.mutateAsync({ at, text, parent_id: parent })
    onDone()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl bg-card p-3">
      <textarea
        aria-label={label}
        autoFocus
        required
        maxLength={2000}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      {say.error && (
        <p role="alert" className="text-sm text-destructive">
          {say.error.message}
        </p>
      )}
      <span className="flex gap-2">
        <Button type="submit" size="row" disabled={say.isPending || !text.trim()}>
          Save
        </Button>
        <Button type="button" size="row" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </span>
    </form>
  )
}
