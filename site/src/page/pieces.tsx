// The pieces of the app in the tiles: the app's own components, given what
// the screens would give them, from the band on the fake Python side. They
// are pictures here: still, and not for clicking.
import type { ReactNode } from "react"
import { HealthLine } from "@/components/HealthLine"
import { RehearsalList } from "@/components/RehearsalList"
import { RehearsalOverview } from "@/components/RehearsalOverview"
import { StopTake } from "@/components/StopTake"
import { TrackTile } from "@/components/TrackTile"
import { api, type RehearsalDetail, type RehearsalSummary } from "@/lib/api"
import type { TILES } from "../content"

export type PieceData = { rehearsals: RehearsalSummary[]; last: RehearsalDetail }

/** What the tiles show, asked of the bridge as the history screen would. */
export async function loadPieces(): Promise<PieceData> {
  const rehearsals = await api().list_rehearsals()
  const last = await api().get_rehearsal(rehearsals[0].folder)
  return { rehearsals, last }
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

export type Shot = { pieces: ReactNode; left?: boolean }

/** Which piece goes beside which tile's words, by the tile's id. */
export function shots({ rehearsals, last }: PieceData): Record<(typeof TILES)[number], Shot | null> {
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
        <Piece wide label="Four goes at the song Polyn, with their marks and comments">
          <Goes last={last} song="Polyn" />
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
