// The pieces of the app the page shows in its window for the items the live
// app has no moment of: the app's own components, given what the screens
// would give them, from the band on the fake Python side. They are pictures
// here: still, and not for clicking.
import { Fragment, type ReactNode } from "react"
import { Metronome, Play } from "lucide-react"
import { HealthLine } from "@/components/HealthLine"
import { NoticeItem } from "@/components/Notices"
import { MetronomeSettings } from "@/components/MetronomeSettings"
import { BeatDots } from "@/components/metronome/BeatDots"
import { MasterClickLane } from "@/components/metronome/MasterClickLane"
import { MetronomeRowView } from "@/components/metronome/MetronomeRow"
import { SignatureSelect } from "@/components/metronome/SignatureSelect"
import { TapButton } from "@/components/metronome/TapButton"
import { TempoField } from "@/components/metronome/TempoField"
import { NotesLane } from "@/components/midi/NotesLane"
import { NotesPlate } from "@/components/midi/NotesPlate"
import { PanelParts, SetCard } from "@/components/NextTakeSongs"
import { RehearsalOverview } from "@/components/RehearsalOverview"
import { SongKeys } from "@/components/SongKeys"
import { TakeNameField } from "@/components/TakeNameField"
import { Button } from "@/components/ui/button"
import {
  api,
  type MetronomeState,
  type RehearsalDetail,
  type RehearsalSet,
  type RehearsalSummary,
  type Signature,
  type SongChoices,
  type SongSummary,
  type Take,
} from "@/lib/api"
import { trashName, wentTo } from "@/lib/deletion"
import { DEFAULT_TOLERANCE, spokenDrift, stretches, type TakeDrift } from "@/lib/drift"
import { formatTempo } from "@/lib/format"
import { perBar, songLine, statusLine, tapTempo } from "@/lib/metronome"
import type { Notice } from "@/lib/notices"
import { siteNotes, type SiteNotes } from "../stage/demo"

/** The pieces, each by the id of the item it is drawn for
 *  (content/story.md); other items may show one of them too. */
export type PieceId =
  | "set"
  | "tap"
  | "counted"
  | "first-take"
  | "midi"
  | "awake"
  | "unplugged"
  | "disk"
  | "marks"
  | "drift"
  | "undo"
  | "cloud"
  | "wav-tempo"

export type PieceData = {
  rehearsals: RehearsalSummary[]
  last: RehearsalDetail
  /** The songs under the Next take field, each at its next go. */
  choices: SongChoices
  /** The band's set, Gig on the 25th, for the set's piece. */
  set: RehearsalSet | null
  /** The drums' and the keys' notes for the MIDI piece (stage/notes.js). */
  notes: SiteNotes
  /** Pałyn as the library has it, with its tempo, for the metronome's row
   *  after a tap and for its tempo counted on its page. */
  song: SongSummary | null
  /** A song the library has with no tempo yet, for the row that says the
   *  first take keeps the one typed in. */
  fresh: SongSummary | null
  /** Pałyn's tempo counted from Pałyn 4, for its page after the count. */
  counted: Counted | null
  /** Pałyn 2 in the player, with the band's tempo through it, for the
   *  drift's piece. */
  master: MasterData | null
}

/** A take as the player has it after a take, and its tempo bar by bar as
 *  the player asks for it (take_drift); `at`, the playhead, and `to`, where
 *  the view ends. */
type MasterData = { take: Take; drift: TakeDrift; at: number; to: number }

/** A tempo counted from a take, by the take's name, in the signature it was
 *  counted in (count_tempo). */
type Counted = { take: string; tempo: number; signature: Signature }

/** What the pieces show, asked of the bridge as the history screen and the
 *  rehearsal screen would. */
