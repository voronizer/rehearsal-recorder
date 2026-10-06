import { content } from "../content"
import { Inline } from "./Md"
import { LiveFrame } from "./LiveFrame"
import { MAC_ZIP, WINDOWS_ZIP } from "./links"

const APPLE =
  "M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8C7 7.2 5.6 8.1 4.8 9.5c-1.6 2.8-.4 6.9 1.2 9.1.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.3-2.5 1.3-2.6 0 0-2.6-1-2.6-3.5zM14.1 5.6c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z"
const WINDOWS = "M3 5.5 10.4 4.5v7H3zm8.4-1.1L21 3v8.5h-9.6zM3 12.5h7.4v7L3 18.5zm8.4 0H21V21l-9.6-1.4z"

const DOWNLOADS = {
  mac: { name: "macOS", href: MAC_ZIP, icon: APPLE },
  windows: { name: "Windows", href: WINDOWS_ZIP, icon: WINDOWS },
}

/** The download for this computer is the button; the other one is a link. */
export function Hero({ windows }: { windows: boolean }) {
  const [mine, other] = windows ? [DOWNLOADS.windows, DOWNLOADS.mac] : [DOWNLOADS.mac, DOWNLOADS.windows]
  const { hero } = content
  return (
    <section className="hero" id="top">
      <div className="hero-text">
        <p className="eyebrow">{hero.eyebrow}</p>
        <h1 className="h1">{hero.title}</h1>
        <p className="lede">{hero.lede}</p>
        <div className="cta">
          <a className="btn" href={mine.href}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d={mine.icon} />
            </svg>
            <span>Download for {mine.name}</span>
          </a>
          <a className="more" href={other.href}>
            Download for {other.name}
          </a>
        </div>
        <p className="fine">
          Version {content.version} · {hero.finePrint}
        </p>
      </div>
      <div>
        <LiveFrame
          scene="hero"
          title="РЭХА playing the bridge of a take on repeat; you can use it"
          interactive
        />
        <p className="caption on-computer">
          <Inline text={hero.caption} />
        </p>
        <p className="caption on-phone">
          <Inline text={hero.phoneCaption} />
        </p>
      </div>
    </section>
  )
}
