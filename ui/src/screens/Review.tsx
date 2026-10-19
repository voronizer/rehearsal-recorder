import { useEffect, useRef, useState } from "react"
import { Check, Cloud, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Kbd } from "@/components/ui/kbd"
import { Whole } from "@/components/ui/whole"
import { FooterRow } from "@/components/FooterRow"
import { Shell } from "@/components/Shell"
import { RunningLine } from "@/components/RunningLine"
import { TakePlayer } from "@/components/TakePlayer"
import { SMALL_WITH_NUMBERS } from "@/components/ui/take-columns"
import { TakeFigures, TakeName } from "@/components/TakeSummary"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useEscape, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import { MarkerDialog } from "@/components/MarkerDialog"
import { useSongChoices } from "@/hooks/useSongChoices"
import {
  api,
  type Marker,
  type PendingTake,
  type ShareWhat,
  type Take,
} from "@/lib/api"
import { nameWithGo } from "@/lib/goes"
import { takeFacts } from "@/lib/takeFacts"
import { dismiss } from "@/lib/notices"
import { useKeysOn } from "@/lib/keys"
import { endedByPython, offerCropUndo } from "@/lib/trash"
import { useRunning, watching } from "@/lib/activity"
import { useLabels } from "@/lib/labels"

/**
 * Right after stopping: listen and decide the take's fate. Until it is saved
 * the files stay in the rehearsal's drafts folder.
 */
/** How the review screen names what the cloud copy of a take will be. */
const WHAT_GOES: Record<ShareWhat, string> = {
  mix: "the mix",
  tracks: "the original tracks",
  both: "the mix and the tracks",
}

/** The notice a button's failure is said in. Its own slot: "review" holds the
 *  warning of a crop whose original could not be moved, and an error in that
 *  slot would take its place. */
const ERROR = "review-error"

/** What was made of a take on this screen, which only this screen holds
 *  until it is saved: its name, its marks, and whether it goes to the
 *  cloud folder. */
export type ReviewKept = { name: string; markers: Marker[]; send: boolean }

/** A take discarded here, with what Undo needs to bring this screen back
 *  as it was left: `undo` is the removal's token, `title` the take as the
 *  screen called it. */
export type Discarded = {
  take: PendingTake
  title: string
  kept: ReviewKept
  undo: string | null
}

