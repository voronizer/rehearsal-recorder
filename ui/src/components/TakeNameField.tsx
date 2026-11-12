import { useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react"
import { X } from "lucide-react"
import { SongPills } from "@/components/SongPills"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Whole } from "@/components/ui/whole"
import type { SongChoices } from "@/lib/api"
import { goFor, isNoSong, nameWithGo, songFor, songNamed, unnamedGo, withoutGo } from "@/lib/goes"
import { forgetSongName } from "@/lib/songNames"
import { GO_SPACE, NO_SONG, goMark } from "@/lib/takeText"
import { cn } from "@/lib/utils"

/** The choices with one old name taken out of them: forgotten, until
 *  Python's fresh list arrives. */
function without(choices: SongChoices | null, name: string): SongChoices | null {
  if (!choices) return null
  const key = name.toLocaleLowerCase()
  const strip = (c: SongChoices["here"][number]) => ({
    ...c,
    also: c.also?.filter((a) => a.toLocaleLowerCase() !== key),
  })
  return { ...choices, here: choices.here.map(strip), other: choices.other.map(strip) }
}

/** A line break, with the spaces round it: one space in a name. */
const LINE_BREAKS = /\s*[\r\n]+\s*/g

/** What a list drawn beside the field, not under it (the rehearsal
 *  screen's songs), names the take through: as a pill would. */
export type TakeNameFieldHandle = { put: (name: string) => void }

/**
 * A take's name, in one field: in the Next take panel before the take, and
 * in the Rename take dialog after it. Naming the take is what is most
 * easily forgotten at a rehearsal, so it is big.
 *
 * It shows `value`, the name as settled, except while somebody types in
 * it. The name settled on goes to `onCommit`: a song clicked under it, ✕,
 * Enter, or focus leaving it. Never empty: ✕ and an emptied field both put
 * back `fallback`, the name the take would have anyway.
 *
 * The songs narrow from what the field held when focus arrived, not from
 * `value` itself — so coming back to a name already settled on, without
 * retyping it, still has every song under it — and while the field has
 * focus, the songs area is held at the height it had then, so the list
 * emptying out as it narrows, and filling again once the name is left or
 * put back, moves neither the field nor the buttons beside it. A field
 * focused as it is first drawn (a dialog's) takes that height at the first
 * key instead, the songs not being drawn yet when focus arrives. Left with
 * an old name in it, the area stays held, the songs still narrowed to that
 * one and the line under them, until the name is another.
 *
 * Space types a space and Escape leaves the field (useSpacebar.ts does both
 * for any text field); Enter leaves it too, so the next Space does what the
 * main button says — or, given `onEnter`, does that instead. A song or ✕
 * clicked while typing leaves it as well, for the same Space; given
 * `onEnter`, the field keeps focus instead, so Enter is still there to press.
 *
 * A song's old name in it (SongChoice.also), with or without a number, is
 * that song (rename-and-merge-songs spec, D6 and D8): the field says
 * "Palyn → Pałyn #12", and under the songs, "Palyn is Pałyn now. Make Palyn
 * a new song", which forgets the old name and puts it in the field. Not only
 * while typing: Rename take keeps what was typed until Rename is pressed.
 *
 * `songs` "none" draws no pills and no All songs…: the rehearsal screen
 * lists the songs as rows beside it instead (NextTakeSongs), which name the
 * take through `ref`'s `put`, as a pill does. The old name's line stays, in
 * a popover under the field that takes no focus. There, while typing, ↑ and
 * ↓ go to `onArrow`, and Enter names the take after the row they are on
 * (`highlighted`) and leaves the field; with `selectOnClick` the first click
 * into the field selects the name whole, so typing replaces it, and a second
 * places the caret.
 *
 * The big size is a textarea, so a name longer than the field wraps and the
 * take's number follows its last line. It is one line all the same: a line
 * break typed or pasted in is a space, and Enter never adds one.
 */