export async function loadPieces(): Promise<PieceData> {
  const rehearsals = await api().list_rehearsals()
  const last = await api().get_rehearsal(rehearsals[0].folder)
  // As at the band's next rehearsal: each song at one past its last go in
  // the newest one, as Python counts goes across the library (the fake
  // counts them from 1 each evening).
  const offered = await api().song_choices()
  const next = (song: string) =>
    Math.max(0, ...last.takes.filter((t) => t.song === song).map((t) => t.go ?? 0)) + 1
  const choices = { here: [], other: offered.other.map((c) => ({ ...c, go: next(c.song) })) }
  const [set] = await api().list_sets()
  const { songs } = await api().list_songs()
  const song = songs.find((s) => s.title === "Pałyn") ?? null
  const fresh = songs.find((s) => s.tempo == null) ?? null
  const counted = await countFrom(rehearsals, "Pałyn 4", song?.signature ?? "4/4")
  const master = await masterOf(rehearsals, "Pałyn 2")
  return { rehearsals, last, choices, set: set ?? null, notes: siteNotes(), song, fresh, counted, master }
}

/** The take of that name and its rehearsal's folder, the newest rehearsal's
 *  first. */
async function takeNamed(rehearsals: RehearsalSummary[], name: string) {
  for (const { folder } of rehearsals) {
    const { takes } = await api().get_rehearsal(folder)
    const take = takes.find((t) => t.name === name)
    if (take) return { folder, take }
  }
  return null
}

/** The tempo counted from the take of that name in `signature`, as a song's
 *  page asks for it when the take is picked under "count it from a take". */
async function countFrom(
  rehearsals: RehearsalSummary[],
  name: string,
  signature: Signature
): Promise<Counted | null> {
  const found = await takeNamed(rehearsals, name)
  if (!found) return null
  const res = await api().count_tempo(found.folder, found.take.take_number, signature)
  return res.ok && res.tempo != null ? { take: name, tempo: res.tempo, signature } : null
}

/**
 * The take of that name, the newest rehearsal's first, and the band's tempo
 * through it, played up to the chorus before its bridge (window.__SONG__,
 * band.js). Shown as the player zoomed in a little: up to four bars after
 * the band's last, so the seconds the take rang on after the song do not
 * take the lane's room, and the last bar's chip has room over it.
 */
async function masterOf(rehearsals: RehearsalSummary[], name: string): Promise<MasterData | null> {
  const found = await takeNamed(rehearsals, name)
  if (!found) return null
  const { take } = found
  const drift = await api().take_drift(
    take.tracks.map((t) => ({ name: t.name, file: t.file })),
    (take.notes ?? []).map((n) => ({ name: n.name, file: n.file })),
    { tempo: take.tempo ?? null, signature: take.signature ?? null, click: take.click === true, song: take.song ?? null }
  )
  const song = (window as unknown as { __SONG__?: { bridge: number; bar: number } }).__SONG__
  const at = song ? song.bridge - 8 * song.bar : 0
  const played = drift.ok ? drift.bars.filter((b) => b.tempo !== null) : []
  const last = played[played.length - 1]
  const to = last ? Math.min(take.duration_sec, last.end + 4 * (last.end - last.start)) : take.duration_sec
  return { take, drift, at, to }
}

const nothing = () => {}

/** A piece of the app on its own ground, described for those who cannot see
 *  it. `wide` and `line` say how it fits a phone (page.css). */
function Piece({
  label,
  wide,
  line,
  children,
}: {
  label: string
  wide?: boolean
  line?: boolean
  children: ReactNode
}) {
  return (
    <div role="img" aria-label={label} className={wide ? "piece wide" : line ? "piece line" : "piece"}>
      <div inert className="min-w-0 font-sans text-foreground">
        {children}
      </div>
    </div>
  )
}

/** One song's goes in a rehearsal's overview. */
function Goes({ last, song, only }: { last: RehearsalDetail; song: string; only?: (n: number) => boolean }) {
  const takes = last.takes.filter((t) => t.song === song && (!only || only(t.take_number)))
  const numbers = takes.map((t) => t.take_number)
  const songs = last.songs
    .filter((s) => s.name === song)
    .map((s) => ({ ...s, takes: numbers.length, take_numbers: numbers }))
  return (
    <RehearsalOverview
      takes={takes}
      songs={songs}
      playback={null}
      onPlay={nothing}
      onOpen={nothing}
      onOpenAt={nothing}
    />
  )
}

