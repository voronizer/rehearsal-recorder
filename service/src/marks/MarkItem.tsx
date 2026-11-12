import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { flushSync } from "react-dom"
import { Check, Ellipsis, Play } from "lucide-react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LabelDot } from "@/components/ui/mark"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { Avatar, BARE, ErrorLine, Group, Rows, Tile } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { KeepWriting } from "../shell/unsent"
import { clock, day, localDay } from "../shell/words"
import { usePlayer, useTime } from "../takes/player/one"
import { TakeLink, useInitials, useLabelOf } from "../takes/parts"

/** The take a mark is on, in a mark's row, as a name that opens the take's page. */
export function OnTake({ take, short }: { take: Mark["take"]; short: boolean }) {
  return <TakeLink take={take} short={short} plain className="min-w-0" />
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
export function MarkForm({
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
  // Sent: the panel may move on to the new mark without asking.
  const [sent, setSent] = useState(false)
  // Not sent after all: leaving asks again.
  useEffect(() => {
    if (!busy && error) setSent(false)
  }, [busy, error])
  const send = (e: FormEvent) => {
    e.preventDefault()
    setSent(true)
    submit(l, n.trim())
  }
  return (
    <form onSubmit={send}>
      <KeepWriting dirty={!sent && (n.trim() !== note.trim() || l !== label)} />
      <Tile boxed className="border-primary/40">
        <span className="text-muted-foreground">{title}</span>
        <Field className="gap-1">
          <div className="flex gap-2">
            <LabelSelect value={l} onChange={setL} />
            <Input autoFocus value={n} maxLength={2000} onChange={(e) => setN(e.target.value)} placeholder="What is it about?" aria-label="Note" />
          </div>
          <ErrorLine error={error} />
        </Field>
        <div className="flex gap-2">
          <Button size="row" type="submit" disabled={busy}>
            {button}
          </Button>
          <Button
            size="row"
            type="button"
            variant="ghost"
            onClick={() => {
              // Cancel is the answer already: no question about the words.
              flushSync(() => setSent(true))
              done()
            }}
          >
            Cancel
          </Button>
        </div>
      </Tile>
    </form>
  )
}

/** A message in a mark's talk, as a chat has it: who in a circle, their name and day over the words. */
function Message({ initial, name, when, menu, children }: { initial: string; name: string; when: string; menu?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Avatar letter={initial} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-h-6 items-center gap-1.5">
          <span className="min-w-0 truncate font-semibold">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{when}</span>
          {menu && <span className="ml-auto">{menu}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

/** The words of a message, line breaks kept. */
const WORDS = "whitespace-pre-wrap break-words leading-6"

/** ⋯ with what you may do with your own mark or comment. */
function Mine({ what, edit, remove }: { what: string; edit: () => void; remove: () => void }) {
  return (
    // It opens a question as it closes: not modal, no fade (components/ui/dropdown-menu.tsx).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-tiny" aria-label={`What to do with ${what}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="data-[state=closed]:animate-none">
        <DropdownMenuItem onSelect={edit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onSelect={remove}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One comment under a mark; yours you can change and delete, after a question. */
function CommentLine({ comment }: { comment: MarkComment }) {
  const change = useChangeComment()
  const remove = useDeleteComment()
  const [edit, setEdit] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const letters = useInitials()
  return (
    <Message
      initial={letters(comment.member_id, comment.author, comment.initial)}
      name={comment.author}
      when={day(localDay(comment.created_at))}
      menu={comment.mine && edit === null && <Mine what="your comment" edit={() => setEdit(comment.text)} remove={() => setDeleting(true)} />}
    >
      <KeepWriting dirty={edit !== null && edit.trim() !== comment.text} />
      {edit === null ? (
        <p className={WORDS}>{comment.text}</p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!edit.trim()) return
            change.mutate({ id: comment.id, text: edit.trim() }, { onSuccess: () => setEdit(null) })
          }}
        >
          <Reply value={edit} onChange={setEdit} label="Your comment" autoFocus />
          <span className="flex gap-2">
            <Button size="row" type="submit" disabled={change.isPending || !edit.trim()}>
              Save
            </Button>
            <Button size="row" type="button" variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </span>
        </form>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={deleting ? "Delete your comment?" : null}
        description={deleting ? "It cannot be brought back." : null}
        actionLabel="Delete comment"
        onConfirm={() => remove.mutate(comment.id)}
      />
    </Message>
  )
}

/**
 * A box to write in that grows with the words, up to six lines.
 * Ctrl+Enter (⌘Enter on a Mac) sends; Esc leaves the box, the words kept.
 */
function Reply({ value, onChange, label, autoFocus }: { value: string; onChange: (text: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <Textarea
      autoFocus={autoFocus}
      value={value}
      rows={Math.min(6, Math.max(1, value.split("\n").length))}
      maxLength={2000}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // With nothing written, Esc goes on to the panel, which closes.
        if (e.key === "Escape" && value) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
      }}
      placeholder={label}
      aria-label={label}
      // As the box was: its rows, 14 px on a phone too, no fill in dark.
      className="min-h-0 resize-none text-sm field-sizing-fixed dark:bg-transparent"
    />
  )
}

/** The box under a mark's talk, always open: **Send** comes once there are words. */
function CommentBox({ mark }: { mark: Mark }) {
  const add = useAddComment()
  const [text, setText] = useState("")
  return (
    <form
      className="flex flex-col gap-2 pl-9.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        add.mutate({ mark: mark.id, text: text.trim() }, { onSuccess: () => setText("") })
      }}
    >
      <Field className="gap-1">
        <Reply value={text} onChange={setText} label="Your comment" />
        <ErrorLine error={add.error?.message} />
      </Field>
      <KeepWriting dirty={text.trim() !== ""} />
      {text.trim() && (
        <Button size="row" type="submit" className="self-start" disabled={add.isPending}>
          Send
        </Button>
      )}
    </form>
  )
}

/** What deleting a mark takes with it. */
const goesWith = (comments: number) =>
  comments === 0 ? "It cannot be brought back." : comments === 1 ? "Its comment goes with it." : `Its ${comments} comments go with it.`

/** Who set a mark, as a message's circle and name. */
const setter = (mark: Mark) =>
  mark.from_reha || !mark.member_id ? { member: "", initial: "Р", name: "Set in РЭХА" } : { member: mark.member_id, initial: mark.initial ?? "?", name: mark.author ?? "" }

/**
 * A mark on Home: its colour, its moment and what it says on one line; the
 * take, who set it and when under that; its last comment. The row opens the
 * mark with its talk, as a row of **Marks** does; the take's name, the take.
 */
function MarkBrief({ mark, take }: { mark: Mark; take?: "full" | "short" }) {
  const { open } = usePanel()
  const label = useLabelOf()(mark.label_id)
  const last = mark.comments.at(-1)
  const go = () => open({ kind: "mark", uid: mark.take.uid, id: mark.id })
  // РЭХА's mark line (components/ui/mark.tsx): the label's dot, the time, the
  // words; the label's name only when nothing is written (its colour says it).
  return (
    <div
      data-mark={mark.id}
      data-closed={mark.closed}
      onClick={(e) => !(e.target as HTMLElement).closest("button, a") && go()}
      className={cn("grid grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1", mark.closed && "opacity-60")}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex">
            <LabelDot colour={label.colour} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label.name}</TooltipContent>
      </Tooltip>
      <Button variant="ghost" className={cn(BARE, "flex min-w-0 items-baseline gap-2 whitespace-normal")} onClick={go}>
        <span className="tnum shrink-0 text-muted-foreground">{clock(mark.at)}</span>
        <span className="min-w-0">{mark.note || label.name}</span>
      </Button>
      <span className="col-start-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {take && <OnTake take={mark.take} short={take === "short"} />}
        {take && <span>·</span>}
        <span className="max-w-40 truncate">{setter(mark).name}</span>
        <span>·</span>
        <span>
          {day(localDay(mark.created_at))}
          {mark.closed && " · done"}
        </span>
      </span>
      {last && (
        <p className="col-start-2 mt-1">
          <span className="text-xs text-muted-foreground">{last.author}: </span>
          {last.text}
          {mark.comments.length > 1 && <span className="text-xs text-muted-foreground"> · {mark.comments.length} comments</span>}
        </p>
      )}
    </div>
  )
}

/**
 * A mark with its talk, as a chat (Alex's pick B, 2026-11-02). On top its
 * label, ▶ and its moment, **Done**, and ⋯ on your own mark. Under that the
 * mark's words and each comment as messages, who in a circle as on the
 * stars; then the box for your comment, always open. `compact` is for Home:
 * one line and the last comment, which open the mark with its talk.
 */
export function MarkItem({ mark, take, compact }: { mark: Mark; take?: "full" | "short"; compact?: boolean }) {
  const p = usePlayer()
  const label = useLabelOf()(mark.label_id)
  const close = useChangeMark()
  const change = useChangeMark()
  const remove = useDeleteMark()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const letters = useInitials()
  if (compact) return <MarkBrief mark={mark} take={take} />
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
  const who = setter(mark)
  return (
    <div data-mark={mark.id} data-closed={mark.closed} className="flex flex-col gap-3 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge data-label variant="secondary" className="h-7 gap-1.5 border-0 px-2.5 py-0 text-sm font-normal">
          <LabelDot colour={label.colour} />
          {label.name}
        </Badge>
        <Button variant="ghost" size="row" aria-label={`Play from ${clock(mark.at)}`} onClick={() => p.play(mark.take.uid, mark.at)}>
          <Play />
          <span className="tnum">{clock(mark.at)}</span>
        </Button>
        {take && <OnTake take={mark.take} short={take === "short"} />}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="row" disabled={close.isPending} onClick={() => close.mutate({ id: mark.id, closed: !mark.closed })}>
            {mark.closed ? "Not done yet" : <><Check />Done</>}
          </Button>
          {mark.mine && <Mine what={`the mark at ${clock(mark.at)}`} edit={() => setEditing(true)} remove={() => setDeleting(true)} />}
        </span>
      </div>
      <div className={cn("flex flex-col gap-3", mark.closed && "opacity-60")}>
        <Message initial={who.member ? letters(who.member, who.name, who.initial) : who.initial} name={who.name} when={day(localDay(mark.created_at))}>
          {mark.note && <p className={WORDS}>{mark.note}</p>}
          {mark.cut_off && <p className="text-xs text-muted-foreground">In the part a crop cut off.</p>}
        </Message>
        {mark.comments.map((c) => (
          <CommentLine key={c.id} comment={c} />
        ))}
      </div>
      <CommentBox mark={mark} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={deleting ? `Delete the mark at ${clock(mark.at)}?` : null}
        description={deleting ? goesWith(mark.comments.length) : null}
        actionLabel="Delete mark"
        onConfirm={() => remove.mutate(mark.id)}
      />
    </div>
  )
}

/** A take's marks, with **Add a mark at 1:14** following the playhead. */
export function TakeMarks({ take }: { take: { uid: string; marks: Mark[] } }) {
  const at = useTime(take.uid)
  const add = useAddMark()
  const [draft, setDraft] = useState<number>()
  const marks = take.marks
  return (
    <Group
      title="Marks"
      hint={marks.length ? String(marks.length) : undefined}
      action={
        draft === undefined && (
          <Button variant="outline" size="row" onClick={() => setDraft(at)}>
            Add a mark at <span className="tnum">{clock(at)}</span>
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
        <Rows talk>
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
