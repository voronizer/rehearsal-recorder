import { useState, type FormEvent, type ReactNode } from "react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LabelDot } from "@/components/ui/mark"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  useAddComment,
  useAddMark,
  useChangeComment,
  useChangeMark,
  useDeleteComment,
  useDeleteMark,
  useLabels,
  type Mark,
  type MarkComment,
} from "../api"
import { Dot, Group, Rows, Tile } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock, day } from "../shell/words"
import { usePlayer, useTime } from "../takes/player/one"
import { TakeName, useLabelOf } from "../takes/parts"

const actions = "text-muted-foreground hover:text-foreground disabled:opacity-50"

/** The take a mark is on, as a name that opens the take's panel. */
function OnTake({ take, short }: { take: Mark["take"]; short: boolean }) {
  const { open } = usePanel()
  return (
    <button type="button" aria-label={take.name} className="underline-offset-4 hover:underline" onClick={() => open({ kind: "take", uid: take.uid })}>
      <TakeName take={take} short={short} />
    </button>
  )
}

/** A label from the band's list, as РЭХА picks one (Settings › Marks): the band may have many. */
function LabelSelect({ value, onChange }: { value: number | undefined; onChange: (id: number) => void }) {
  const labels = useLabels().data ?? []
  const shown = value ?? labels[0]?.id
  return (
    <Select value={shown === undefined ? undefined : String(shown)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label="Label" className="w-auto shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {labels.map((l) => (
          <SelectItem key={l.id} value={String(l.id)}>
            <LabelDot colour={l.colour} />
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A mark's label and note, being written or changed. */
function MarkForm({
  title,
  label,
  note,
  submit,
  busy,
  error,
  done,
  button,
}: {
  title: ReactNode
  label?: number
  note: string
  submit: (label: number | undefined, note: string) => void
  busy: boolean
  error?: string
  done: () => void
  button: string
}) {
  const [l, setL] = useState(label)
  const [n, setN] = useState(note)
  const send = (e: FormEvent) => {
    e.preventDefault()
    submit(l, n.trim())
  }
  return (
    <form onSubmit={send}>
      <Tile boxed className="border-primary/40">
        <span className="text-muted-foreground">{title}</span>
        <div className="flex gap-2">
          <LabelSelect value={l} onChange={setL} />
          <Input autoFocus value={n} maxLength={2000} onChange={(e) => setN(e.target.value)} placeholder="What is it about?" aria-label="Note" />
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="row" type="submit" disabled={busy}>
            {button}
          </Button>
          <Button size="row" type="button" variant="ghost" onClick={done}>
            Cancel
          </Button>
        </div>
      </Tile>
    </form>
  )
}

/** One comment under a mark; yours you can change and delete. */
function CommentLine({ comment }: { comment: MarkComment }) {
  const change = useChangeComment()
  const remove = useDeleteComment()
  const [edit, setEdit] = useState<string | null>(null)
  if (edit !== null)
    return (
      <form
        className="col-start-2 mt-1 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!edit.trim()) return
          change.mutate({ id: comment.id, text: edit.trim() }, { onSuccess: () => setEdit(null) })
        }}
      >
        <Input autoFocus value={edit} maxLength={2000} onChange={(e) => setEdit(e.target.value)} aria-label="Your comment" className="h-8" />
        <Button size="row" type="submit" disabled={change.isPending}>
          Save
        </Button>
        <Button size="row" type="button" variant="ghost" onClick={() => setEdit(null)}>
          Cancel
        </Button>
      </form>
    )
  return (
    <p className="col-start-2 mt-1">
      <span className="text-xs text-muted-foreground">{comment.author}: </span>
      {comment.text}
      {comment.mine && (
        <span className="ml-2 inline-flex gap-3 text-xs">
          <button type="button" className={actions} onClick={() => setEdit(comment.text)}>
            Edit
          </button>
          <button type="button" className={actions} disabled={remove.isPending} onClick={() => remove.mutate(comment.id)}>
            Delete
          </button>
        </span>
      )}
    </p>
  )
}

/**
 * A mark: its colour, its moment and what it says on one line; who set it
 * and when under that; the comments under that, all on one edge. `take`
 * names the take where the list mixes takes ("short" when the song is the
 * group's heading). `compact` is for Home: the last comment only, no
 * actions, and the line opens the take.
 */
export function MarkItem({ mark, take, compact }: { mark: Mark; take?: "full" | "short"; compact?: boolean }) {
  const p = usePlayer()
  const { open } = usePanel()
  const labelOf = useLabelOf()
  const label = labelOf(mark.label_id)
  const close = useChangeMark()
  const change = useChangeMark()
  const remove = useDeleteMark()
  const comment = useAddComment()
  const [reply, setReply] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const who = mark.from_reha ? "Set in РЭХА" : mark.author
  const comments = compact ? mark.comments.slice(-1) : mark.comments
  if (editing)
    return (
      <MarkForm
        title={
          <>
            The mark at <span className="tnum text-foreground">{clock(mark.at)}</span>
          </>
        }
        label={mark.label_id}
        note={mark.note}
        busy={change.isPending}
        error={change.error?.message}
        button="Save mark"
        done={() => setEditing(false)}
        submit={(label_id, note) => change.mutate({ id: mark.id, label_id, note }, { onSuccess: () => setEditing(false) })}
      />
    )
  // РЭХА's mark line (components/ui/mark.tsx): the label's dot, the time, the
  // words; the label's name only when nothing is written (its colour says it).
  return (
    <div data-mark={mark.id} data-closed={mark.closed} className={cn("grid grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 text-sm", mark.closed && "opacity-60")}>
      <span title={label.name} className="flex">
        <LabelDot colour={label.colour} />
      </span>
      <button
        type="button"
        className="flex min-w-0 items-baseline gap-2 text-left"
        onClick={() => (compact ? open({ kind: "take", uid: mark.take.uid }) : p.seek(mark.take.uid, mark.at))}
      >
        <span className="tnum shrink-0 text-muted-foreground">{clock(mark.at)}</span>
        <span className="min-w-0">{mark.note || label.name}</span>
      </button>
      <span className="col-start-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {take && <OnTake take={mark.take} short={take === "short"} />}
        {take && <span>·</span>}
        <span>
          {who} · {day(mark.created_at.slice(0, 10))}
          {mark.closed && " · closed"}
          {mark.cut_off && " · in the part a crop cut off"}
        </span>
        {mark.is_new && <Dot />}
      </span>
      {comments.map((c) => (compact ? (
        <p key={c.id} className="col-start-2 mt-1">
          <span className="text-xs text-muted-foreground">{c.author}: </span>
          {c.text}
          {mark.comments.length > 1 && <span className="text-xs text-muted-foreground"> · {mark.comments.length} comments</span>}
        </p>
      ) : (
        <CommentLine key={c.id} comment={c} />
      )))}
      {!compact &&
        (reply !== null ? (
          <form
            className="col-start-2 mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!reply.trim()) return setReply(null)
              comment.mutate({ mark: mark.id, text: reply.trim() }, { onSuccess: () => setReply(null) })
            }}
          >
            <Input autoFocus value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} placeholder="Your comment" aria-label="Your comment" className="h-8" />
            <Button size="row" type="submit" disabled={comment.isPending}>
              Send
            </Button>
          </form>
        ) : (
          <span className="col-start-2 flex flex-wrap gap-4 text-xs">
            <button type="button" className={actions} onClick={() => setReply("")}>
              Comment
            </button>
            <button type="button" className={actions} disabled={close.isPending} onClick={() => close.mutate({ id: mark.id, closed: !mark.closed })}>
              {mark.closed ? "Open again" : "Close"}
            </button>
            {mark.mine && (
              <>
                <button type="button" className={actions} onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button type="button" className={actions} onClick={() => setDeleting(true)}>
                  Delete
                </button>
              </>
            )}
          </span>
        ))}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={deleting ? `Delete the mark at ${clock(mark.at)}?` : null}
        description={deleting ? (mark.comments.length ? "Its comments go with it." : "It cannot be brought back.") : null}
        actionLabel="Delete mark"
        onConfirm={() => remove.mutate(mark.id)}
      />
    </div>
  )
}

