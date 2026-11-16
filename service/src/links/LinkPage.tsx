import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { useParams } from "@tanstack/react-router"
import { TakePlayer as RehaPlayer } from "@/components/TakePlayer"
import { usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import type { Marker, NotesFile } from "@/lib/api"
import { cn } from "@/lib/utils"
import { played, Refused, useBand, useLinkPage, type LinkPage as Answer } from "../api"
import { MarkItem } from "../marks/MarkItem"
import { PhoneBar } from "../shell/PlayerBar"
import { Group, Groups, Logo, Page, Rows, Trouble } from "../shell/parts"
import { useSize } from "../shell/size"
import { clock, count, longDay, takeText } from "../shell/words"
import { chipsOf } from "../takes/chips"
import { Desk } from "../takes/Desk"
import { Download, type LinkDownload } from "../takes/Download"
import type { Desk as DeskState } from "../takes/player/desk"
import { notesAlone } from "../takes/player/lanes"
import { CANNOT_PLAY, PlayerProvider, usePlayer } from "../takes/player/one"
import { useServiceSound, type ServiceSound } from "../takes/player/sound"
import { TakeName } from "../takes/parts"
import { TakePlayer, useNotes, useReha, useRehaLabels, useSpeed, useTakePlayer } from "../takes/Take"

/*
  The page a link to one take opens, for someone outside the band (#106),
  with no sign-in: the band's picture and name in a bar, no menu, then the
  take as the link shows it. The mix: ▶ and its wave. Mix and tracks:
  РЭХА's player, or on a phone the tracks and the bar at the bottom. And
  marks: the band's marks too, to read. It starts at the maker's levels, M
  and S, and what the person changes stays in this page. Nothing here
  changes the band's things: no ★, no ⋯, no **Mark**, no comments.
*/

const GONE = "This link no longer works."

/** M and S as the maker left them; a link that shows only the mix starts with none. */
function deskOf(page: Answer): DeskState {
  const heard = page.link.heard
  if (!heard) return { muted: [], solo: [] }
  const at = (names: string[]) => page.tracks.flatMap((t, i) => (names.includes(t.name) ? [i] : []))
  return { muted: at(heard.muted), solo: at(heard.soloed) }
}

/** The band's marks on the take, to read. */
function Marks({ take }: { take: Answer }) {
  return (
    <Group title="Marks" hint={String(take.marks.length)}>
      <Rows talk>
        {take.marks.map((k) => (
          <MarkItem key={k.id} mark={k} readOnly />
        ))}
      </Rows>
    </Group>
  )
}

/** On a computer, РЭХА's player as the band's take page has it, without **Mark**; a chip goes to its mark in the list. */
function Full({ take, notes, sound, reha }: { take: Answer; notes: NotesFile[]; sound: ServiceSound; reha: Record<string, number> }) {
  const drift = useMemo(() => ({ answer: take.drift, counting: false }), [take.drift])
  const player = useTakePlayer(take, sound)
  useRehaLabels()
  useSpacebar(player.toggle)
  usePlayerKeys(player.skip)
  const speed = useSpeed(take, sound)
  const { markers, markOf } = chipsOf(take.marks)
  const toMark = (m: Marker) => {
    const k = markOf(m)
    if (k) document.querySelector(`[data-mark="${k.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }
  const marks = take.marks.length > 0
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div data-take-player className="flex flex-col">
        <RehaPlayer
          player={player}
          click={false}
          take={take.meter}
          drift={drift}
          notes={notes}
          markers={markers}
          onEditMarker={marks ? toMark : undefined}
          talkOf={marks ? (m) => markOf(m)?.comments.length ?? 0 : undefined}
          spaceKey
          reha={reha}
          speed={speed}
        />
      </div>
      {marks && (
        <Groups>
          <Marks take={take} />
        </Groups>
      )}
    </div>
  )
}

/** On a phone: ▶ and the wave, a row per track, then the marks. */
function Phone({ take, notes, tracks, sound, reha }: { take: Answer; notes: NotesFile[]; tracks: number; sound: ServiceSound; reha: Record<string, number> }) {
  const player = useTakePlayer(take, sound)
  useRehaLabels()
  return (
    <Groups>
      <Group>
        <TakePlayer take={take} height={72} />
      </Group>
      <Group title="Tracks" hint={String(tracks)}>
        <Desk take={take} player={player} notes={notes} reha={reha} />
      </Group>
      {take.marks.length > 0 && <Marks take={take} />}
    </Groups>
  )
}

/** The take as the link shows it. */
function View({ page }: { page: Answer }) {
  const p = usePlayer()
  const size = useSize()
  const phone = size === "phone"
  const mix = page.link.mix
  const cannot = p.supported === false
  const notes = useNotes(page)
  const reha = useReha(page)
  // The maker's M and S, and nothing sent back: the person's changes stay in this page.
  const desk = useMemo(() => deskOf(page), [page])
  const sound = useServiceSound(page, { keeps: false, desk })
  const tracks = page.tracks.length + notesAlone(page, notes).length
  useEffect(() => {
    p.cue(page.uid, 0)
    // Once, as the page opens; the player's own changes are not a reason to cue again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.uid])
  // The first ▶ after the page opened counts one play; the others in this page do not.
  const counted = useRef(false)
  const playing = p.uid === page.uid && p.look === "playing"
  useEffect(() => {
    if (!playing || counted.current) return
    counted.current = true
    void played(page.link.id).catch(() => {})
  }, [playing, page.link.id])
  const download: LinkDownload | null =
    page.link.download === "none" ? null : { mix: mix ? `${page.files_at}/mix.mp3` : null, tracks: page.link.download === "all" }
  return (
    <Page
      title={
        <span className="flex flex-wrap items-center gap-3">
          <TakeName take={page} wrap className="min-w-0" />
          <span className="flex-1" />
          {download && (
            <span className="text-sm font-normal">
              <Download take={page} sound={sound} phone={phone} link={download} />
            </span>
          )}
        </span>
      }
      sub={
        <span className="mt-1 flex flex-wrap items-center gap-x-2">
          {page.song && (
            <>
              <span>{page.song.title}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>{longDay(page.date)}</span>
          <span aria-hidden>·</span>
          <span>{mix ? clock(page.duration_sec) : `${clock(page.duration_sec)} · ${count(tracks, "track")}`}</span>
        </span>
      }
    >
      {cannot ? (
        <Groups>
          <Group>
            <p className="text-muted-foreground">{CANNOT_PLAY}</p>
          </Group>
          {page.marks.length > 0 && <Marks take={page} />}
        </Groups>
      ) : mix ? (
        <TakePlayer take={page} height={phone ? 72 : 96} />
      ) : phone ? (
        <Phone take={page} notes={notes} tracks={tracks} sound={sound} reha={reha} />
      ) : (
        <Full take={page} notes={notes} sound={sound} reha={reha} />
      )}
    </Page>
  )
}

/** Where the page goes: the room under the bar, scrolled. */
function Main({ children }: { children: ReactNode }) {
  const size = useSize()
  return (
    <main
      className={cn(
        "min-h-0 flex-1 overflow-y-auto bg-background text-sm",
        size === "phone" ? "px-4 py-5" : size === "wide" ? "px-8 py-(--screen-pad-y) [--screen-pad-y:2rem]" : "px-6 py-(--screen-pad-y) [--screen-pad-y:1.5rem]"
      )}
    >
      {children}
    </main>
  )
}

export function LinkPage() {
  const { id } = useParams({ from: "/l/$id" })
  const page = useLinkPage(id)
  const band = useBand().data
  const size = useSize()
  const phone = size === "phone"
  const name = band?.name ?? ""
  useEffect(() => {
    if (page.data) document.title = name ? `${takeText(page.data)} · ${name}` : takeText(page.data)
  }, [page.data, name])
  const gone = page.error instanceof Refused && page.error.status === 404
  return (
    <div className="flex h-full flex-col">
      {/* As the band's pages have it on a phone, with no menu. */}
      <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b bg-panel", phone ? "px-4" : size === "wide" ? "px-8" : "px-6")}>
        <Logo name={name} picture={band?.picture ?? null} className="size-7 rounded-sm text-sm" />
        <span className="min-w-0 truncate font-semibold">{name}</span>
      </header>
      {page.data ? (
        // The page's own player; the take is in its place before it opens (api.ts seedLink).
        <PlayerProvider>
          <Main>
            <View page={page.data} />
          </Main>
          {phone && !page.data.link.mix && <PhoneBar outside />}
        </PlayerProvider>
      ) : (
        <Main>
          {gone ? (
            <p className="text-muted-foreground">{GONE}</p>
          ) : (
            page.error && <Trouble error={page.error} retry={() => void page.refetch()} />
          )}
        </Main>
      )}
    </div>
  )
}