/**
 * Master's row in the player (Timeline): the take's lane, the band's tempo
 * along it bar by bar, on its group's fill. Its plate is left out, as the
 * player leaves it out where there is no room for it: beside the plate, a
 * lane in a window this size is too short for its tag and its chips both.
 */
function MasterRow({ master }: { master: MasterData }) {
  return (
    <div className="h-14 w-[33rem] max-w-full rounded-lg bg-card p-[3px]">
      <MasterClickLane
        from={0}
        to={master.to}
        position={master.at}
        take={master.take}
        drift={{ answer: master.drift, counting: false }}
      />
    </div>
  )
}

/** What Master's row says of a take's tempo, for those who cannot see it. */
function masterLabel({ take, drift }: MasterData): string {
  const said = drift.ok
    ? spokenDrift(drift.bars, stretches(drift.bars, drift.aim.tempo, DEFAULT_TOLERANCE), drift.aim.signature)
    : ""
  return `Master's row in the player under ${take.name}'s tracks, with the band's tempo bar by bar. ${said}`.trim()
}

/** Gig on the 25th mid-set: Pałyn played four times, Viasna up now. */
const MID_SET = new Map([["Pałyn", 4]])

/**
 * The rehearsal screen's Next take panel, the field over the songs under
 * it, as the screen lays them out: one group, each part under a line.
 */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="w-[23rem] max-w-full">
      <PanelParts>{children}</PanelParts>
    </div>
  )
}

/**
 * Two tracks' notes over eight bars, as the player lays them out: a plate on
 * the left, what it is and where it came from, and the notes beside it, the
 * part already heard in the accent. Where there is no room for the plate
 * beside the notes, as on a phone, it goes over them.
 */
