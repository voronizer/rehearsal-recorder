import { useEffect, useRef, useState, type ReactNode } from "react"
import { Circle, Cloud, Pause, Pencil, Play, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { MarkLine } from "@/components/ui/mark"
import { FooterRow } from "@/components/FooterRow"
import { MetronomeRow } from "@/components/metronome/MetronomeRow"
import { Shell } from "@/components/Shell"
import { TakeStrip, liveTake } from "@/components/TakeStrip"
import { EveningFacts } from "@/components/EveningFacts"
import { RehearsalOverview } from "@/components/RehearsalOverview"
import { EveningActions } from "@/components/EveningActions"
import { RunningLine } from "@/components/RunningLine"
import { TakePlayer } from "@/components/TakePlayer"
import { ConfirmDialog, PromptDialog, RenameTakeDialog } from "@/components/ConfirmDialog"
import { useTakeSending } from "@/components/sending/useTakeSending"
import { MarkerDialog } from "@/components/MarkerDialog"
import { useSongChoices } from "@/hooks/useSongChoices"
import { sendPlace, useEveningSettings } from "@/hooks/useEveningSettings"
import { TakeNameField, type TakeNameFieldHandle } from "@/components/TakeNameField"
import { PanelParts, SetCard, SongRows } from "@/components/NextTakeSongs"
import { SHORT, otherSongs, rowsFor, shortList, songOf, useListOpen } from "@/lib/setSongs"
import { SongKeys } from "@/components/SongKeys"
import { useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useEscape, useKey, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  poll,
  type ControlState,
  type Label,
  type Marker,
  type SendingQueue,
  type SessionState,
  type Take,
} from "@/lib/api"
import { formatMMSS, savedLine } from "@/lib/format"
import { goFor } from "@/lib/goes"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import { labelOf, useLabels } from "@/lib/labels"
import { isIn } from "@/lib/sending"
import { rise } from "@/lib/motion"
import { useWide } from "@/lib/wide"
import { useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"
import { wentTo } from "@/lib/deletion"
import { takeText } from "@/lib/takeText"
import { endedByPython, offerCropUndo, offerUndo } from "@/lib/trash"

/** The notice a button's failure is said in. Its own slot: "rehearsal" holds
 *  the warning of a crop whose original could not be moved, and an error in
 *  that slot would take its place. */
const ERROR = "rehearsal-error"

/**
 * The rehearsal hub: what has been recorded, and a big button to record more.
 * Any saved take plays right here, in the player below the strip of takes,
 * and the take Stop has just saved opens here to listen to.
 */
export function Rehearsal({
  session,
  openTake = null,
  onStartTake,
  onFinished,
  controlState,
  onChanged,
}: {
  session: Extract<SessionState, { active: true }>
  /** The take Stop has just saved: opened, paused at its start, once the
   *  session has it. */
  openTake?: number | null
  onStartTake: (takeName: string, takeGo: number | null, takeNumber: number) => void
  controlState?: ControlState | null
  onFinished: () => void
  /** Reads the session again, and answers it as it now is. */
  onChanged: () => Promise<SessionState>
}) {
  const {
    selected,
    cued,
    expanded,
    setExpanded,
    select,
    close,
    reselect,
    forget,
    openAt,
    move,
    playInOverview,
    player,
  } = useTakeStripPlayer()
  // A take open in the player, or playing in the overview: either way Space
  // is its, and Escape puts it away before it finishes anything.
  useEffect(() => {
    if (!controlState) return
    if (controlState.next_take_name && controlState.next_take_name !== session.next_take_name) void onChanged()
    const take = session.takes.find(t => t.take_number === controlState.playback_take_number)
    if (controlState.playback_open && take && selected?.take_number !== take.take_number && cued?.take_number !== take.take_number) select(take)
  }, [controlState, session.takes, session.next_take_name, selected, cued, select, onChanged])

  const inHand = selected !== null || cued !== null

  // The take Stop has just saved opens, paused at its start: once, as soon
  // as the session has it.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || openTake === null) return
    const take = session.takes.find((t) => t.take_number === openTake)
    if (!take) return
    opened.current = true
    select(take)
  }, [openTake, session.takes, select])

  // The take the last Stop saved is held: nothing sends it while it is open
  // here. Once it is not the open take any more (closed, another one opened,
  // the screen left for a take or another screen), Python lets it go, as the
  // setting or its box says. Python ends the hold itself at Record, at
  // Finish and after 10 minutes.
  // Named, so a take held after it is not let go in its place.
  const holding = useRef<{ folder: string; take: number } | null>(null)
  const openNumber = selected?.take_number ?? null
  useEffect(() => {
    if (openNumber !== null && openNumber === session.held_take)
      holding.current = { folder: session.folder, take: openNumber }
    else if (holding.current !== null && openNumber !== holding.current.take) {
      const { folder, take } = holding.current
      holding.current = null
      void api().release_take(folder, take)
    }
  }, [openNumber, session.held_take, session.folder])
  useEffect(
    () => () => {
      if (holding.current !== null)
        void api().release_take(holding.current.folder, holding.current.take)
    },
    []
  )
  const cropping = useRunning(
    "crop",
    (e) => e.folder === session.folder && e.take_number === selected?.take_number
  )
  const [busy, setBusy] = useState(false)
  // An error a button said is about this screen, and goes with it.
  const sayError = useErrorNotice(ERROR)
  const [toRename, setToRename] = useState<Take | null>(null)
  const renameChoices = useSongChoices(
    toRename !== null,
    session.folder,
    toRename?.take_number
  )
  const [markerEdit, setMarkerEdit] = useState<{
    take: Take
    marker: Marker
  } | null>(null)
  const [renamingRehearsal, setRenamingRehearsal] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const evening = useEveningSettings()
  // Where takes go, and so what the cloud button does and the words it and
  // the takes' status say. The cloud folder until the setting is read.
  const sendTo = evening?.sendTo ?? "cloud"
  const sendStates = sendTo === "service" ? session.service_queue : session.cloud_queue
  const sending = useTakeSending<Take>(sendTo, () => session.folder, () => onChanged())
  const labels = useLabels()

  // The next take's name as the field last settled on it, against the
  // session's name at the time: once Python has it, the session says the
  // same, and a take kept moves the session on past it.
  const [picked, setPicked] = useState<{ against: string; name: string } | null>(null)
  const nextName =
    picked && picked.against === session.next_take_name ? picked.name : session.next_take_name
  const fallback = session.next_take_default ?? session.next_take_name
  const nextChoices = useSongChoices(
    true,
    null,
    null,
    session.takes.map((t) => `${t.take_number}:${t.name}`).join("|")
  )
  // Names sent to Python, one after another: Record waits for the last one,
  // so a name typed and Record clicked straight after is the one recorded.
  const naming = useRef<Promise<void>>(Promise.resolve())
  // The latest `nextName`, for `startTake` to read once it has waited for
  // `naming` — set from an effect, not read off a stale closure, so a name
  // Python refused (which rolls `picked` back below) is never the one a
  // take gets recorded under.
  const nextNameRef = useRef(nextName)
  useEffect(() => {
    nextNameRef.current = nextName
  }, [nextName])
  // The go Python has for the name the field shows, while that is the name
  // it answered for; undefined for a pick it has not answered yet.
  const knownGo = nextName === session.next_take_name ? session.next_take_go : undefined
  const knownGoRef = useRef(knownGo)
  useEffect(() => {
    knownGoRef.current = knownGo
  }, [knownGo])

  // The songs beside the field (NextTakeSongs): the set, then the others.
  // What is typed in the field, and what it held as typing began, narrows
  // them; a row names the take through the field, as a pill would.
  const fieldRef = useRef<TakeNameFieldHandle>(null)
  const [typing, setTyping] = useState<{ from: string; text: string } | null>(null)
  const [listOpen, setListOpen] = useListOpen(session.folder)
  const setTitles = session.set?.songs.map((s) => s.title) ?? []
  const others = otherSongs(nextChoices, setTitles)
  const goesTonight = new Map((session.songs ?? []).map((s) => [s.name, s.takes]))
  const lastTakes = new Map((nextChoices?.here ?? []).map((c) => [c.song, c.last_take ?? 0]))
  const shownName = typing?.text ?? nextName
  const current = songOf(shownName, nextChoices, setTitles)
  const narrowBy =
    typing && typing.text.trim() !== "" && typing.text.trim() !== typing.from.trim()
      ? typing.text
      : null

  const nameNextTake = (name: string) => {
    // The name it would have anyway goes as "", so it goes on following
    // the takes when one is renamed or deleted — and what the field keeps
    // is the fallback's own spelling, not a case-only variant typed over it.
    const sent = name.toLocaleLowerCase() === fallback.toLocaleLowerCase() ? "" : name
    const shown = sent === "" ? fallback : name
    setPicked({ against: session.next_take_name, name: shown })
    naming.current = naming.current.then(async () => {
      try {
        const res = await api().set_next_take_name(sent)
        if (res.ok) {
          dismiss(ERROR)
          // What the take will be called is Python's answer: "Palyn", an old
          // name, is Pałyn, and "Pałyn 5" is Pałyn. When that is the name the
          // session had already, nothing else would bring the field round
          // to it.
          const settled = res.next_take_name
          if (settled) setPicked((p) => (p && p.name === shown ? { ...p, name: settled } : p))
        } else {
          sayError(res.error ?? "Could not name the next take")
          // Python never took it: the field goes back to the name it has.
          setPicked(null)
        }
      } catch {
        sayError("Could not name the next take")
        setPicked(null)
      }
      onChanged()
    })
  }

  const pickSong = (title: string) => {
    if (fieldRef.current) fieldRef.current.put(title)
    else nameNextTake(title)
  }

  // ↑ and ↓ go through the rows as they stand: the set's, then the others
  // (K1), folded as the list shows them — its five, the song the field
  // names after them when it is not one, then the rest. One past the five
  // opens the rest; a row picked by a key is scrolled into view (R7). While
  // typing they move a highlight through the rows the typing left, which
  // Enter takes (K3).
  const short = shortList(others, lastTakes)
  const extra = current !== null && others.includes(current) && !short.includes(current)
  const asShown =
    !listOpen && others.length > SHORT + 1
      ? [
          ...short,
          ...(extra ? [current] : []),
          ...others.filter((t) => !short.includes(t) && t !== current),
        ]
      : others
  const order = [...setTitles, ...asShown]
  const [highlight, setHighlight] = useState<string | null>(null)
  const reveal = (title: string) => {
    if (others.includes(title) && !short.includes(title)) setListOpen(true)
    requestAnimationFrame(() => {
      const panel = document.querySelector("[data-next-take-panel]")
      const key = CSS.escape(title)
      panel
        ?.querySelector(`[data-set-song="${key}"], [data-song-row="${key}"]`)
        ?.scrollIntoView({ block: "nearest" })
    })
  }
  const stepSong = (dir: 1 | -1) => {
    const at = current === null ? -1 : order.indexOf(current)
    const to = at < 0 ? (dir > 0 ? order[0] : undefined) : order[at + dir]
    if (to === undefined) return
    reveal(to)
    pickSong(to)
  }
  const arrowWhileTyping = (dir: 1 | -1) => {
    const found = rowsFor(order, narrowBy, current)
    const from = highlight ?? current
    const at = from === null ? -1 : found.indexOf(from)
    const to = at < 0 ? (dir > 0 ? found[0] : found.at(-1)) : found[at + dir]
    if (to === undefined) return
    if (narrowBy === null) reveal(to)
    setHighlight(to)
  }
  useKey("ArrowUp", () => stepSong(-1), selected === null && !busy)
  useKey("ArrowDown", () => stepSong(1), selected === null && !busy)

  const startTake = async () => {
    if (busy) return
    setBusy(true)
    dismiss(ERROR)
    await naming.current
    const res = await api().control_command("start")
    setBusy(false)
    if (!res.ok || res.take_number == null) {
      sayError(res.error ?? "Could not start the take")
      return
    }
    const name = res.take_name ?? nextNameRef.current
    const known = res.take_go ?? knownGoRef.current
    onStartTake(name, known !== undefined ? known : goFor(name, nextChoices), res.take_number)
  }

  // With a take in hand, Space plays it back rather than starting a new one;
  // Escape below is what points Space at recording again.
  useSpacebar(inHand ? player.toggle : startTake, !busy)
  usePlayerKeys(player.skip, inHand)
  // Off in Settings › Keys, the footer's buttons have no chips, and keep no
  // room for them.
  const spaceKeys = useKeysOn("space")
  const finish = async () => {
    dismiss(ERROR)
    await player.pause()
    const res = await api().control_command("stop_rehearsal")
    if (!res.ok) {
      sayError(res.error ?? "Could not finish the rehearsal")
      return
    }
    onFinished()
  }

  // Escape climbs the same ladder here as everywhere: the strip's columns,
  // the open take or a take playing in the overview, and then the rehearsal
  // itself, because finishing is the only way up from this screen. A take
  // put away stops: it does not play on in the overview (D2). Finishing
  // asks once there are takes in the rehearsal — ending it by accident
  // would leave the rest of the evening in a second folder — but an empty
  // one has nothing to protect, and Python takes its folder with it.
  useEscape(() => {
    if (selected && expanded) setExpanded(false)
    else if (inHand) close()
    else if (session.takes.length === 0) void finish()
    else setFinishing(true)
  }, !busy)

  // The open take's box at the footer's left: ticked, it goes to where takes
  // go; unticked, it stays here (D5). Ticked while it is there or on its
  // way. A tick sends it, a false start too: to the band service at once,
  // to the cloud folder through the take's cloud button's dialog. Unticking
  // takes it out: Remove from the band service, or the cloud copies'
  // removal.
  const open = liveTake(session.takes, selected)
  const ticked = open !== null && (isIn(open, sendTo) || Boolean(sendStates?.[open.take_number]))
  const tick = async (take: Take, on: boolean) => {
    if (on && sendTo === "cloud") {
      sending.share(take)
      return
    }
    const slot = `send-box:${session.folder}:${take.take_number}`
    dismiss(slot)
    const res = on
      ? await api().share_take(session.folder, take.take_number, "mix")
      : await api().unshare_take(session.folder, take.take_number)
    if (!res.ok) {
      const what = on ? "send" : "take out"
      notify({
        key: slot,
        kind: "error",
        text: `Could not ${what} ${takeText(take)}: ${res.error ?? "it was refused"}`,
      })
    }
    void onChanged()
  }

  // While takes are being copied the only thing that changes is on the Python
  // side, so ask — but only until the queue drains, and only for the takes on
  // their way. The whole session is about 16 ms of Python, and asked for every
  // 1.5 s while a take played, it made the take skip; it is read again only
  // once the takes on their way change.
  const inFlight =
    Object.keys(session.cloud_queue ?? {}).length > 0 ||
    Object.keys(session.service_queue ?? {}).length > 0
  useEffect(() => {
    if (!inFlight) return
    const was = onTheWay(session)
    let gone = false
    const id = setInterval(() => {
      poll("sending_queue").then(
        (now) => {
          if (!gone && onTheWay(now) !== was) void onChanged()
        },
        () => {}, // asked again in 1.5 s
      )
    }, 1500)
    return () => {
      gone = true
      clearInterval(id)
    }
  }, [inFlight, onChanged, session])

  // Asks nothing: the notice's Undo brings the take back into its place.
  const deleteTake = async (take: Take) => {
    dismiss(ERROR)
    player.pause()
    const res = await api().delete_take(session.folder, take.take_number)
    // What waited of this take, a crop of it, Python has sent on.
    endedByPython(res.ended)
    if (!res.ok) {
      sayError(res.error ?? "Could not delete the take")
      return
    }
    forget(take)
    // A session that cannot be read is said on the error bar already (api),
    // and the Undo is offered all the same.
    onChanged().catch(() => {})
    if (res.undo) {
      offerUndo({
        text: wentTo(`“${takeText(take)}”`),
        token: res.undo,
        onUndone: () => onChanged(),
      })
    }
  }

  const renameTake = async (take: Take, name: string) => {
    dismiss(ERROR)
    const res = await api().rename_take(session.folder, take.take_number, name)
    if (!res.ok) {
      sayError(res.error ?? "Could not rename the take")
      return
    }
    // The take folder moved with the name, so point the player at the fresh
    // paths. That is a new `tracks` identity, so the open effect underneath
    // tears down and reopens from zero — the take stays selected and on
    // screen, but playback and the A–B region do not survive this.
    if (res.take) reselect(res.take)
    onChanged()
  }

  // Python let go of the files before rewriting them, so the take has to be
  // opened again; the fresh `tracks` array is what tells the player that.
  // Rewriting eight long tracks takes real seconds, so the screen is busy
  // while it runs: a second Crop would cut the take the first one made.
  const cropTake = async (take: Take, from: number, to: number) => {
    if (busy) return
    setBusy(true)
    dismiss(ERROR)
    dismiss("rehearsal")
    player.pause()
    const res = await watching(api().crop_take(session.folder, take.take_number, from, to))
    setBusy(false)
    // The take's earlier crops, Python has sent on.
    endedByPython(res.ended)
    if (!res.ok) {
      sayError(res.error ?? "Could not crop the take")
      return
    }
    if (res.take) reselect(res.take)
    onChanged()
    offerCropUndo(takeText(take), res, () => uncropped(take), "rehearsal", from)
  }

  // A crop's Undo: the uncut take is under the same paths again, and only a
  // fresh copy of it tells the player so.
  const uncropped = async (take: Take) => {
    const s = await onChanged()
    const fresh = s.active ? s.takes.find((t) => t.take_number === take.take_number) : undefined
    if (fresh) reselect(fresh)
  }

  const renameRehearsal = async (name: string) => {
    dismiss(ERROR)
    const res = await api().rename_rehearsal(session.folder, name)
    if (!res.ok) {
      sayError(res.error ?? "Could not rename the rehearsal")
      return
    }
    // The whole folder moved, so every take's paths changed with it.
    const held = selected ?? cued
    if (held && res.takes) {
      const fresh = res.takes.find((t) => t.take_number === held.take_number)
      if (fresh) reselect(fresh)
    }
    onChanged()
  }

  // Dropping a marker opens its note straight away: the thought about what
  // just went wrong lasts about five seconds. Playback carries on.
  const addMarker = async (take: Take, seconds: number) => {
    const res = await api().add_take_marker(session.folder, take.take_number, seconds)
    onChanged()
    const fresh = res.markers?.find((m) => Math.abs(m.at - seconds) < 0.02)
    setMarkerEdit(fresh ? { take, marker: fresh } : null)
  }

  const saveMarker = async (
    take: Take,
    at: number,
    note: string,
    labelId: number
  ) => {
    await api().update_take_marker(session.folder, take.take_number, at, note, labelId)
    onChanged()
  }

  const starTake = async (take: Take, starred: boolean) => {
    await api().set_take_star(session.folder, take.take_number, starred)
    onChanged()
  }

  const removeMarker = async (take: Take, seconds: number) => {
    await api().remove_take_marker(session.folder, take.take_number, seconds)
    onChanged()
  }

  // The panel is wider from 1100 px, which follows the Appearance scale.
  const wide = useWide()

  // The open take waiting to go says so in its box and in the count at the
  // top, not in the strip as well (D6); a refusal still shows there.
  const stripStates =
    open && sendStates?.[open.take_number] === "queued"
      ? Object.fromEntries(
          Object.entries(sendStates).filter(([n]) => Number(n) !== open.take_number)
        )
      : sendStates

  // The name wraps when it is longer than its row, never cut (B6). The last
  // word goes to the next line whole, never split at a hyphen the way a date
  // would be; only a word wider than the whole box (one with no spaces in it)
  // breaks, inside the box rather than being drawn past it. The pencil goes
  // with the last character, so that it is never alone on a line.
  const nameWords = session.name.split(" ")
  const lastWord = Array.from(nameWords.pop() ?? "")
  const lastChar = lastWord.pop()

  return (
    <Shell
      playback
      air
      className="px-8 [--screen-pad-y:2rem]"
      subtitle="Rehearsal"
      title={
        <>
          {nameWords.length > 0 && `${nameWords.join(" ")} `}
          <span className="inline-block max-w-full">
            {lastWord.join("")}
            <span className="whitespace-nowrap">
              {lastChar}
              <Button
                variant="ghost"
                size="icon-row"
                aria-label="Rename rehearsal"
                onClick={() => setRenamingRehearsal(true)}
                className="-my-1.5 ml-2 align-middle text-muted-foreground hover:text-foreground"
              >
                <Pencil />
              </Button>
            </span>
          </span>
        </>
      }
      facts={
        <EveningFacts
          takes={session.takes}
          bytes={session.disk_bytes ?? null}
          folder={session.folder}
          send={sendPlace(evening)}
        />
      }
      // The next take's name, the set and the band's other songs, in a panel
      // of their own on the setup screen's panel colour (issue #12 steps 6
      // and 8): one group, the field at its head and the rest under a line
      // across the panel (owner, Q1). While a take is open, its marks are
      // there instead (D3).
      aside={
        open ? (
          <TakeMarks
            take={open}
            wide={wide}
            labels={labels}
            onSeek={player.seek}
            onEdit={(marker) => setMarkerEdit({ take: open, marker })}
            onRemove={(at) => void removeMarker(open, at)}
          />
        ) : (
        <aside
          aria-label="Next take"
          data-next-take-panel
          className={cn(
            "shrink-0 overflow-y-auto border-l bg-panel px-8 py-8",
            // Never more than 40 % of the window: at 150 % in the smallest one
            // the takes keep most of it.
            wide ? "w-[26rem]" : "w-[22.5rem] max-w-[40vw]"
          )}
        >
          <div className="animate-rise" style={rise(1)}>
            <PanelParts bleed={8}>
              <TakeNameField
                ref={fieldRef}
                id="next-take-name"
                label="Next take"
                value={nextName}
                fallback={fallback}
                choices={nextChoices}
                knownGo={knownGo}
                onCommit={nameNextTake}
                onPanel
                songs="none"
                onDraft={(text) => {
                  // What is typed changed, or the field was left: no row is
                  // highlighted any more.
                  if (text !== (typing?.text ?? null)) setHighlight(null)
                  setTyping((t) => (text === null ? null : { from: t?.from ?? text, text }))
                }}
                onArrow={arrowWhileTyping}
                highlighted={() => highlight}
                selectOnClick
                labelAside={<SongKeys />}
              />
              {session.set && (
                <SetCard
                  set={session.set}
                  goes={goesTonight}
                  current={current}
                  onPick={pickSong}
                  highlighted={highlight}
                />
              )}
              {others.length > 0 && (
                <SongRows
                  titles={others}
                  lastTake={lastTakes}
                  goes={goesTonight}
                  current={current}
                  typed={narrowBy}
                  typing={typing !== null}
                  inSet={setTitles}
                  title={session.set ? "Other songs" : "Songs"}
                  onPick={pickSong}
                  highlighted={highlight}
                  open={listOpen}
                  onOpen={setListOpen}
                />
              )}
            </PanelParts>
          </div>
        </aside>
        )
      }
      footer={
        <FooterRow
          squeeze={3}
          left={
            // While a take is open, its box in the metronome's place: the
            // row is set for the next take, so it waits unseen and keeps the
            // footer as tall as it was (D4). Nothing in it eases while it
            // waits: a button's transition-all eases visibility too, and
            // would leave the row's buttons over the box for 150 ms.
            <div className="grid">
              <div className={cn("col-start-1 row-start-1", open && "invisible [&_*]:transition-none")}>
                <MetronomeRow name={nextName} keys={!open} />
              </div>
              {open && (
                <label className="col-start-1 row-start-1 flex min-w-0 cursor-pointer items-center gap-2 self-center text-sm text-muted-foreground">
                  <Checkbox
                    checked={ticked}
                    onCheckedChange={(on) => void tick(open, on === true)}
                    // Left on the box, the next Space would tick it again
                    // rather than play.
                    onClick={(e) => e.currentTarget.blur()}
                  />
                  <Cloud className="size-4 shrink-0" />
                  <span className="truncate">
                    {sendTo === "service" ? "Send to the band service" : "Send to the cloud"}
                  </span>
                </label>
              )}
            </div>
          }
        >
          {/* Two buttons whatever is in hand, each as wide as the widest
              thing it says, so nothing beside them moves as a take opens,
              plays or closes (B4). Each shows its key while Settings › Keys
              has them on (D1): Esc on the left one, Space on the right. */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="footer-aside"
              className="px-6"
              onClick={inHand ? close : finish}
              aria-keyshortcuts={spaceKeys ? "Escape" : undefined}
            >
              <OneOf
                shown={selected ? "close" : cued ? "stop" : "finish"}
                says={{
                  finish: "Finish",
                  close: (
                    <>
                      <X />
                      Close take
                    </>
                  ),
                  stop: (
                    <>
                      <Square className="fill-current" />
                      Stop
                    </>
                  ),
                }}
              />
              {spaceKeys && <Kbd aria-hidden>Esc</Kbd>}
            </Button>
            <Button
              size="footer"
              variant={inHand ? "default" : "destructive"}
              className="px-8"
              onClick={inHand ? player.toggle : startTake}
              disabled={inHand ? player.loading : busy}
              aria-keyshortcuts={spaceKeys ? "Space" : undefined}
              // The take's place in the rehearsal is not for a person to
              // read: the Next take field says what the take will be. The
              // tests wait on it here for the take they mean to record.
              data-next-take={session.next_take_number}
            >
              <OneOf
                shown={!inHand ? "record" : player.playing ? "pause" : "play"}
                says={{
                  record: (
                    <>
                      <Circle className="fill-current" />
                      Record
                    </>
                  ),
                  play: (
                    <>
                      <Play className="fill-current" />
                      Play
                    </>
                  ),
                  pause: (
                    <>
                      <Pause className="fill-current" />
                      Pause
                    </>
                  ),
                }}
              />
              {spaceKeys && <Kbd aria-hidden>Space</Kbd>}
            </Button>
          </div>
        </FooterRow>
      }
    >
      <div className="flex w-full flex-col gap-4">
        {/* While no take is open the overview below is the way in, and the
            pills beside it would only repeat it. With none recorded yet the
            strip stays, for its "hit Record" hint. */}
        {(selected || session.takes.length === 0) && (
        <TakeStrip
          takes={session.takes}
          selected={selected}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onSelect={select}
          onGo={move}
          onRename={setToRename}
          onShare={sending.share}
          onDelete={(take) => void deleteTake(take)}
          onStar={starTake}
          cloudStates={stripStates}
          sendTo={sendTo}
          emptyHint={`Press Record${spaceKeys ? " or Space" : ""}. Each take shows up here, ready to play.`}
        />
        )}

        {selected ? (
          <TakePlayer
            player={player}
            take={open}
            markers={open?.markers ?? []}
            notes={selected.notes} notesMissing={selected.notes_missing}
            onAddMarker={(sec) => addMarker(selected, sec)}
            onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
            onRemoveMarker={(sec) => removeMarker(selected, sec)}
            onCrop={(from, to) => void cropTake(selected, from, to)}
            canCrop={!busy}
            status={cropping && <RunningLine entry={cropping} label="Cropping" />}
            spaceKey
            goKeys
            // The marks are listed in the panel at the right.
            markChips={false}
          />
        ) : (
          session.takes.length > 0 && (
            <RehearsalOverview
              takes={session.takes}
              songs={session.songs ?? []}
              playback={
                cued && {
                  take: cued.take_number,
                  playing: player.playing,
                  loading: player.loading,
                  failed: Boolean(player.loadError),
                  position: player.position,
                  duration: player.duration,
                }
              }
              onPlay={playInOverview}
              onOpen={select}
              onOpenAt={openAt}
              onRename={setToRename}
              onStar={starTake}
              onShare={sending.share}
              onDelete={(take) => void deleteTake(take)}
              cloudStates={sendStates}
              sendTo={sendTo}
              falseStartSec={evening?.falseStartSec}
              folder={session.folder}
              onName={(take, title) => void renameTake(take, title)}
              actions={
                evening && (
                  <EveningActions
                    folder={session.folder}
                    takes={session.takes}
                    falseStartSec={evening.falseStartSec}
                    cloudDir={evening.cloudDir}
                    sendTo={sendTo}
                    waiting={sendStates}
                    onChanged={onChanged}
                    onDeleted={(gone) => gone.forEach(forget)}
                  />
                )
              }
            />
          )
        )}
      </div>

      <ConfirmDialog
        open={finishing}
        onOpenChange={setFinishing}
        title="Finish this rehearsal?"
        description={`${savedLine(
          session.takes.length
        )} You cannot add to this rehearsal afterwards. A later one starts its own folder.`}
        actionLabel="Finish"
        destructive={false}
        onConfirm={() => void finish()}
      />

      <RenameTakeDialog
        take={toRename}
        choices={renameChoices}
        onOpenChange={(open) => !open && setToRename(null)}
        onSubmit={(name) => {
          if (toRename) void renameTake(toRename, name)
        }}
      />

      <MarkerDialog
        marker={markerEdit?.marker ?? null}
        onOpenChange={(open) => !open && setMarkerEdit(null)}
        onSave={(at, note, labelId) => {
          if (markerEdit) void saveMarker(markerEdit.take, at, note, labelId)
        }}
        onDelete={(at) => {
          if (markerEdit) void removeMarker(markerEdit.take, at)
        }}
      />

      {sending.dialogs}

      <PromptDialog
        open={renamingRehearsal}
        onOpenChange={setRenamingRehearsal}
        title="Rename rehearsal"
        label="The folder keeps its date and gets the new name."
        initialValue={session.name}
        onSubmit={(name) => void renameRehearsal(name)}
      />
    </Shell>
  )
}

/** Words a button says one of, all in one place, so that it is as wide as
 *  the widest of them whichever it says (B4). The others are unseen and not
 *  read out. */
function OneOf<K extends string>({ shown, says }: { shown: K; says: Record<K, ReactNode> }) {
  return (
    <span className="grid">
      {(Object.keys(says) as K[]).map((k) => (
        <span
          key={k}
          aria-hidden={k !== shown || undefined}
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center justify-center gap-2",
            k !== shown && "invisible"
          )}
        >
          {says[k]}
        </span>
      ))}
    </span>
  )
}