export function Review({
  take,
  kept,
  rehearsalName,
  takes,
  onKept,
  onDiscarded,
  onCropped,
}: {
  take: PendingTake
  /** What was made of it before it was discarded, when Undo brought it
   *  back. */
  kept?: ReviewKept
  rehearsalName: string
  /** Tonight's takes kept so far: the song's goes before this one. */
  takes: Take[]
  onKept: () => void
  onDiscarded: (gone: Discarded) => void
  onCropped: (take: PendingTake) => void
}) {
  // A new take is usually another go at the same song, so the name carries
  // over from the previous one with the counter bumped.
  const firstName = take.suggested_name ?? `Take ${take.take_number}`
  const [name, setName] = useState(kept?.name ?? firstName)
  // And when the band has moved on, the song they moved to is a click, in
  // Rename take.
  const songChoices = useSongChoices(true, null, take.take_number)
  const [busy, setBusy] = useState(false)
  // An error a button said is about this take, and goes with the screen.
  const sayError = useErrorNotice(ERROR)
  const player = useMultitrackPlayer(take.tracks, take.duration_sec)
  const cropping = useRunning("crop", (e) => e.folder === take.temp_dir)

  // Marks made here are held in memory until the take is saved: it has no
  // folder yet, so there is nowhere on disk to put them. They travel with
  // keep_take, and go away with the take if it is discarded.
  const [markers, setMarkers] = useState<Marker[]>(kept?.markers ?? [])
  const labels = useLabels()

  // Whether this take goes to the cloud folder, said before it is saved and
  // turnable for this one take: a false start kept anyway need not go up,
  // and the one good take can, with sending off. It starts from the setting
  // every time — a choice made for one take is not a new setting.
  const [cloud, setCloud] = useState<{
    dir: string | null
    auto: boolean
    what: ShareWhat
    format: string
  } | null>(null)
  const [send, setSend] = useState(kept?.send ?? false)
  const cloudBox = useRef<HTMLButtonElement>(null)
  // A take brought back by Undo keeps the answer it had.
  const keptSend = useRef(kept?.send)
  useEffect(() => {
    let alive = true
    void api()
      .get_settings()
      .then((s) => {
        if (!alive) return
        setCloud({
          dir: s.cloud_dir,
          auto: s.auto_publish,
          what: s.auto_publish_what,
          format: s.cloud_format,
        })
        setSend(keptSend.current ?? (Boolean(s.cloud_dir) && s.auto_publish))
      })
      .catch(() => {
        /* the bar has said so; the take still saves by the setting */
      })
    return () => {
      alive = false
    }
  }, [])
  const [editing, setEditing] = useState<Marker | null>(null)
  // The columns in the header have given way to the title, which then says
  // them in its tip.
  const [columnsGone, setColumnsGone] = useState(false)
  // How much of the columns' box they leave empty, which the subtitle runs
  // on into.
  const [spare, setSpare] = useState(0)

  // The take as the screen calls it, with its go, for what a notice says.
  const title = nameWithGo(name, songChoices) || take.default_name || `Take ${take.take_number}`

  const addMarker = (at: number) => {
    const rounded = Math.round(at * 100) / 100
    // Python gives the first label too, but this take has no folder yet and
    // its marks are held here until Save take.
    const fresh: Marker = { at: rounded, label_id: labels[0]?.id ?? 0, note: "" }
    setMarkers((prev) =>
      [...prev.filter((m) => Math.abs(m.at - rounded) > 0.01), fresh].sort(
        (a, b) => a.at - b.at
      )
    )
    setEditing(fresh)
  }

  const saveMarker = (at: number, note: string, labelId: number) => {
    setMarkers((prev) =>
      prev.map((m) => (Math.abs(m.at - at) <= 0.01 ? { ...m, note, label_id: labelId } : m))
    )
  }

  const removeMarker = (at: number) => {
    setMarkers((prev) => prev.filter((m) => Math.abs(m.at - at) > 0.01))
  }

  usePlayerKeys(player.skip, !busy)

  const keep = async () => {
    if (busy) return
    setBusy(true)
    dismiss(ERROR)
    player.pause()
    const res = await api().keep_take(
      take.take_number,
      take.temp_dir,
      name,
      take.duration_sec,
      take.tracks,
      markers,
      // Only an answer that differs from the setting is sent: one that
      // agrees leaves the take following the setting, even if it changes.
      cloud?.dir && send !== cloud.auto ? send : null,
      // The .mid files stop_take made, kept beside the audio.
      take.notes
    )
    setBusy(false)
    // A crop's Undo is over, as Python ended it: the draft it would put the
    // uncut take back into is a saved take now.
    endedByPython(res.ended)
    if (!res.ok) {
      sayError(res.error ?? "Could not save the take")
      return
    }
    onKept()
  }

  // Declared after keep, because that is what it runs.
  useSpacebar(keep, !busy)

  // Discarding asks nothing, from the button or from Escape: this screen is
  // a fork — save or give up — and Escape, which everywhere else means one
  // level up, has only the one way out to offer. What goes can be had back
  // with Undo, this screen with it, as it was left (App).
  const discard = async () => {
    if (busy) return
    setBusy(true)
    dismiss(ERROR)
    player.pause()
    const res = await api().discard_take(take.temp_dir)
    // A crop's Undo goes with it, as Python ended it.
    endedByPython(res.ended)
    if (!res.ok) {
      setBusy(false)
      sayError(res.error ?? "Could not discard the take")
      return
    }
    // Still busy: the take is gone, and until App has moved on, Space or
    // Escape here would act on it.
    onDiscarded({ take, title, kept: { name, markers, send }, undo: res.undo ?? null })
  }
  useEscape(() => void discard(), !busy)
  // Off in Settings › Keys, Discard and Save take have no chips.
  const spaceKeys = useKeysOn("space")

  // The markers here are held in memory — the take has no folder on disk yet —
  // so they move with the audio by hand rather than coming back from Python.
  const cropDraft = async (from: number, to: number) => {
    if (busy) return
    setBusy(true)
    dismiss(ERROR)
    dismiss("review")
    player.pause()
    // What the crop's Undo puts back: the take, and its marks, as they are.
    const before = { take, markers }
    const res = await watching(
      api().crop_draft(take.temp_dir, take.tracks, from, to, take.notes)
    )
    setBusy(false)
    // The draft's earlier crops, Python has sent on.
    endedByPython(res.ended)
    if (!res.ok) {
      sayError(res.error ?? "Could not crop the take")
      return
    }
    // Where Python cut it: a click take's region moves out to its bars.
    const start = res.start_sec ?? from
    const end = res.end_sec ?? to
    setMarkers((prev) =>
      prev
        .filter((m) => m.at >= start && m.at <= end)
        .map((m) => ({ ...m, at: Math.round((m.at - start) * 100) / 100 }))
    )
    // The notes are cut with the audio. A new list is a take opened again:
    // the player reads them afresh, as it does the old ones after an Undo.
    onCropped({
      ...take,
      tracks: res.tracks ?? take.tracks,
      notes: res.notes ?? take.notes,
      duration_sec: res.duration_sec ?? take.duration_sec,
    })
    offerCropUndo(
      title,
      res,
      () => {
        onCropped(before.take)
        setMarkers(before.markers)
      },
      "review",
      from
    )
  }

  const facts = takeFacts({
    name,
    takeNumber: take.take_number,
    durationSec: take.duration_sec,
    takes,
    choices: songChoices,
  })
  // The cloud line holds its room from the start, so nothing moves when the
  // setting answers (B4). It is one line, cut at its end where the buttons
  // leave it too little room, and whole in the shared tip.
  const cloudLine = !cloud ? (
    <p aria-hidden data-cloud-line="waiting" className="invisible flex items-center gap-2 text-sm">
      <Cloud className="size-4" />
      &nbsp;
    </p>
  ) : cloud.dir ? (
    <label
      htmlFor="send-to-cloud"
      data-cloud-line={send ? "on" : "off"}
      className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground"
    >
      <Checkbox
        ref={cloudBox}
        id="send-to-cloud"
        checked={send}
        onCheckedChange={(on) => {
          setSend(on === true)
          // Focus left on the box would give it the next Space, which on
          // this screen means Save take.
          cloudBox.current?.blur()
        }}
        disabled={busy}
      />
      <Cloud className="size-4 shrink-0" />
      <Whole
        text={`Send to the cloud: ${WHAT_GOES[cloud.what]}, ${cloud.format.toUpperCase()}`}
        className="min-w-0 truncate"
      />
    </label>
  ) : (
    <p data-cloud-line="none" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Cloud className="size-4 shrink-0" />
      <Whole text="Stays on this computer: no cloud folder is set" className="min-w-0 truncate" />
    </p>
  )

  return (
    <Shell
      playback
      // The other screens' air: 32 round the screen.
      air
      className="px-8 [--screen-pad-y:2rem]"
      // The subtitle never sizes the title's box, so only the title makes
      // the columns give way: contained, it asks for no width of its own.
      // It is as wide as the title, and runs on into the room the columns
      // leave (TakeFigures' onRoom); a long rehearsal name is cut where that
      // ends, and whole on hover.
      subtitle={
        <span className="block [contain:inline-size]">
          <Whole
            data-subtitle
            text={`Take ${take.take_number} · ${rehearsalName}`}
            className="truncate"
            style={{ width: `calc(100% + ${spare}px)` }}
          />
        </span>
      }
      titleFits
      // As tall with the columns as without: a rename that brings them or
      // takes them away moves nothing under the header (B4).
      titleLeast={SMALL_WITH_NUMBERS}
      title={
        <TakeName
          facts={facts}
          name={name}
          fallback={take.default_name ?? `Take ${take.take_number}`}
          choices={songChoices}
          onRename={setName}
          figures={columnsGone && facts.columns.length > 0 ? facts.columnsText : undefined}
        />
      }
      facts={
        facts.columns.length > 0 ? (
          <TakeFigures facts={facts} onGone={setColumnsGone} onRoom={setSpare} />
        ) : undefined
      }
      factsGone={columnsGone}
      footer={
        <FooterRow left={cloudLine}>
          <div className="flex items-center gap-3">
            {/* Escape discards, as the button does; Undo brings it back. */}
            <Button
              variant="outline"
              size="footer-aside"
              onClick={discard}
              disabled={busy}
              aria-keyshortcuts={spaceKeys ? "Escape" : undefined}
            >
              <Trash2 />
              Discard
              {spaceKeys && <Kbd aria-hidden>Esc</Kbd>}
            </Button>
            {/* The evening's main button keeps its size: Start, Record, Stop
                and Save take are all the footer's 56 px. */}
            <Button
              size="footer"
              onClick={keep}
              disabled={busy}
              aria-keyshortcuts={spaceKeys ? "Space" : undefined}
            >
              <Check />
              Save take
              {spaceKeys && <Kbd aria-hidden>Space</Kbd>}
            </Button>
          </div>
        </FooterRow>
      }
    >
      <div className="flex w-full flex-col gap-6">
        <TakePlayer
          player={player}
          take={take}
          notes={take.notes}
          notesMissing={take.notes_missing}
          markers={markers}
          onAddMarker={addMarker}
          onEditMarker={setEditing}
          onRemoveMarker={removeMarker}
          onCrop={(from, to) => void cropDraft(from, to)}
          canCrop={!busy}
          status={cropping && <RunningLine entry={cropping} label="Cropping" />}
          rising
        />
      </div>

      <MarkerDialog
        marker={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={saveMarker}
        onDelete={removeMarker}
      />
    </Shell>
  )
}
