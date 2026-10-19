import { useEffect, useRef, useState } from "react"
import { Circle, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
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
import { ShareDialog } from "@/components/ShareDialog"
import { MarkerDialog } from "@/components/MarkerDialog"
import { useSongChoices } from "@/hooks/useSongChoices"
import { useEveningSettings } from "@/hooks/useEveningSettings"
import { TakeNameField, type TakeNameFieldHandle } from "@/components/TakeNameField"
import { PanelParts, SetCard, SongRows } from "@/components/NextTakeSongs"
import { SHORT, otherSongs, rowsFor, shortList, songOf, useListOpen } from "@/lib/setSongs"
import { SongKeys } from "@/components/SongKeys"
import { useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useEscape, useKey, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  type ControlState,
  type Marker,
  type SessionState,
  type Take,
} from "@/lib/api"
import { savedLine } from "@/lib/format"
import { goFor } from "@/lib/goes"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import { rise } from "@/lib/motion"
import { useWide } from "@/lib/wide"
import { useRunning, watching } from "@/lib/activity"
import { dismiss } from "@/lib/notices"
import { wentTo } from "@/lib/deletion"
import { endedByPython, offerCropUndo, offerUndo } from "@/lib/trash"

/** The notice a button's failure is said in. Its own slot: "rehearsal" holds
 *  the warning of a crop whose original could not be moved, and an error in
 *  that slot would take its place. */
const ERROR = "rehearsal-error"

/**
 * The rehearsal hub: what has been recorded, and a big button to record more.
 * Any saved take plays right here, in the player below the strip of takes.
 */
export function Rehearsal({
  session,
  onStartTake,
  onFinished,
  controlState,
  onChanged,
}: {
  session: Extract<SessionState, { active: true }>
  onStartTake: (takeNumber: number, takeName: string, takeGo: number | null) => void
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
    uncue,
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
  const [toShare, setToShare] = useState<Take | null>(null)
  const [markerEdit, setMarkerEdit] = useState<{
    take: Take
    marker: Marker
  } | null>(null)
  const [renamingRehearsal, setRenamingRehearsal] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const evening = useEveningSettings()

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
    onStartTake(res.take_number, name, known !== undefined ? known : goFor(name, nextChoices))
  }

  // With a take in hand, Space plays it back rather than starting a new one;
  // Escape below is what points Space at recording again.
  useSpacebar(inHand ? player.toggle : startTake, !busy)
  usePlayerKeys(player.skip, inHand)
  // Off in Settings › Keys, Finish and Record have no chips, and keep no
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
  // the open take, then a take playing in the overview, and then the
  // rehearsal itself, because finishing is the only way up from this screen.
  // It asks once there are takes in the rehearsal — ending it by accident
  // would leave the rest of the evening in a second folder — but an empty
  // one has nothing to protect, and Python takes its folder with it.
  useEscape(() => {
    if (selected && expanded) setExpanded(false)
    else if (selected) select(null)
    else if (cued) uncue()
    else if (session.takes.length === 0) void finish()
    else setFinishing(true)
  }, !busy)

  // While takes are being copied the only thing that changes is on the Python
  // side, so ask — but only until the queue drains.
  const inFlight = Object.keys(session.cloud_queue ?? {}).length > 0
  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(() => onChanged(), 1500)
    return () => clearInterval(id)
  }, [inFlight, onChanged])

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
    onChanged()
    if (res.undo) {
      offerUndo({
        text: wentTo(`“${take.name}”`),
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
    offerCropUndo(take.name, res, () => uncropped(take), "rehearsal")
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
        />
      }
      // The next take's name, the set and the band's other songs, in a panel
      // of their own on the setup screen's panel colour (issue #12 steps 6
      // and 8): one group, the field at its head and the rest under a line
      // across the panel (owner, Q1).
      aside={
        <aside
          aria-label="Next take"
          data-next-take-panel
          className={cn(
            "shrink-0 overflow-y-auto border-l bg-panel px-8 py-8",
            wide ? "w-[26rem]" : "w-[22.5rem]"
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
                labelAside={<SongKeys hidden={selected !== null} />}
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
      }
      footer={
        <FooterRow left={<MetronomeRow />}>
          <div className="flex items-center gap-3">
            {/* Escape finishes only with no take in hand; with one, it puts
                the take away — see useEscape above. */}
            <Button
              variant="outline"
              size="footer-aside"
              onClick={finish}
              aria-keyshortcuts={spaceKeys && !inHand ? "Escape" : undefined}
            >
              Finish
              {/* Kept unseen while Esc is the take's, so Finish keeps its
                  width and nothing beside it moves (B4). */}
              {spaceKeys && (
                <Kbd aria-hidden className={cn(inHand && "invisible")}>
                  Esc
                </Kbd>
              )}
            </Button>
            <Button
              size="footer"
              variant="destructive"
              onClick={startTake}
              disabled={busy}
              aria-keyshortcuts={spaceKeys && !inHand ? "Space" : undefined}
            >
              <Circle className="fill-current" />
              <span>
                Record take{" "}
                {/* Two digits wide whatever the number, so that take 10 moves
                    nothing (B4): a hidden 00 holds the room, in the same
                    figures. 2ch would be short of it, as a zero in the text's
                    own figures is narrower than a tabular one. The button
                    grows once, at 100. */}
                <span className="tnum inline-grid">
                  <span className="col-start-1 row-start-1">{session.next_take_number}</span>
                  <span aria-hidden className="invisible col-start-1 row-start-1">
                    00
                  </span>
                </span>
              </span>
              {/* With a take in hand Space plays it, and the key is on Play;
                  the chip keeps its room. */}
              {spaceKeys && (
                <Kbd aria-hidden className={cn(inHand && "invisible")}>
                  Space
                </Kbd>
              )}
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
          onShare={setToShare}
          onDelete={(take) => void deleteTake(take)}
          onStar={starTake}
          cloudStates={session.cloud_queue}
          emptyHint={`Press Record take${spaceKeys ? " or Space" : ""}. Each take shows up here, ready to play.`}
        />
        )}

        {selected ? (
          <TakePlayer
            player={player}
            markers={liveTake(session.takes, selected)?.markers ?? []}
            notes={selected.notes} notesMissing={selected.notes_missing}
            onAddMarker={(sec) => addMarker(selected, sec)}
            onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
            onRemoveMarker={(sec) => removeMarker(selected, sec)}
            onCrop={(from, to) => void cropTake(selected, from, to)}
            canCrop={!busy}
            status={cropping && <RunningLine entry={cropping} label="Cropping" />}
            spaceKey
            goKeys
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
              onShare={setToShare}
              onDelete={(take) => void deleteTake(take)}
              cloudStates={session.cloud_queue}
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
                    waiting={session.cloud_queue}
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
        )} You cannot add to this rehearsal afterwards — a later one starts its own folder.`}
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

      <ShareDialog
        take={toShare}
        folder={session.folder}
        onOpenChange={(open) => !open && setToShare(null)}
        onDone={onChanged}
      />

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
