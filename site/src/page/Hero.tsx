import { content } from "../content"
import { Inline } from "./Md"
import { Downloads } from "./Downloads"
import { LiveFrame } from "./LiveFrame"

/** What the app is, its downloads, and the app itself, live. */
export function Hero({ windows }: { windows: boolean }) {
  const { hero } = content
  return (
    <section className="hero" id="top">
      <div className="hero-text">
        <p className="eyebrow">{hero.eyebrow}</p>
        <h1 className="h1">{hero.title}</h1>
        <p className="lede">{hero.lede}</p>
        <Downloads windows={windows} />
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
