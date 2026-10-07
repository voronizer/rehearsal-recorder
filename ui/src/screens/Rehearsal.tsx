import { useEffect, useRef, useState } from "react"
import { Circle, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FooterRow } from "@/components/FooterRow"
import { Kbd, Shell } from "@/components/Shell"
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
import { TakeNameField } from "@/components/TakeNameField"
import { BeforeTonightCard } from "@/components/BeforeTonightCard"
import { byPlace, type PlacedTake } from "@/lib/songs"
import { useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { useEscape, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  type Marker,
  type SessionState,
  type Take,
} from "@/lib/api"
import { croppedButNotSwept, takesLabel } from "@/lib/format"
import { goFor } from "@/lib/goes"
import { useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"
import { canBePutBack, goPlural, takeCloudToo } from "@/lib/deletion"

/**
 * The rehearsal hub: what has been recorded, and a big button to record more.
 * Any saved take plays right here, in the player below the strip of takes.
 */
export function Rehearsal({
  session,
  onStartTake,
  onFinished,
  onChanged,
}: {
  session: Extract<SessionState, { active: true }>
  onStartTake: (takeNumber: number, takeName: string, takeGo: number | null) => void
  onFinished: () => void
  onChanged: () => void
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
    cueAt,
    player,
  } = useTakeStripPlayer(byPlace)
  // An earlier go from the panel is a take placed in its own rehearsal:
  // take numbers repeat from one rehearsal to the next, and tonight's
  // takes have no folder of their own here.
  const cuedEarlier = cued !== null && (cued as PlacedTake).folder !== undefined
  // A take open in the player, or playing in the overview: either way Space
  // is its, and Escape puts it away before it finishes anything.
  const inHand = selected !== null || cued !== null
  const cropping = useRunning(
    "crop",
    (e) => e.folder === session.folder && e.take_number === selected?.take_number
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Take | null>(null)
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
  // The song the next take is named for, as Python has it: the card under
  // the field is about it. A name with a go is a song's; "Take N" has none.
  const nextSong = session.next_take_go != null ? session.next_take_name : null
  // Both are the song's title as the library keeps it: Python has matched a
  // name typed in other capitals to its song already.
  const nextPlayedTonight =
    nextSong !== null && (session.songs ?? []).some((s) => s.name === nextSong)
  const knownGoRef = useRef(knownGo)
  useEffect(() => {
    knownGoRef.current = knownGo
  }, [knownGo])

  const nameNextTake = (name: string) => {
    // The name it would have anyway goes as "", so it goes on following
    // the takes when one is renamed or deleted — and what the field keeps
    // is the fallback's own spelling, not a case-only variant typed over it.
    const sent = name.toLocaleLowerCase() === fallback.toLocaleLowerCase() ? "" : name
    setPicked({ against: session.next_take_name, name: sent === "" ? fallback : name })
    naming.current = naming.current.then(async () => {
      try {
        const res = await api().set_next_take_name(sent)
        if (res.ok) {
          setError(null)
        } else {
          setError(res.error ?? "Could not name the next take")
          // Python never took it: the field goes back to the name it has.
          setPicked(null)
        }
      } catch {
        setError("Could not name the next take")
        setPicked(null)
      }
      onChanged()
    })
  }

  const startTake = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    player.pause()
    await naming.current
    const res = await api().start_take()
    setBusy(false)
    if (!res.ok || res.take_number == null) {
      setError(res.error ?? "Could not start the take")
      return
    }
    const name = nextNameRef.current
    const known = knownGoRef.current
    onStartTake(res.take_number, name, known !== undefined ? known : goFor(name, nextChoices))
  }

  // With a take in hand, Space plays it back rather than starting a new one;
  // Escape below is what points Space at recording again.
  useSpacebar(inHand ? player.toggle : startTake, !busy)
  usePlayerKeys(player.skip, inHand)
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

  // An earlier go is the card's song's: another song picked under the field
  // puts it away. A refresh that leaves the song as it was does not.
  const beforeSong = session.before_tonight?.song ?? null
  useEffect(() => {
    if (cuedEarlier) uncue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beforeSong])

  const finish = async () => {
    player.pause()
    const res = await api().finish_rehearsal()
    if (!res.ok) {
      setError(res.error ?? "Could not finish the rehearsal")
      return
    }
    onFinished()
  }

  const deleteTake = async (take: Take) => {
    player.pause()
    const res = await api().delete_take(session.folder, take.take_number)
    if (!res.ok) {
      setError(res.error ?? "Could not delete the take")
      return
    }
    forget(take)
    onChanged()
  }

  const renameTake = async (take: Take, name: string) => {
    const res = await api().rename_take(session.folder, take.take_number, name)
    if (!res.ok) {
      setError(res.error ?? "Could not rename the take")
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
    setError(null)
    dismiss("rehearsal")
    player.pause()
    const res = await watching(api().crop_take(session.folder, take.take_number, from, to))
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    if (res.take) reselect(res.take)
    onChanged()
    // The crop itself went through — only the sweep of the original is what
    // failed — so this adds to the success path rather than standing in for it.
    if (res.error) {
      notify({
        key: "rehearsal",
        kind: "warning",
        text: croppedButNotSwept(res.error, res.location),
      })
    }
  }

  const renameRehearsal = async (name: string) => {
    const res = await api().rename_rehearsal(session.folder, name)
    if (!res.ok) {
      setError(res.error ?? "Could not rename the rehearsal")
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

  return (
    <Shell
      playback
      subtitle="Rehearsal"
      title={
        <span className="inline-flex items-center gap-2">
          {session.name}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename rehearsal"
            onClick={() => setRenamingRehearsal(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil />
          </Button>
        </span>
      }
      facts={
        <EveningFacts
          takes={session.takes}
          bytes={session.disk_bytes ?? null}
          folder={session.folder}
        />
      }
      // The next take's name and its songs sit with what the song went
      // like before tonight, in a panel of their own on the setup screen's
      // panel colour (issue #12 step 6).
      aside={
        <aside
          aria-label="Next take"
          data-next-take-panel
          className="flex w-[22.5rem] shrink-0 flex-col gap-5 overflow-y-auto border-l bg-panel px-5 py-6 min-[1100px]:w-[26rem]"
        >
          <TakeNameField
            id="next-take-name"
            label="Next take"
            value={nextName}
            fallback={fallback}
            choices={nextChoices}
            knownGo={knownGo}
            onCommit={nameNextTake}
            onPanel
          />
          {/* Hidden while a take is open: the one player is its. */}
          <BeforeTonightCard
            key={session.before_tonight?.song ?? nextSong ?? ""}
            hidden={selected !== null}
            before={session.before_tonight ?? null}
            song={nextSong}
            playedTonight={nextPlayedTonight}
            playback={
              cuedEarlier
                ? {
                    take: cued as PlacedTake,
                    playing: player.playing,
                    loading: player.loading,
                    position: player.position,
                    duration: player.duration,
                  }
                : null
            }
            problem={cuedEarlier ? player.loadError : null}
            onPlay={playInOverview}
            onPlayAt={(take, at) => cueAt(take, Math.max(0, at - 3))}
          />
        </aside>
      }
      footer={
        <FooterRow error={error}>
          <div className="flex items-center gap-3">
            {/* Escape finishes only with no take in hand; with one, it puts
                the take away — see useEscape above. */}
            <Button
              variant="outline"
              size="lg"
              onClick={finish}
              aria-keyshortcuts={inHand ? undefined : "Escape"}
            >
              Finish
              {!inHand && <Kbd>Esc</Kbd>}
            </Button>
            <Button
              size="xl"
              variant="destructive"
              onClick={startTake}
              disabled={busy}
              aria-keyshortcuts={inHand ? undefined : "Space"}
            >
              <Circle className="fill-current" />
              Record take {session.next_take_number}
              {/* With a take in hand Space plays it, and the key is on Play. */}
              {!inHand && <Kbd>Space</Kbd>}
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
          onDelete={setToDelete}
          onStar={starTake}
          cloudStates={session.cloud_queue}
          emptyHint="Hit Record or press Space — takes show up here and can be played straight away."
        />
        )}

        {selected ? (
          <TakePlayer
            player={player}
            markers={liveTake(session.takes, selected)?.markers ?? []}
            onAddMarker={(sec) => addMarker(selected, sec)}
            onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
            onRemoveMarker={(sec) => removeMarker(selected, sec)}
            onCrop={(from, to) => void cropTake(selected, from, to)}
            canCrop={!busy}
            status={<RunningLine entry={cropping} label="Cropping" />}
            spaceKey
            goKeys
          />
        ) : (
          session.takes.length > 0 && (
            <RehearsalOverview
              takes={session.takes}
              songs={session.songs ?? []}
              playback={
                cued && !cuedEarlier
                  ? {
                      take: cued.take_number,
                      playing: player.playing,
                      loading: player.loading,
                      position: player.position,
                      duration: player.duration,
                    }
                  : null
              }
              onPlay={playInOverview}
              onOpen={select}
              onOpenAt={openAt}
              onRename={setToRename}
              onStar={starTake}
              onShare={setToShare}
              onDelete={setToDelete}
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
        description={`${takesLabel(
          session.takes.length
        )} are saved and stay where they are. You cannot add to this rehearsal afterwards — a later one starts its own folder.`}
        confirmLabel="Finish"
        cancelLabel="Keep going"
        destructive={false}
        onConfirm={() => void finish()}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete “${toDelete?.name ?? ""}”?`}
        description={`The take and all its tracks ${goPlural()}.${takeCloudToo(
          toDelete
        )} ${canBePutBack()}`}
        onConfirm={() => {
          if (toDelete) void deleteTake(toDelete)
          setToDelete(null)
        }}
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