/** A take's marks, with **Add a mark at 1:14** following the playhead. `markAt` opens with a new mark there. */
export function TakeMarks({ take, markAt }: { take: { uid: string; marks: Mark[] }; markAt?: number }) {
  const at = useTime(take.uid)
  const add = useAddMark()
  const [draft, setDraft] = useState<number | undefined>(markAt)
  const marks = take.marks
  return (
    <Group
      title="Marks"
      hint={marks.length ? String(marks.length) : undefined}
      action={
        draft === undefined && (
          <Button variant="outline" size="row" onClick={() => setDraft(at)}>
            Add a mark at {clock(at)}
          </Button>
        )
      }
    >
      {draft !== undefined && (
        <MarkForm
          title={
            <>
              A mark at <span className="tnum text-foreground">{clock(draft)}</span>
            </>
          }
          note=""
          busy={add.isPending}
          error={add.error?.message}
          button="Add mark"
          done={() => setDraft(undefined)}
          submit={(label_id, note) => add.mutate({ uid: take.uid, at: draft, label_id, note }, { onSuccess: () => setDraft(undefined) })}
        />
      )}
      {marks.length ? (
        <Rows>
          {marks.map((k) => (
            <MarkItem key={k.id} mark={k} />
          ))}
        </Rows>
      ) : (
        draft === undefined && <p className="text-muted-foreground">No marks yet. Play the take and add one where something happens.</p>
      )}
    </Group>
  )
}
