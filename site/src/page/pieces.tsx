// The pieces of the app in the tiles: the app's own components, given what
// the screens would give them, from the band on the fake Python side. They
// are pictures here: still, and not for clicking.
import type { ReactNode } from "react"
import { HealthLine } from "@/components/HealthLine"
import { SetCard, SongRows } from "@/components/NextTakeSongs"
import { RehearsalList } from "@/components/RehearsalList"
import { RehearsalOverview } from "@/components/RehearsalOverview"
import { SongKeys } from "@/components/SongKeys"
import { StopTake } from "@/components/StopTake"
import { TakeNameField } from "@/components/TakeNameField"
import { TrackTile } from "@/components/TrackTile"
import {
  api,
  type RehearsalDetail,
  type RehearsalSet,
  type RehearsalSummary,
  type SongChoices,
} from "@/lib/api"
import { otherSongs } from "@/lib/setSongs"
import type { TILES } from "../content"

export type PieceData = {
  rehearsals: RehearsalSummary[]
  last: RehearsalDetail
  /** The songs under the Next take field, with Pałyn also typed as Palyn. */
  choices: SongChoices
  /** The band's set, Gig on the 25th, for the sets tile. */
  set: RehearsalSet | null
}

/** What the tiles show, asked of the bridge as the history screen and the
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
  return { rehearsals, last, choices, set: set ?? null }
}

const nothing = () => {}

/** A piece of the app on its own ground, described for those who cannot see it. */
function Piece({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className={wide ? "piece wide" : "piece"}>
      <div inert className="min-w-0 font-sans text-foreground">
        {children}
      </div>
    </div>
  )
}

/**
 * Two tracks on the recording screen just after the guitar clipped: its
 * peak still held at the top, in red, and the count of clips.
 */
function Tracks() {
  return (
    <div className="grid h-72 w-[26rem] max-w-full grid-cols-2 gap-3 *:h-full">
      <TrackTile name="Bass" icon="bass" channel={2} peaks={[0.048]} shown={[0.048]} held={[0.07]} clips={0} silent={false} />
      <TrackTile name="Guitar" icon="guitar-electric" channel={3} peaks={[0.052]} shown={[0.052]} held={[1]} clips={3} silent={false} />
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

/** Gig on the 25th mid-set: Pałyn played four times, Viasna up now. */
const MID_SET = new Map([["Pałyn", 4]])

/**
 * The rehearsal screen's Next take panel, the field over the songs under
 * it, as the screen lays them out.
 */
function Panel({ children }: { children: ReactNode }) {
  return <div className="flex w-[23rem] max-w-full flex-col gap-5">{children}</div>
}

export type Shot = { pieces: ReactNode; left?: boolean }

/** Which piece goes beside which tile's words, by the tile's id. */
export function shots({
  rehearsals,
  last,
  choices,
  set,
}: PieceData): Record<(typeof TILES)[number], Shot | null> {
  const kept = last.takes.find((t) => t.cloud && t.starred)
  return {
    health: {
      pieces: (
        <>
          <Piece label="Interface connected, room for about 28 hours 40 minutes more">
            <HealthLine health={{ recording: true, minutes_left: 1720 }} />
          </Piece>
          <Piece label="The Bass and Guitar tiles while recording; the Guitar tile is red and says clipped 3 times">
            <Tracks />
          </Piece>
        </>
      ),
    },
    track: {
      pieces: (
        <Piece label="The Stop button, with autosaved every 30 s under it">
          <div className="flex flex-col items-end gap-2">
            <StopTake onStop={nothing} stopping={false} saving={null} />
          </div>
        </Piece>
      ),
    },
    rehearsals: {
      pieces: (
        <Piece label="Four rehearsals in the history list, each with its length and number of takes">
          <div className="w-60">
            <RehearsalList rehearsals={rehearsals} current={rehearsals[0].folder} onChoose={nothing} />
          </div>
        </Piece>
      ),
    },
    marks: {
      left: true,
      pieces: (
        <Piece wide label="Four goes at the song Pałyn, with their marks and comments">
          <Goes last={last} song="Pałyn" />
        </Piece>
      ),
    },
    names: {
      left: true,
      pieces: (
        <Piece label="The Next take field with Palyn typed: Palyn is Pałyn now, at its next go, the one song left under it">
          <Panel>
            {/* "Make Palyn a new song" floats over the songs on the screen,
                and here would hide the one this tile is about. */}
            <TakeNameField
              id="site-next-take"
              label="Next take"
              value="Palyn"
              fallback="Pałyn"
              choices={choices}
              onCommit={nothing}
              onPanel
              songs="none"
              offerNewSong={false}
              labelAside={<SongKeys />}
            />
            <SongRows
              titles={otherSongs(choices, [])}
              lastTake={new Map()}
              goes={new Map()}
              current="Pałyn"
              typed="Palyn"
              typing={false}
              inSet={[]}
              title="Songs"
              onPick={nothing}
              highlighted={null}
              open={false}
              onOpen={nothing}
            />
          </Panel>
        </Piece>
      ),
    },
    cloud: {
      left: true,
      pieces: kept ? (
        <Piece label={`${kept.name}, marked as the one to keep, in the cloud`}>
          <Goes last={last} song={kept.song ?? ""} only={(n) => n === kept.take_number} />
        </Piece>
      ) : null,
    },
    sets: {
      pieces: set ? (
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
    },
    formats: {
      left: true,
      pieces: (
        <div className="fmt">
          <span>
            16 <i>/</i> 24-bit
          </span>
          <span>
            44.1 <i>·</i> 48 <i>·</i> 96 kHz
          </span>
        </div>
      ),
    },
    trash: null,
  }
}
