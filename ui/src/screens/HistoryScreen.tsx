import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { FolderOpen, Library, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Shell, EmptyState } from "@/components/Shell"
import { RehearsalList } from "@/components/RehearsalList"
import { TakeStrip, liveTake } from "@/components/TakeStrip"
import { EveningFacts } from "@/components/EveningFacts"
import { RehearsalOverview } from "@/components/RehearsalOverview"
import { EveningActions } from "@/components/EveningActions"
import { HistorySwitch } from "@/components/HistorySwitch"
import { SongList } from "@/components/SongList"
import { SongPage } from "@/components/SongPage"
import { LabelList } from "@/components/LabelList"
import { MarksPage } from "@/components/MarksPage"
import { RunningLine } from "@/components/RunningLine"
import { TakePlayer } from "@/components/TakePlayer"
import { ConfirmDialog, PromptDialog, RenameTakeDialog } from "@/components/ConfirmDialog"
import { ShareDialog } from "@/components/ShareDialog"
import { MarkerDialog } from "@/components/MarkerDialog"
import { useSongChoices } from "@/hooks/useSongChoices"
import { useEveningSettings } from "@/hooks/useEveningSettings"
import { useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { goesByTime } from "@/lib/songTabs"
import { useEscape, useKey, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  type HistoryView,
  type MarkHit,
  type Marker,
  type MarksGrouping,
  type RehearsalDetail,
  type RehearsalSummary,
  type SongDetail,
  type SongIndex,
  type Take,
} from "@/lib/api"
import {
  croppedButNotSwept,
  formatBytes,
  formatDateHuman,
  formatDay,
  formatDuration,
  formatWhen,
  takesLabel,
} from "@/lib/format"
import {
  canBePutBack,
  goPlural,
  goesTo,
  rehearsalCloudToo,
  takeCloudToo,
} from "@/lib/deletion"
import { useActivity, useCloudSettled, useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"
import { loadLabels, useLabels } from "@/lib/labels"
import { markKey, playFrom } from "@/lib/marks"
import {
  byPlace,
  firstOpen,
  inSongOrder,
  placed,
  rungsOf,
  songRefFor,
  type PlacedTake,
  type SongRef,
} from "@/lib/songs"

/** "9 takes, 1.2 GB" — what deleting a rehearsal takes away and gives back. */
function takesAndSize(r: RehearsalSummary | null): string {
  if (!r) return takesLabel(0)
  return `${takesLabel(r.take_count)}, ${formatBytes(r.disk_bytes)}`
}

/** "5 rehearsals · 2 h 24 min played · 5.0 GB", over the whole list. */
function allOf(rehearsals: RehearsalSummary[]): string {
  const seconds = rehearsals.reduce((sum, r) => sum + r.total_duration_sec, 0)
  const bytes = rehearsals.reduce((sum, r) => sum + r.disk_bytes, 0)
  const parts = [
    rehearsals.length === 1 ? "1 rehearsal" : `${rehearsals.length} rehearsals`,
  ]
  if (seconds >= 30) parts.push(`${formatDuration(seconds / 60)} played`)
  parts.push(formatBytes(bytes))
  return parts.join(" · ")
}

// What an action here said — one slot, so each says over the last.
const SAID = "history"

/**
 * History: past rehearsals and their takes. Read from disk, so it survives a
 * restart of the app.
 *
 * The list and the rehearsal chosen in it are on screen together: the list
 * down the left, the chosen one's overview beside it, with ↑ and ↓ to go
 * through them. It used to be a list that opened a rehearsal in its place,
 * so looking for the evening that had the good Vesna meant opening them one
 * after another. A take opened from the overview has the whole window, as
 * the player needs it, and Escape brings the list back.
 *
 * `initialFolder` is the rehearsal to show first, when the setup screen sent
 * somebody here for one; otherwise it is the newest. `initialSong` is a song
 * to show first, by its title, in the Songs view; null is Not named.
 */
export function HistoryScreen({
  onBack,
  initialFolder,
  initialSong,
}: {
  onBack: () => void
  initialFolder?: string
  initialSong?: string | null
}) {
  const [rehearsals, setRehearsals] = useState<RehearsalSummary[] | null>(null)
  const [current, setCurrent] = useState<string | null>(initialFolder ?? null)
  const [opened, setOpened] = useState<RehearsalDetail | null>(null)
  // The rehearsal of a go opened from a song's page, for the player.
  const [goRehearsal, setGoRehearsal] = useState<RehearsalDetail | null>(null)
  // Something slow enough to click twice by mistake is running. So far that
  // is only a crop, which rewrites every track of the take.
  const [busy, setBusy] = useState(false)
  // Every take here is held with its rehearsal's folder: what an action on
  // it acts on is the take's rehearsal, not whichever is chosen in the list.
  const [takeToDelete, setTakeToDelete] = useState<PlacedTake | null>(null)
  const [takeToRename, setTakeToRename] = useState<PlacedTake | null>(null)
  const renameChoices = useSongChoices(
    takeToRename !== null,
    takeToRename?.folder,
    takeToRename?.take_number
  )
  const [takeToShare, setTakeToShare] = useState<PlacedTake | null>(null)
  const [markerEdit, setMarkerEdit] = useState<{
    take: PlacedTake
    marker: Marker
  } | null>(null)
  const [rehearsalToDelete, setRehearsalToDelete] =
    useState<RehearsalSummary | null>(null)
  const [rehearsalToRename, setRehearsalToRename] =
    useState<RehearsalSummary | null>(null)
  const [rehearsalToForget, setRehearsalToForget] =
    useState<RehearsalSummary | null>(null)
  const {
    selected,
    cued,
    expanded,
    setExpanded,
    select,
    close,
    uncue,
    reselect,
    forget,
    openAt,
    move,
    playInOverview,
    cueAt,
    player,
  } = useTakeStripPlayer<PlacedTake>(byPlace)
  const evening = useEveningSettings()
  // This rehearsal's takes on their way to the cloud folder: Send starred
  // does not count them again.
  const { entries } = useActivity()
  const cloudWaiting = Object.fromEntries(
    entries
      .filter(
        (e) =>
          e.kind === "cloud" &&
          (e.state === "waiting" || e.state === "running") &&
          e.folder === opened?.folder &&
          e.take_number !== null
      )
      .map((e) => [e.take_number as number, e.state])
  )
  // Said in the rows as on the rehearsal screen: "Waiting for the cloud".
  const cloudStates = Object.fromEntries(
    Object.entries(cloudWaiting).map(([n, state]) => [
      n,
      state === "running" ? ("working" as const) : ("queued" as const),
    ])
  )
  const cropping = useRunning(
    "crop",
    (e) => e.folder === selected?.folder && e.take_number === selected?.take_number
  )

  // The Songs view: every song, the one chosen, and its page. A song chosen
  // stays chosen across the switch, as the rehearsal chosen does.
  const [songIndex, setSongIndex] = useState<SongIndex | null>(null)
  const [song, setSong] = useState<SongRef | null>(null)
  const [songPage, setSongPage] = useState<SongDetail | null>(null)
  // Each reading of the list, counted: the page is read again with it, as a
  // change to a take changes both.
  const [songsRead, setSongsRead] = useState(0)
  const songsShown = useRef(false)
  const songsBefore = useRef<SongIndex | null>(null)
  // As with a song's page, an answer that comes back after one asked for
  // later is older news: it still names the songs for whoever asked, but is
  // not shown.
  const askedSongs = useRef(0)
  const loadSongs = async () => {
    songsShown.current = true
    const ticket = ++askedSongs.current
    const index = await api().list_songs()
    if (ticket !== askedSongs.current) return index
    // A song chosen that is no longer there — its last go deleted, or
    // renamed to another song — gives way to the one after it in the list,
    // or before it when it was the last, as a rehearsal deleted does.
    const was = songsBefore.current ? inSongOrder(songsBefore.current) : []
    const now = inSongOrder(index)
    songsBefore.current = index
    setSong((s) => {
      if (s === null || now.includes(s)) return s
      const at = was.indexOf(s)
      const after = was.slice(at + 1).find((r) => now.includes(r))
      const before = was.slice(0, Math.max(at, 0)).reverse().find((r) => now.includes(r))
      return after ?? before ?? null
    })
    setSongIndex(index)
    setSongsRead((n) => n + 1)
    return index
  }

  // The Marks view: the labels down the left, the one chosen (kept across
  // the switch, as the song chosen is), and its marks on the right, grouped
  // as the band last chose.
  const labels = useLabels()
  const [label, setLabel] = useState<number | null>(null)
  const [grouping, setGrouping] = useState<MarksGrouping>("rehearsal")
  const [marks, setMarks] = useState<{ label: number; marks: MarkHit[] } | null>(null)
  const [marksRead, setMarksRead] = useState(0)
  const marksShown = useRef(false)
  // The mark whose ▶ was pressed last: its row shows its take playing.
  const [playingMark, setPlayingMark] = useState<MarkHit | null>(null)
  /** The labels' counts and the chosen label's marks, read again: on
   *  coming to the view, and after anything here changed a take. */
  const loadMarks = () => {
    marksShown.current = true
    void loadLabels()
    setMarksRead((n) => n + 1)
  }

  /**
   * Reads the list again, and keeps the chosen rehearsal chosen — or `want`,
   * after a rename moved it or a delete took it away. One no longer there
   * gives way to the newest.
   */
  const refresh = async (want?: string | null) => {
    const list = await api().list_rehearsals()
    setRehearsals(list)
    setCurrent((c) => {
      const pick = want !== undefined ? want : c
      return pick && list.some((r) => r.folder === pick) ? pick : (list[0]?.folder ?? null)
    })
    // A rehearsal renamed, deleted or found again changes the songs too,
    // and the marks.
    if (songsShown.current) void loadSongs()
    if (marksShown.current) loadMarks()
    return list
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Which view History is on: the one used last, as Python kept it. Until
  // it has said, neither is drawn — the Rehearsals view flashing up before
  // the Songs view would be a screen that changes under the mouse.
  const [view, setView] = useState<HistoryView | null>(null)
  // Read once, when History opens: what it was sent here for.
  const sentFor = useRef(initialSong)
  const sentForRehearsal = useRef(initialFolder !== undefined)
  useEffect(() => {
    void (async () => {
      // Sent here for a rehearsal: the Rehearsals view, whatever was used
      // last, or the rehearsal asked for would not be on screen.
      if (sentForRehearsal.current) {
        setView("rehearsals")
        void api().save_history_view("rehearsals")
        return
      }
      // Sent here for a song: the Songs view, at that song.
      if (sentFor.current !== undefined) {
        const index = await loadSongs()
        setSong(songRefFor(index, sentFor.current))
        setView("songs")
        void api().save_history_view("songs")
        return
      }
      try {
        const saved = await api().get_settings()
        const first =
          saved.history_view === "songs" || saved.history_view === "marks"
            ? saved.history_view
            : "rehearsals"
        setView(first)
        if (first === "songs") void loadSongs()
        if (first === "marks") loadMarks()
      } catch {
        setView("rehearsals")
      }
    })()
  }, [])
  // How the Marks view groups, as Python kept it, whichever view is first.
  useEffect(() => {
    void (async () => {
      try {
        const saved = await api().get_settings()
        if (saved.marks_grouping) setGrouping(saved.marks_grouping)
      } catch {
        // By rehearsal, then; the bridge has said what failed.
      }
    })()
  }, [])
  const showView = (next: HistoryView) => {
    setView(next)
    void api().save_history_view(next)
    if (next === "songs" && !songsShown.current) void loadSongs()
    // Fresh counts each time: marks made in the player since are in them.
    if (next === "marks") loadMarks()
  }

  const songOrder = songIndex ? inSongOrder(songIndex) : []
  const chosenSong: SongRef | null =
    song !== null && songOrder.includes(song) ? song : (songOrder[0] ?? null)

  // The chosen song's page. As with rehearsals, an answer about a song
  // chosen before is dropped.
  const askedSong = useRef(0)
  useEffect(() => {
    const ticket = ++askedSong.current
    if (view !== "songs" || chosenSong === null) return
    void (async () => {
      const res = await api().get_song(chosenSong === "not_named" ? null : chosenSong)
      if (ticket !== askedSong.current) return
      if (!res.ok) {
        notify({ key: SAID, kind: "error", text: res.error ?? "Could not open the song" })
        return
      }
      setSongPage(res)
    })()
  }, [view, chosenSong, songsRead])
  const pageShown =
    songPage !== null &&
    chosenSong !== null &&
    songPage.id === (chosenSong === "not_named" ? null : chosenSong)
      ? songPage
      : null

  // The rungs open on each song's page, for as long as History is open. A
  // song not seen yet has its newest rehearsal on disk open.
  const [openRungs, setOpenRungs] = useState<Map<SongRef, Set<string>>>(new Map())
  const firstRung = pageShown ? firstOpen(rungsOf(pageShown.goes ?? [])) : null
  const rungsOpen: ReadonlySet<string> =
    (chosenSong !== null ? openRungs.get(chosenSong) : undefined) ??
    new Set(firstRung ? [firstRung] : [])
  const toggleRung = (folder: string) => {
    if (chosenSong === null) return
    const next = new Set(rungsOpen)
    if (next.has(folder)) next.delete(folder)
    else next.add(folder)
    setOpenRungs((m) => new Map(m).set(chosenSong, next))
  }

  // The label chosen, or the first when none is or it was deleted.
  const chosenLabel = labels.find((l) => l.id === label)?.id ?? labels[0]?.id ?? null
  const labelShown = labels.find((l) => l.id === chosenLabel) ?? null
  // Its marks. As with a song's page, an answer about a label chosen before
  // is dropped.
  const askedMarks = useRef(0)
  useEffect(() => {
    const ticket = ++askedMarks.current
    if (view !== "marks" || chosenLabel === null) return
    void (async () => {
      const res = await api().list_marks(chosenLabel)
      if (ticket !== askedMarks.current) return
      if (!res.ok) {
        notify({ key: SAID, kind: "error", text: res.error ?? "Could not read the marks" })
        return
      }
      setMarks({ label: chosenLabel, marks: res.marks ?? [] })
    })()
  }, [view, chosenLabel, marksRead])
  const marksOnShow = marks !== null && marks.label === chosenLabel ? marks.marks : null

  const summary = rehearsals?.find((r) => r.folder === current) ?? null
  // Whether the chosen one can be read: not until the list says it is there.
  const readable = summary !== null && !summary.missing

  // The chosen rehearsal, read in full. An answer that comes back after
  // another was chosen — ↓ held down the list — is dropped. One that cannot
  // be read is not asked for; what is on screen goes by `current`, so an
  // answer about another rehearsal is never shown under this one's name.
  const asked = useRef(0)
  useEffect(() => {
    const ticket = ++asked.current
    if (!current || !readable) return
    void (async () => {
      const res = await api().get_rehearsal(current)
      if (ticket !== asked.current) return
      if (!res.ok) {
        setOpened(null)
        notify({ key: SAID, kind: "error", text: res.error ?? "Could not open the rehearsal" })
        return
      }
      dismiss(SAID)
      setOpened(res)
    })()
  }, [current, readable])

  // Read again after a change to it, unless another has been chosen since.
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  const reopen = async (folder: string) => {
    const fresh = await api().get_rehearsal(folder)
    if (!fresh.ok) return
    if (folder === currentRef.current) setOpened(fresh)
    setGoRehearsal((g) => (g && g.folder === folder ? fresh : g))
  }

  /** After a take of `folder` changed: its rehearsal read again, and the
   *  list, whose counts and strips may have moved. */
  const changed = async (folder: string) => {
    await reopen(folder)
    void refresh()
  }

  // The chosen one in the list stays in view as ↑ and ↓ go past the edge.
  useEffect(() => {
    if (!current) return
    const item = document.querySelector(`[data-rehearsal="${CSS.escape(current)}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [current])

  useEffect(() => {
    if (view !== "songs" || chosenSong === null) return
    const item = document.querySelector(`[data-song-ref="${chosenSong}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [view, chosenSong])

  useEffect(() => {
    if (view !== "marks" || chosenLabel === null) return
    const item = document.querySelector(`[data-label="${chosenLabel}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [view, chosenLabel])

  /** Another rehearsal, from the list. What was playing stops: it belongs
   *  to the one being left. */
  const choose = (folder: string) => {
    if (folder === current) return
    close()
    setOpened(null)
    setCurrent(folder)
  }

  // A go opened from a song's page, or a mark's take from the Marks view:
  // the player has its rehearsal's takes, whichever rehearsal Rehearsals has
  // chosen, and Escape comes back to the page scrolled where it was. "keep"
  // is another go at the song from inside the player, in another rehearsal:
  // it opens at the same place, and the page's scroll, kept when the player
  // was opened, is left as it is. The take opened is as its rehearsal reads
  // now: a mark's row has only what it shows of it.
  //
  // A go is opened once its rehearsal has been read, and only if nothing
  // else was picked meanwhile: another go, another tab, or Escape back to
  // the page. Each of those changes what is selected, and so turns the
  // ticket.
  const pane = useRef<HTMLElement | null>(null)
  const paneScroll = useRef<number | null>(null)
  const going = useRef(0)
  useEffect(() => {
    going.current++
  }, [selected])
  const openGo = async (take: { folder: string; take_number: number }, at?: number | "keep") => {
    const scrolled = pane.current?.scrollTop ?? 0
    const ticket = ++going.current
    const res = await api().get_rehearsal(take.folder)
    if (ticket !== going.current) return
    const fresh = res.ok ? res.takes.find((t) => t.take_number === take.take_number) : undefined
    if (!fresh) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not open the take" })
      return
    }
    const go = placed(take.folder, fresh)
    setGoRehearsal(res)
    if (at === "keep") {
      move(go)
      return
    }
    paneScroll.current = scrolled
    if (at === undefined) select(go)
    else openAt(go, at)
  }
  useLayoutEffect(() => {
    if (selected !== null || paneScroll.current === null || !pane.current) return
    pane.current.scrollTop = paneScroll.current
    paneScroll.current = null
  }, [selected])

  /** ▶ on a mark: its take plays here from just before the mark, or, when
   *  it is the mark playing, pauses. Its rehearsal is read for the take,
   *  and an answer that comes back after another ▶ is dropped. */
  const cueing = useRef(0)
  const playMark = async (m: MarkHit) => {
    const ticket = ++cueing.current
    if (
      playingMark &&
      markKey(playingMark) === markKey(m) &&
      cued?.folder === m.folder &&
      cued.take_number === m.take_number
    ) {
      player.toggle()
      return
    }
    const res = await api().get_rehearsal(m.folder)
    if (ticket !== cueing.current) return
    const take = res.ok ? res.takes.find((t) => t.take_number === m.take_number) : undefined
    if (!take) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not play the take" })
      return
    }
    setPlayingMark(m)
    cueAt(placed(m.folder, take), playFrom(m.at))
  }

  /** Another label, from the list. What was playing stops, as it does for
   *  another song. */
  const chooseLabel = (id: number) => {
    if (id === chosenLabel) return
    close()
    setLabel(id)
  }

  const chooseGrouping = (next: MarksGrouping) => {
    setGrouping(next)
    void api().save_marks_grouping(next)
  }

  /** A song's page, from a rehearsal's overview. The rehearsal stays
   *  chosen, for when the Rehearsals view is back. */
  const openSong = async (title: string | null) => {
    const index = await loadSongs()
    const ref = songRefFor(index, title)
    if (ref !== null) setSong(ref)
    setView("songs")
    void api().save_history_view("songs")
  }

  /** A rehearsal from a song's page, in the Rehearsals view. */
  const openRehearsal = (folder: string) => {
    showView("rehearsals")
    choose(folder)
  }

  /** Another song, from the list. What was playing stops, as it does for
   *  another rehearsal. */
  const chooseSong = (ref: SongRef) => {
    if (ref === chosenSong) return
    close()
    setSong(ref)
  }

  const step = (delta: number) => {
    if (view === "marks") {
      if (!labels.length) return
      const at = labels.findIndex((l) => l.id === chosenLabel)
      chooseLabel(labels[Math.min(labels.length - 1, Math.max(0, at + delta))].id)
      return
    }
    if (view === "songs") {
      if (!songOrder.length) return
      const at = chosenSong === null ? 0 : songOrder.indexOf(chosenSong)
      chooseSong(songOrder[Math.min(songOrder.length - 1, Math.max(0, at + delta))])
      return
    }
    if (!rehearsals?.length) return
    const at = rehearsals.findIndex((r) => r.folder === current)
    const next = rehearsals[Math.min(rehearsals.length - 1, Math.max(0, at + delta))]
    if (next) choose(next.folder)
  }
  useKey("ArrowUp", () => step(-1), selected === null)
  useKey("ArrowDown", () => step(1), selected === null)

  // A copy to the cloud started here runs in the background now; when one of
  // this rehearsal's finishes, its take says so without anyone reopening it —
  // a go's from a song's page as much as the one chosen in Rehearsals.
  useCloudSettled((e) => {
    if (opened && e.folder === opened.folder) void reopen(opened.folder)
    else if (goRehearsal && e.folder === goRehearsal.folder) void reopen(goRehearsal.folder)
    if (view === "songs" && pageShown?.goes?.some((g) => g.folder === e.folder)) void loadSongs()
  })

  // A take playing in the overview has the keys as much as an open one.
  const inHand = selected !== null || cued !== null
  useSpacebar(player.toggle, inHand)
  usePlayerKeys(player.skip, inHand)

  const back = () => {
    if (selected) {
      select(null)
      return
    }
    player.pause()
    onBack()
  }
  // Escape peels one layer at a time: the strip's columns, the open take,
  // then a take playing in the overview, then history itself — the same
  // ladder the back button climbs, one rung per press.
  useEscape(() =>
    selected && expanded
      ? setExpanded(false)
      : selected
        ? select(null)
        : cued
          ? uncue()
          : back()
  )

  const deleteTake = async (take: PlacedTake) => {
    dismiss(SAID)
    player.pause()
    const res = await api().delete_take(take.folder, take.take_number)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not delete the take" })
      return
    }
    forget(take)
    await changed(take.folder)
  }

  const renameTake = async (take: PlacedTake, name: string) => {
    dismiss(SAID)
    const res = await api().rename_take(take.folder, take.take_number, name)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not rename the take" })
      return
    }
    // The take folder moved with the name, so point the player at the fresh
    // paths. That is a new `tracks` identity, so the open effect underneath
    // tears down and reopens from zero — the take stays selected and on
    // screen, but playback and the A–B region do not survive this.
    if (res.take) reselect(placed(take.folder, res.take))
    await changed(take.folder)
  }

  // Python let go of the files before rewriting them, so the take has to be
  // opened again; the fresh `tracks` array is what tells the player that.
  // Rewriting eight long tracks takes real seconds, so the screen is busy
  // while it runs: a second Crop would cut the take the first one made.
  const cropTake = async (take: PlacedTake, from: number, to: number) => {
    if (busy) return
    setBusy(true)
    dismiss(SAID)
    player.pause()
    const res = await watching(api().crop_take(take.folder, take.take_number, from, to))
    setBusy(false)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not crop the take" })
      return
    }
    if (res.take) reselect(placed(take.folder, res.take))
    await changed(take.folder)
    // The crop itself went through — only the sweep of the original is what
    // failed — so this adds to the success path rather than standing in for it.
    if (res.error) {
      notify({
        key: SAID,
        kind: "warning",
        text: croppedButNotSwept(res.error, res.location),
      })
    }
  }

  // Renaming moves the folder, so the chosen one follows it to its new path,
  // and is read again from there.
  const renameRehearsal = async (folder: string, name: string) => {
    dismiss(SAID)
    const res = await api().rename_rehearsal(folder, name)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not rename the rehearsal" })
      return
    }
    const held = selected ?? cued
    if (held && held.folder === folder && res.takes) {
      const fresh = res.takes.find((t) => t.take_number === held.take_number)
      // The take's rehearsal is now where the rename moved it.
      if (fresh) reselect(placed(res.folder ?? folder, fresh), held)
    }
    await refresh(folder === current ? (res.folder ?? folder) : undefined)
  }

  // The one after it takes its place on the right, or the one before when it
  // was the last.
  const neighbourOf = (folder: string): string | null => {
    const list = rehearsals ?? []
    const at = list.findIndex((r) => r.folder === folder)
    const rest = list.filter((r) => r.folder !== folder)
    return rest[Math.min(Math.max(at, 0), rest.length - 1)]?.folder ?? null
  }

  const deleteRehearsal = async (r: RehearsalSummary) => {
    dismiss(SAID)
    player.pause()
    const next = neighbourOf(r.folder)
    const res = await api().delete_rehearsal(r.folder)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not delete the rehearsal" })
      return
    }
    if (r.folder === current) close()
    await refresh(r.folder === current ? next : undefined)
  }

  // For a rehearsal whose folder went missing: point it at where the folder
  // is now, or, if it was really deleted, drop it from history and leave
  // whatever is on disk — there is nothing here to delete.
  const locateRehearsal = async (r: RehearsalSummary) => {
    dismiss(SAID)
    const res = await api().choose_rehearsal_folder(r.folder)
    if (res.cancelled) return
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not locate the rehearsal's folder" })
      return
    }
    await refresh(res.folder ?? r.folder)
  }

  const forgetRehearsal = async (r: RehearsalSummary) => {
    dismiss(SAID)
    const next = neighbourOf(r.folder)
    const res = await api().forget_rehearsal(r.folder)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not remove the rehearsal from history" })
      return
    }
    await refresh(r.folder === current ? next : undefined)
  }

  // Dropping a marker opens its note straight away: the thought about what
  // just went wrong lasts about five seconds. Playback carries on.
  const addMarker = async (take: PlacedTake, seconds: number) => {
    const res = await api().add_take_marker(take.folder, take.take_number, seconds)
    await reopen(take.folder)
    // A note may never be written: the mark is on the song's page anyway,
    // and in the Marks view.
    if (songsShown.current) void loadSongs()
    if (marksShown.current) loadMarks()
    const fresh = res.markers?.find((m) => Math.abs(m.at - seconds) < 0.02)
    setMarkerEdit(fresh ? { take, marker: fresh } : null)
  }

  const saveMarker = async (
    take: PlacedTake,
    at: number,
    note: string,
    labelId: number
  ) => {
    await api().update_take_marker(take.folder, take.take_number, at, note, labelId)
    await changed(take.folder)
  }

  const starTake = async (take: PlacedTake, starred: boolean) => {
    await api().set_take_star(take.folder, take.take_number, starred)
    await changed(take.folder)
  }

  const removeMarker = async (take: PlacedTake, seconds: number) => {
    await api().remove_take_marker(take.folder, take.take_number, seconds)
    await changed(take.folder)
  }

  const takeDialogs = (
    <>
      <ConfirmDialog
        open={takeToDelete !== null}
        onOpenChange={(open) => !open && setTakeToDelete(null)}
        title={`Delete “${takeToDelete?.name ?? ""}”?`}
        description={`The take and all its tracks ${goPlural()}.${takeCloudToo(
          takeToDelete
        )} ${canBePutBack()}`}
        onConfirm={() => {
          if (takeToDelete) void deleteTake(takeToDelete)
          setTakeToDelete(null)
        }}
      />

      <RenameTakeDialog
        take={takeToRename}
        choices={renameChoices}
        onOpenChange={(open) => !open && setTakeToRename(null)}
        onSubmit={(name) => {
          if (takeToRename) void renameTake(takeToRename, name)
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
        take={takeToShare}
        folder={takeToShare?.folder ?? ""}
        onOpenChange={(open) => !open && setTakeToShare(null)}
        onDone={() => {
          if (takeToShare) void reopen(takeToShare.folder)
          if (songsShown.current) void loadSongs()
          if (marksShown.current) loadMarks()
        }}
      />
    </>
  )

  // A take open in the player: the whole window, the way it always had it.
  // Its rehearsal is the one chosen in Rehearsals, or a go's from a song.
  const inPlayer =
    selected === null
      ? null
      : opened?.folder === selected.folder
        ? opened
        : goRehearsal?.folder === selected.folder
          ? goRehearsal
          : null
  if (inPlayer && selected) {
    const opened = inPlayer
    // What the strip and its buttons hand on is a take of this rehearsal.
    const here = (take: Take) => placed(opened.folder, take)
    // Opened from a song's page, the song's goes are every go at it, by
    // time; another song picked on the strip has this evening's.
    const playedSong = liveTake(opened.takes, selected)?.song
    const across =
      view === "songs" && pageShown && playedSong && pageShown.title === playedSong
        ? goesByTime(pageShown.goes ?? [])
        : undefined
    return (
      <Shell
        playback
        subtitle={formatDateHuman(opened.created_at)}
        title={opened.name}
        onBack={back}
        facts={
          <EveningFacts
            takes={opened.takes}
            bytes={rehearsals?.find((r) => r.folder === opened.folder)?.disk_bytes ?? null}
            folder={opened.folder}
          />
        }
      >
        <div className="flex w-full flex-col gap-4">
          <TakeStrip
            takes={opened.takes}
            selected={selected}
            folder={opened.folder}
            across={across}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onSelect={(take) => select(here(take))}
            onGo={(take, folder) =>
              folder === undefined || folder === opened.folder
                ? move(here(take))
                : void openGo(placed(folder, take), "keep")
            }
            onRename={(take) => setTakeToRename(here(take))}
            onShare={(take) => setTakeToShare(here(take))}
            onDelete={(take) => setTakeToDelete(here(take))}
            onStar={(take, starred) => void starTake(here(take), starred)}
            emptyHint="Nothing was kept from this rehearsal, or every take since got deleted."
          />
          <TakePlayer
            player={player}
            markers={liveTake(opened.takes, selected)?.markers ?? []}
            onAddMarker={(sec) => addMarker(selected, sec)}
            onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
            onRemoveMarker={(sec) => removeMarker(selected, sec)}
            onCrop={(from, to) => void cropTake(selected, from, to)}
            spaceKey
            goKeys
            canCrop={!busy}
            status={<RunningLine entry={cropping} label="Cropping" />}
          />
        </div>
        {takeDialogs}
      </Shell>
    )
  }

  const empty = rehearsals?.length === 0
  // Neither view is drawn until History knows which it is on.
  const reading = rehearsals === null || view === null
  const noSongs = songIndex !== null && songOrder.length === 0

  return (
    <Shell
      playback
      title="Rehearsal history"
      onBack={back}
      backKey
      headerAction={
        rehearsals && rehearsals.length > 0 ? (
          <span className="hidden text-xs text-muted-foreground lg:block">
            {allOf(rehearsals)}
          </span>
        ) : undefined
      }
      className={empty || reading ? undefined : "flex overflow-hidden p-0"}
    >
      {reading && <p className="text-sm text-muted-foreground">Reading the folder…</p>}

      {empty && (
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon={<Library className="size-6" />}
            title="No past rehearsals yet"
            hint="Every rehearsal where you saved at least one take shows up here."
          />
        </div>
      )}

      {rehearsals && rehearsals.length > 0 && view !== null && (
        <>
          <nav
            aria-label={view === "songs" ? "Songs" : view === "marks" ? "Labels" : "Rehearsals"}
            className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r px-3 py-4 xl:w-80"
          >
            <HistorySwitch view={view} onChange={showView} />
            {view === "songs" ? (
              songIndex && (
                <SongList index={songIndex} current={chosenSong} onChoose={chooseSong} />
              )
            ) : view === "marks" ? (
              <LabelList labels={labels} current={chosenLabel} onChoose={chooseLabel} />
            ) : (
              <RehearsalList rehearsals={rehearsals} current={current} onChoose={choose} />
            )}
            <p className="mt-auto flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground">
              <kbd className="rounded border border-current/30 px-1 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-current/30 px-1 font-mono text-[10px]">↓</kbd>
              to go through them
            </p>
          </nav>

          {view === "songs" ? (
            <section
              ref={pane}
              aria-label={pageShown ? (pageShown.title ?? "Not named") : "Song"}
              className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
            >
              {noSongs && (
                <EmptyState
                  title="No songs yet"
                  hint="A take named after a song shows up here."
                />
              )}
              {pageShown && (
                <SongPage
                  page={pageShown}
                  playback={
                    cued
                      ? {
                          take: cued,
                          playing: player.playing,
                          loading: player.loading,
                          position: player.position,
                          duration: player.duration,
                        }
                      : null
                  }
                  open={rungsOpen}
                  onToggle={toggleRung}
                  onPlay={playInOverview}
                  onOpen={(take) => void openGo(take)}
                  onOpenAt={(take, at) => void openGo(take, at)}
                  onRename={setTakeToRename}
                  onStar={(take, starred) => void starTake(take, starred)}
                  onShare={setTakeToShare}
                  onDelete={setTakeToDelete}
                  onOpenRehearsal={openRehearsal}
                />
              )}
            </section>
          ) : view === "marks" ? (
            <section
              ref={pane}
              aria-label={labelShown?.name ?? "Marks"}
              className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
            >
              {labelShown && marksOnShow && (
                <MarksPage
                  label={labelShown}
                  marks={marksOnShow}
                  grouping={grouping}
                  onGrouping={chooseGrouping}
                  playing={
                    playingMark &&
                    cued?.folder === playingMark.folder &&
                    cued.take_number === playingMark.take_number
                      ? {
                          key: markKey(playingMark),
                          playing: player.playing,
                          loading: player.loading,
                          position: player.position,
                          duration: player.duration,
                        }
                      : null
                  }
                  onPlay={(m) => void playMark(m)}
                  onOpen={(m) => {
                    // Played in the player and still going after Escape,
                    // the take shows in this row.
                    setPlayingMark(m)
                    void openGo(m, m.at)
                  }}
                  onOpenSong={(title) => void openSong(title)}
                  onOpenRehearsal={openRehearsal}
                />
              )}
            </section>
          ) : (
            <section
              aria-label={summary?.name ?? "Rehearsal"}
              className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
            >
              {summary && (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <h2 className="truncate text-xl leading-tight font-semibold">
                        {summary.name}
                      </h2>
                      {!summary.missing && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Rename rehearsal ${summary.name}`}
                          onClick={() => setRehearsalToRename(summary)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil />
                        </Button>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">
                        {formatDay(summary.created_at).split(" ")[0]}{" "}
                        {formatDateHuman(summary.created_at)}
                      </span>
                      <span aria-hidden>·</span>
                      <FolderOpen className="size-3.5 shrink-0" />
                      <span className="truncate font-mono">{summary.folder}</span>
                    </div>
                  </div>
                  {!summary.missing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete rehearsal ${summary.name}`}
                      onClick={() => setRehearsalToDelete(summary)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              )}
  
              {summary?.missing && (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-4">
                  <p className="text-sm">
                    <span className="font-medium">Not found on disk.</span>{" "}
                    <span className="text-muted-foreground">
                      Its folder was deleted, renamed outside the app, or is on a
                      drive that is not plugged in. Recorded {formatWhen(summary.created_at)}.
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void locateRehearsal(summary)}>
                      Locate folder…
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRehearsalToForget(summary)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      Remove from history
                    </Button>
                  </div>
                </div>
              )}
  
              {readable && opened?.folder === current && (
                opened.takes.length > 0 ? (
                  <RehearsalOverview
                    takes={opened.takes}
                    songs={opened.songs ?? []}
                    cloudStates={cloudStates}
                    playback={
                      // Only a take of this rehearsal plays here: take 1 of
                      // another is not this one's take 1.
                      cued && cued.folder === opened.folder
                        ? {
                            take: cued.take_number,
                            playing: player.playing,
                            loading: player.loading,
                            position: player.position,
                            duration: player.duration,
                          }
                        : null
                    }
                    onPlay={(take) => playInOverview(placed(opened.folder, take))}
                    onOpen={(take) => select(placed(opened.folder, take))}
                    onOpenAt={(take, at) => openAt(placed(opened.folder, take), at)}
                    onRename={(take) => setTakeToRename(placed(opened.folder, take))}
                    onStar={(take, starred) => void starTake(placed(opened.folder, take), starred)}
                    onShare={(take) => setTakeToShare(placed(opened.folder, take))}
                    onDelete={(take) => setTakeToDelete(placed(opened.folder, take))}
                    onOpenSong={(title) => void openSong(title)}
                    falseStartSec={evening?.falseStartSec}
                    folder={opened.folder}
                    onName={(take, title) => void renameTake(placed(opened.folder, take), title)}
                    actions={
                      evening && (
                        <EveningActions
                          folder={opened.folder}
                          takes={opened.takes}
                          falseStartSec={evening.falseStartSec}
                          cloudDir={evening.cloudDir}
                          waiting={cloudWaiting}
                          onChanged={() => void changed(opened.folder)}
                          onDeleted={(gone) =>
                            gone.forEach((t) => forget(placed(opened.folder, t)))
                          }
                        />
                      )
                    }
                  />
                ) : (
                  <EmptyState
                    title="No takes"
                    hint="Nothing was kept from this rehearsal, or every take since got deleted."
                  />
                )
              )}
            </section>
          )}
        </>
      )}

      {takeDialogs}

      <ConfirmDialog
        open={rehearsalToDelete !== null}
        onOpenChange={(open) => !open && setRehearsalToDelete(null)}
        title={`Delete “${rehearsalToDelete?.name ?? ""}”?`}
        description={`The whole folder, with all its takes (${takesAndSize(
          rehearsalToDelete
        )}), ${goesTo()}.${rehearsalCloudToo(
          rehearsalToDelete?.in_cloud,
          rehearsalToDelete?.take_count
        )} ${canBePutBack()}`}
        onConfirm={() => {
          if (rehearsalToDelete) void deleteRehearsal(rehearsalToDelete)
          setRehearsalToDelete(null)
        }}
      />

      <ConfirmDialog
        open={rehearsalToForget !== null}
        onOpenChange={(open) => !open && setRehearsalToForget(null)}
        title={`Remove “${rehearsalToForget?.name ?? ""}” from history?`}
        description="Only the entry goes — there is nothing on disk to delete. If the folder turns up again, it will not come back by itself."
        confirmLabel="Remove"
        onConfirm={() => {
          if (rehearsalToForget) void forgetRehearsal(rehearsalToForget)
          setRehearsalToForget(null)
        }}
      />

      <PromptDialog
        open={rehearsalToRename !== null}
        onOpenChange={(open) => !open && setRehearsalToRename(null)}
        title="Rename rehearsal"
        label="The folder keeps its date and gets the new name."
        initialValue={rehearsalToRename?.name ?? ""}
        onSubmit={(name) => {
          if (rehearsalToRename)
            void renameRehearsal(rehearsalToRename.folder, name)
          setRehearsalToRename(null)
        }}
      />
    </Shell>
  )
}