/**
 * The open take's marks, in the right panel where the next take's name is
 * while no take is open (D3): one line each, in time order. A line moves the
 * take there; a pencil and a cross, shown on hover and on focus, edit and
 * remove it. A take with no marks has the heading and nothing under it.
 */
function TakeMarks({
  take,
  wide,
  labels,
  onSeek,
  onEdit,
  onRemove,
}: {
  take: Take
  wide: boolean
  labels: Label[]
  onSeek: (at: number) => void
  onEdit: (marker: Marker) => void
  onRemove: (at: number) => void
}) {
  const marks = [...(take.markers ?? [])].sort((a, b) => a.at - b.at)
  return (
    <aside
      aria-label="Marks"
      data-marks-panel
      className={cn(
        "shrink-0 overflow-y-auto border-l bg-panel px-8 py-8",
        wide ? "w-[26rem]" : "w-[22.5rem] max-w-[40vw]"
      )}
    >
      <h2 className="flex min-h-8 items-center px-2 text-sm font-semibold">Marks</h2>
      <ul className="mt-2 flex flex-col">
        {marks.map((m, i) => (
          <li key={`${m.at}:${i}`} className="group flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="row"
              onClick={() => onSeek(m.at)}
              className="min-w-0 flex-1 justify-start px-2 text-left"
            >
              <MarkLine label={labelOf(labels, m.label_id)} at={m.at} note={m.note} opens className="text-sm" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-row"
              aria-label={`Edit mark at ${formatMMSS(m.at)}`}
              onClick={() => onEdit(m)}
              className={cn(HOVER, "hover:text-foreground")}
            >
              <Pencil />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-row"
              aria-label={`Remove mark at ${formatMMSS(m.at)}`}
              onClick={() => onRemove(m.at)}
              className={cn(HOVER, "hover:text-destructive")}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** A mark's pencil and cross: there to the pointer over its line and to the
 *  keys, unseen otherwise. */
const HOVER =
  "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"

/** The takes on their way, as one string to compare: a take number's key
 *  reads the same however Python ordered it, as the parsed answer orders
 *  number keys rising. */
function onTheWay(q: SendingQueue): string {
  return JSON.stringify([q.cloud_queue ?? {}, q.service_queue ?? {}, [...(q.service_up ?? [])].sort((a, b) => a - b)])
}