export function TakeNameField({
  id,
  label,
  value,
  fallback,
  choices,
  knownGo,
  onCommit,
  onEnter,
  size = "big",
  autoFocus = false,
  onPanel = false,
  goes = true,
  offerNewSong = true,
  onDraft,
  songs = "pills",
  onArrow,
  highlighted,
  selectOnClick = false,
  labelAside,
  ref,
}: {
  id: string
  label: string
  value: string
  fallback: string
  choices: SongChoices | null
  /** The go Python has for `value`, drawn until `choices` arrive; not while
   *  the field is being typed in, when it no longer says anything. */
  knownGo?: number | null
  onCommit: (name: string) => void
  onEnter?: (name: string) => void
  size?: "big" | "compact"
  autoFocus?: boolean
  /** Set on the rehearsal screen's panel colour, where the muted field
   *  would sink into it: the field is drawn on the card colour instead. */
  onPanel?: boolean
  /** False for a song's title (Rename song): no go beside it or the songs. */
  goes?: boolean
  /** False where an old name typed is not a take being named: no "Make
   *  Palyn a new song". */
  offerNewSong?: boolean
  /** What is typed, as it is typed; null once the field is left. */
  onDraft?: (text: string | null) => void
  /** "none": no songs under the field; they are listed beside it. */
  songs?: "pills" | "none"
  /** ↑ and ↓ while typing: the rows beside the field. */
  onArrow?: (dir: 1 | -1) => void
  /** The row ↑ and ↓ are on while typing, which Enter takes. */
  highlighted?: () => string | null
  selectOnClick?: boolean
  /** Drawn at the right of the label. */
  labelAside?: ReactNode
  ref?: Ref<TakeNameFieldHandle>
}) {
  // What is typed, while the field has focus; null shows `value`.
  const [draft, setDraft] = useState<string | null>(null)
  // The same, for onBlur to read. A song clicked while typing leaves the
  // field from inside its own click, before React has drawn anything new,
  // and `shown` there would still be the half-typed name.
  const typed = useRef<string | null>(null)
  // What the field held when focus arrived: the songs narrow from this, not
  // from `value`, so refocusing a name already settled on does not narrow
  // it by itself.
  const [startedAs, setStartedAs] = useState<string | null>(null)
  // The songs area's height when focus arrived, held while the field has
  // focus so narrowing to nothing and back does not move anything beside it
  // (and while an old name is in it, below).
  const [held, setHeld] = useState<number | null>(null)
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // A click that focused the field, to select the name whole once it is over.
  const wholeOnClick = useRef(false)
  const songsArea = useRef<HTMLDivElement>(null)
  // An old name forgotten here, and the choices it was forgotten from: it
  // is taken out of them until Python's fresh list replaces them.
  const [forgot, setForgot] = useState<{ name: string; from: SongChoices | null } | null>(null)
  const known = forgot && forgot.from === choices ? without(choices, forgot.name) : choices
  // A take with no song is "Take 49" to Python and "Take #49" on screen: the
  // field holds "Take", and 49 is drawn after it as a song's go is. "Take",
  // "Take 5" or "Take #5" typed is no song too, and Python gives it the go
  // whatever the number: the one it has for the name settled on (knownGo),
  // else its answer for this take (unnamed_go), else the number in the name
  // it gave. Python reads "take" in small letters as a song's title, so the
  // field does too.
  const isUnnamed = (text: string) => goes && isNoSong(text)
  const atRest = (name: string) => (isUnnamed(name) ? NO_SONG : name)
  const noSongGo =
    (draft === null && knownGo != null ? knownGo : null) ?? known?.unnamed_go ?? unnamedGo(value)
  // A name as ✕ says it: "Take #49" for one with no song.
  const said = (name: string) => (goes ? nameWithGo(name, null) : name)
  const shown = draft ?? atRest(value)
  // An emptied field puts back `fallback`. When that has no song, its go is
  // drawn beside the empty field.
  const empty = shown.trim() === "" && isUnnamed(fallback)
  const go = !goes
    ? null
    : empty
      ? (unnamedGo(fallback) ?? noSongGo)
      : isUnnamed(shown)
        ? noSongGo
        : known === null && draft === null && knownGo !== undefined
          ? knownGo
          : goFor(shown, known)
  // The song an old name in the field is now. A title is taken whole: in
  // Rename song, "Palyn 5" is a title of its own, not Palyn.
  const via = goes ? songFor(shown, known) : songNamed(shown, known)
  const old = via?.old != null ? { name: via.old, song: via.choice.song } : null
  // Held while typing, and after it while an old name narrows the songs to
  // one and has its line under them: filling again on leaving would move
  // what is under the area, or the buttons beside it, under the pointer.
  const holding = startedAs !== null || old !== null
  const named = (text: string) => {
    const name = text.trim()
    if (!name) return fallback
    // No song for a take that has none already: its own name, so it keeps
    // its go.
    return isUnnamed(name) && isUnnamed(value) ? value : name
  }
  const edit = (text: string | null) => {
    typed.current = text
    setDraft(text)
    onDraft?.(text)
  }

  const commit = (name: string) => {
    if (name !== value) onCommit(name)
  }
  // A song or ✕ while typing: the field is left, so the next Space records
  // or saves rather than typing a space. What was typed is dropped first, so
  // onBlur, which runs inside blur(), finds nothing of it to send. Given
  // `onEnter`, the name goes into the field and stays there to type on;
  // `startedAs` moves with it, so a fallback that is not itself a song (the
  // "Take" of a take nobody named) does not narrow the pills by its own text
  // until the field is left and refocused.
  const put = (name: string) => {
    if (typed.current === null) {
      commit(name)
    } else if (onEnter) {
      edit(atRest(name))
      setStartedAs(atRest(name))
      commit(name)
    } else {
      typed.current = null
      commit(name)
      input.current?.blur()
    }
  }

  useImperativeHandle(ref, () => ({ put }))

  const oldLine =
    old && offerNewSong ? (
      // On one line when it fits, else two, each cut with the whole on hover:
      // hung under the field in a popover, it covers no more than the set's
      // name.
      <p
        data-old-name
        className={cn(
          "flex flex-wrap gap-x-1 text-xs text-muted-foreground",
          songs === "pills" && "mt-2"
        )}
      >
        <Whole text={`${old.name} is ${old.song} now.`} className="max-w-full truncate" />{" "}
        <Button
          variant="link"
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            // What was typed, less a number after it: the go is the app's.
            const text = songNamed(shown, known) ? shown.trim() : withoutGo(shown)
            const from = choices
            if (!(await forgetSongName(old.name))) return
            setForgot({ name: old.name, from })
            put(text)
          }}
          className="inline h-auto max-w-full truncate p-0 text-xs"
        >
          Make {old.name} a new song
        </Button>
      </p>
    ) : null

  // The field's own props, the same in a textarea and an input.
  const props = {
    id,
    "aria-describedby": `${id}-go`,
    ref: input,
    value: shown,
    autoFocus,
    autoComplete: "off",
    spellCheck: false,
    onMouseDown: () => {
      // The first click selects the name whole; once in it, a click
      // places the caret, as anywhere. Selected once the click is
      // over: Chrome puts back the caret it had before otherwise.
      wholeOnClick.current = selectOnClick && document.activeElement !== input.current
    },
    onClick: () => {
      if (wholeOnClick.current) input.current?.select()
      wholeOnClick.current = false
    },
    onFocus: () => {
      edit(atRest(value))
      setStartedAs(atRest(value))
      setHeld(songsArea.current?.offsetHeight ?? null)
    },
    onBlur: () => {
      const left = typed.current
      edit(null)
      setStartedAs(null)
      if (left !== null) commit(named(left))
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (onArrow && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault()
        onArrow(e.key === "ArrowDown" ? 1 : -1)
        return
      }
      if (e.key !== "Enter") return
      e.preventDefault()
      const row = highlighted?.()
      if (row) put(row)
      else if (onEnter) onEnter(named(shown))
      else input.current?.blur()
    },
  }
  const change = (text: string) => {
    // Before this key is drawn, the area still has its full height.
    if (held === null) setHeld(songsArea.current?.offsetHeight ?? null)
    edit(text)
  }

  return (
    <div role="group" aria-label={label} className="relative flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
          {label}
        </Label>
        {labelAside}
      </div>
      {/* With the songs listed beside the field, the old name's line hangs
          from the field in a popover, so nothing under the field moves as it
          comes and goes. It is not modal and takes no focus: the field keeps
          the keys. Not a dialog, either (role="note"): Escape in the field
          leaves it, as anywhere (hooks/useSpacebar.ts, LAYERS). */}
      <Popover open={songs === "none" && oldLine !== null} modal={false}>
        {/* The shared field's frame, at this field's own size and colours:
            the big one a grid, as tall as the copy in it; the text clear of
            ✕ at the right. Neither the frame nor the ✕'s place is a group
            of its own (role="none"): the named group above holds both. */}
        <PopoverAnchor asChild>
          <InputGroup
            role="none"
            className={cn(
              "h-auto w-full max-w-md rounded-lg shadow-none has-[>[data-align=inline-end]]:[&>input]:pr-11",
              size === "big" && "grid items-stretch",
              onPanel ? "bg-card dark:bg-card" : "bg-muted/45 dark:bg-muted/45"
            )}
          >
            {/* The go this name will be, after the text: drawn over the field,
                behind an invisible copy of the text, so it sits where the text
                ends — on the last line of a name that wraps. It is never part
                of the name, so it cannot be selected or typed over (songs in
                the store, D2). In the big size this copy is also what the
                field takes its height from. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none pr-11 pl-3.5 font-semibold",
                size === "big"
                  ? "col-start-1 row-start-1 py-1.5 text-2xl leading-8 break-words whitespace-pre-wrap"
                  : "absolute inset-0 flex items-center overflow-hidden text-base whitespace-pre"
              )}
            >
              <span className="invisible">{shown}</span>
              {old ? (
                <span data-take-go className="tnum text-muted-foreground">
                  {" → "}
                  {old.song}
                  {go !== null && `${GO_SPACE}${goMark(go)}`}
                </span>
              ) : (
                go !== null && (
                  // After a space that can break, as the typed text's own can:
                  // the copy wraps where the field does.
                  <span data-take-go className="tnum text-muted-foreground">
                    {" "}
                    {goMark(go)}
                  </span>
                )
              )}
            </div>
            <span id={`${id}-go`} className="sr-only">
              {old
                ? `${old.song}${go !== null ? `${GO_SPACE}${goMark(go)}` : ""}`
                : go !== null
                  ? `${isUnnamed(shown) || empty ? NO_SONG : (via?.choice.song ?? shown.trim())}${GO_SPACE}${goMark(go)}`
                  : ""}
            </span>
            {size === "big" ? (
              // One line all the same: a line break pasted in is a space.
              <InputGroupTextarea
                {...props}
                rows={1}
                onChange={(e) => {
                  const field = e.target
                  const typed = field.value
                  const text = typed.replace(LINE_BREAKS, " ")
                  // Rewritten, the value puts the caret at its end: it goes back
                  // to where the paste ended, once the field is drawn.
                  const caret = typed.slice(0, field.selectionStart).replace(LINE_BREAKS, " ").length
                  change(text)
                  if (text !== typed) queueMicrotask(() => field.setSelectionRange(caret, caret))
                }}
                // As tall as the copy, not its own text (field-sizing), which
                // older WebKit cannot measure.
                className="col-start-1 row-start-1 block size-full min-h-0 field-sizing-fixed overflow-hidden py-1.5 pr-11 pl-3.5 text-2xl leading-8 font-semibold break-words whitespace-pre-wrap md:text-2xl"
              />
            ) : (
              <InputGroupInput
                {...props}
                onChange={(e) => change(e.target.value)}
                className="h-9 pr-11 pl-3.5 text-base font-semibold md:text-base"
              />
            )}
            <InputGroupAddon
              role="none"
              align="inline-end"
              className={cn(
                "absolute right-1.5 p-0 has-[>button]:mr-0",
                size === "big" ? "top-2" : "top-1/2 -translate-y-1/2"
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-row"
                aria-label={`Put back “${said(fallback)}”`}
                // Takes no focus of its own, as the songs take none: `put`
                // says whether the field keeps it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => put(fallback)}
                className={cn(
                  "rounded-full text-muted-foreground hover:text-foreground",
                  size === "compact" && "size-7"
                )}
              >
                <X className="size-4" />
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </PopoverAnchor>
        {songs === "none" && oldLine && (
          <PopoverContent
            role="note"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="w-(--radix-popover-trigger-width) px-3 py-2"
          >
            {oldLine}
          </PopoverContent>
        )}
      </Popover>
      {songs === "pills" && (
        <div ref={songsArea} style={{ minHeight: (holding && held) || undefined }}>
          <SongPills
            choices={known}
            value={shown}
            initial={startedAs ?? shown}
            onPick={put}
            goes={goes}
          />
          {oldLine}
        </div>
      )}
    </div>
  )
}
