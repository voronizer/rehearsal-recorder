import { SongTab } from "@/components/SongTab"
import { TakePlayer } from "@/components/TakePlayer"
import { useMultitrackPlayer, type MultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { Take, TrackFile } from "@/lib/api"
import { content } from "../content"
import { Footer } from "../page/Footer"
import { Nav } from "../page/Nav"
import { MAC_ZIP, REPO, WINDOWS_ZIP } from "../page/links"

/** Where the 404 page's take is, on the fake Python side: see silence.ts. */
export const SILENT_FOLDER = "/404/"
/** 4:04. */
export const SILENT_SECONDS = 244

const TRACKS: TrackFile[] = ["Drums", "Bass", "Guitar", "Vocals"].map((name) => ({
  name,
  file: `${SILENT_FOLDER}${name}.wav`,
}))
const TAKE: Take = {
  take_number: 404,
  name: "Take 404",
  song: null,
  go: null,
  duration_sec: SILENT_SECONDS,
  tracks: TRACKS,
}
const GO = { take: TAKE }
const nothing = () => {}

/** Take 404 as the player shows it: four tracks, and nothing on them. A
 *  picture, like the pieces on the page: still, and not for clicking. */
function EmptyTake({ player }: { player: MultitrackPlayer }) {
  return (
    <div
      role="img"
      aria-label="Take 404 in the app: Drums, Bass, Guitar and Vocals, 4 minutes 4 seconds, and nothing on any of them"
      className="piece nf-take"
    >
      <div inert className="flex min-w-0 flex-col gap-3 font-sans text-foreground">
        <div className="flex border-b">
          <SongTab
            tabKey="404"
            song={null}
            goes={[GO]}
            shown={GO}
            open
            expanded={false}
            isOpenGo={() => true}
            onPick={nothing}
            onRow={nothing}
            onToggle={nothing}
          />
        </div>
        <TakePlayer player={player} />
      </div>
    </div>
  )
}

/** What reha.stream shows at an address with nothing there. */
export function NotFound({ windows }: { windows: boolean }) {
  const download = windows ? { name: "Windows", href: WINDOWS_ZIP } : { name: "macOS", href: MAC_ZIP }
  // The take's tracks come a moment after the page, and they make the take
  // taller, which would move the words beside it. So the page shows once the
  // take is open, all of it at once, as the main page does with its pieces.
  const player = useMultitrackPlayer(TRACKS, SILENT_SECONDS)
  return (
    <div className="wrap" style={player.settled ? undefined : { visibility: "hidden" }}>
      <Nav repo={REPO} home="/" />
      <main>
        <section className="hero nf-split">
          <div className="hero-text">
            <p className="eyebrow">404</p>
            <h1 className="h1">{content.notFound.title}</h1>
            <p className="lede">{content.notFound.lede}</p>
            <div className="cta">
              <a className="btn" href="/">
                Go to the main page
              </a>
              <a className="more" href={download.href}>
                Download for {download.name}
              </a>
            </div>
          </div>
          <EmptyTake player={player} />
        </section>
      </main>
      <Footer />
    </div>
  )
}