function Notes({ notes }: { notes: SiteNotes }) {
  return (
    <div className="@container w-[33rem] max-w-full">
      <div className="grid grid-cols-1 grid-rows-[auto_7.5rem_auto_7.5rem] gap-2 @md:grid-cols-[11rem_minmax(0,1fr)] @md:grid-rows-[7.5rem_7.5rem]">
        {notes.lanes.map(({ port, notes: read }) => (
          <Fragment key={read.name}>
            {/* In the player the plate is on its lanes group's fill; here,
                with no group round it, it has a card of its own. */}
            <div className="rounded-lg bg-card">
              <NotesPlate name={read.name} icon={read.icon} port={port} />
            </div>
            <NotesLane
              name={read.name}
              data={read}
              duration={notes.to}
              view={{ from: notes.from, to: notes.to }}
              playhead={notes.playhead}
              className="h-full rounded-lg border"
            />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/**
 * The metronome's row on the rehearsal screen between takes, with the song
 * picked under Next take, as Python says it (metronome_state): the song's
 * tempo and time signature, or `typed`, a tempo typed or tapped into the
 * row, which Python holds until another song is picked. Null with neither.
 */
function rowOf(song: SongSummary, typed: number | null = null): MetronomeState | null {
  const own = song.tempo != null && song.signature ? { tempo: song.tempo, signature: song.signature } : null
  const tempo = typed ?? own?.tempo ?? null
  if (tempo === null) return null
  const signature = own?.signature ?? "4/4"
  return {
    phase: "idle",
    tempo,
    signature,
    per_bar: perBar(signature),
    on: true,
    case: own ? "song" : "song_without",
    song: { id: song.id, title: song.title, tempo: own?.tempo ?? null, signature: own?.signature ?? null },
    held: typed !== null && typed !== own?.tempo,
    last_take: null,
    upcoming: [],
    count: 0,
    since_count_in_ms: null,
    output_missing: null,
  }
}

/**
 * The row as the rehearsal screen draws it, with the line its state says
 * (statusLine). As wide as the row, the line wrapping under it; on a phone,
 * where the row is wider than the window, its left part (`line`).
 */
function Row({ state }: { state: MetronomeState }) {
  return (
    <div className="w-min max-w-full">
      <MetronomeRowView
        state={state}
        lit={null}
        line={statusLine(state)}
        onSwitch={nothing}
        onTempo={nothing}
        onPlay={nothing}
        onLink={nothing}
        settings={null}
        hold={false}
      />
    </div>
  )
}

/** Five hits on the drums' pads after a press of Tap, a little under half a
 *  second apart, in ms: what the row counts the tempo from (tapTempo). */
const PAD_HITS = [0, 458, 920, 1375, 1835]

/** The tempo typed into the row for a song with no tempo yet. */
const TYPED = 128

/**
 * A song's tempo on its page in History just after a count (SongTempoRow):
 * the number counted, and the line that says where it came from, with halve
 * and double. The row keeps a count in its own state, which only a count run
 * in it fills, so here it is drawn from its parts as it lays them out, with
 * its own words (songLine).
 */
function CountedRow({ title, count }: { title: string; count: Counted }) {
  const { tempo, signature } = count
  const line = songLine(title, tempo, count.take)
  return (
    <section className="flex w-[28rem] max-w-full flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Metronome aria-hidden className="mr-1 size-4 shrink-0 text-muted-foreground" />
        <TempoField tempo={tempo} signature={signature} onChange={nothing} />
        <SignatureSelect value={signature} onChange={nothing} />
        <TapButton signature={signature} onTempo={nothing} />
        <Button variant="outline" size="icon-row" aria-label="Play the click">
          <Play className="fill-current" />
        </Button>
        <BeatDots signature={signature} lit={null} />
      </div>
      <p className="min-h-[2lh] text-xs text-muted-foreground">
        {line.parts.map((part, i) =>
          typeof part === "string" ? (
            <span key={i}>{part}</span>
          ) : (
            <Button key={i} variant="link" className="inline h-auto rounded-sm p-0 text-xs whitespace-normal">
              {part.label}
            </Button>
          )
        )}
      </p>
    </section>
  )
}

/** A notice as the corner of the window draws it (Notices), kept on show:
 *  its time does not run. */
function NoticeView({ notice }: { notice: Pick<Notice, "kind" | "text" | "action"> }) {
  return (
    <div className="w-[24rem] max-w-full">
      <NoticeItem notice={{ id: 0, key: "site", ...notice }} paused onEnter={nothing} onLeave={nothing} />
    </div>
  )
}

/** What a take ended by the laptop's sleep says once it wakes, from 21:14:
 *  Python's words (audio/capture.py, slept_notice), which the recording
 *  screen puts in a warning as they come. */
const SLEPT = "The laptop went to sleep at 21:14, so the take ends there. Everything up to that moment is saved."

/** What a take says that stopped as no sound came from the interface for
 *  3 seconds: Python's words (audio/capture.py, STALLED), which the
 *  recording screen puts in a warning as they come. */
const STALLED =
  "Recording stopped: no sound has come from the audio interface for 3 seconds. It was " +
  "unplugged, switched off or stopped answering. Everything captured up to that point has been saved."

/** The take deleted in the undo's piece. */
const GONE = "Pałyn 5"

/**
 * The end of Settings › Metronome, as the tab lays it out: Write the tempo
 * into WAV files, on, as Python has it unless turned off (get_settings,
 * which the tab asks itself), and the line under it. The rest of the tab
 * is left out: all of it is twice as tall as the window.
 */
function WavTempo() {
  return (
    <div className="flex w-[33rem] max-w-full flex-col [&>*:not(:has(#tempo-in-wav))]:hidden">
      <MetronomeSettings />
    </div>
  )
}

/** The piece each item shows in the window, by the item's id. */
export function itemPieces({
  last,
  choices,
  set,
  notes,
  song,
  fresh,
  counted,
  master,
}: PieceData): Record<PieceId, ReactNode> {
  const kept = last.takes.find((t) => t.cloud && t.starred)
  const tapped = song?.signature ? tapTempo(PAD_HITS, song.signature) : null
  const afterTap = song && tapped !== null ? rowOf(song, tapped) : null
  const typed = fresh && rowOf(fresh, TYPED)
  return {
    set: set ? (
      <Piece
        label={`The Next take field with Viasna, and under it the set ${set.name}: Pałyn played 4 times, Viasna now, Ahoń next`}
      >
        <Panel>
          <TakeNameField
            id="site-set-take"
            label="Next take"
            value="Viasna"
            fallback="Viasna"
            choices={choices}
            onCommit={nothing}
            onPanel
            songs="none"
            labelAside={<SongKeys />}
          />
          <SetCard set={set} goes={MID_SET} current="Viasna" onPick={nothing} highlighted={null} />
        </Panel>
      </Piece>
    ) : null,
    tap: afterTap?.song?.tempo ? (
      <Piece
        line
        label={`The metronome's row with ${afterTap.song.title} picked, just after the drummer tapped on the pads: ${formatTempo(afterTap.tempo!, afterTap.signature)}, held until another song, with Save to song, since ${afterTap.song.title} has ${formatTempo(afterTap.song.tempo, afterTap.signature)}`}
      >
        <Row state={afterTap} />
      </Piece>
    ) : null,
    counted: song && counted ? (
      <Piece
        label={`${song.title}'s tempo on its page in History, counted from ${counted.take}: ${formatTempo(counted.tempo, counted.signature)} in ${counted.signature}, with halve and double in case the click runs twice too fast or too slow`}
      >
        <CountedRow title={song.title} count={counted} />
      </Piece>
    ) : null,
    "first-take": typed ? (
      <Piece
        line
        label={`The metronome's row for a song with no tempo yet, ${formatTempo(typed.tempo!, typed.signature)} typed in, and under it “${statusLine(typed).text}” with Save now`}
      >
        <Row state={typed} />
      </Piece>
    ) : null,
    midi: (
      <Piece
        label={`The notes of ${notes.lanes.map((l) => `${l.notes.name} from ${l.port}`).join(" and ")} over eight bars, each saved as .mid`}
      >
        <Notes notes={notes} />
      </Piece>
    ),
    awake: (
      <Piece label={`A warning: “${SLEPT}”`}>
        <NoticeView notice={{ kind: "warning", text: SLEPT }} />
      </Piece>
    ),
    unplugged: (
      <Piece label={`A warning: “${STALLED}”`}>
        <NoticeView notice={{ kind: "warning", text: STALLED }} />
      </Piece>
    ),
    disk: (
      <Piece label="Interface connected, room for about 28 hours 40 minutes of recording">
        {/* Pretty wrapping, on the site only: on a phone the line would
            otherwise leave one word on its second line. */}
        <div className="text-pretty">
          <HealthLine health={{ recording: true, minutes_left: 1720 }} hold={false} />
        </div>
      </Piece>
    ),
    marks: (
      <Piece wide label="Four takes of the song Pałyn, with their marks and comments">
        <Goes last={last} song="Pałyn" />
      </Piece>
    ),
    drift: master?.drift.ok ? (
      <Piece label={masterLabel(master)}>
        <MasterRow master={master} />
      </Piece>
    ) : null,
    undo: (
      <Piece label={`A notice that ${GONE} went to ${trashName()}, with Undo`}>
        <NoticeView
          notice={{ kind: "done", text: wentTo(`“${GONE}”`), action: { label: "Undo", run: nothing } }}
        />
      </Piece>
    ),
    cloud: kept ? (
      <Piece label={`${kept.name}, marked as the one to keep, in the cloud`}>
        <Goes last={last} song={kept.song ?? ""} only={(n) => n === kept.take_number} />
      </Piece>
    ) : null,
    "wav-tempo": (
      <Piece label="Settings › Metronome at its end, with Write the tempo into WAV files ticked">
        <WavTempo />
      </Piece>
    ),
  }
}
