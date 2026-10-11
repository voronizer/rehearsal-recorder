import { content } from "../content"
import { releaseNotes } from "./links"

/** What's new, as one line above the menu. */
export function Ribbon() {
  const { news } = content
  return (
    <p className="ribbon">
      <b>New in {news ? news.version : content.version}.</b> {news && <>{news.lead} </>}
      <a className="more" href={releaseNotes(news ? news.tag : content.tag)}>
        Release notes
      </a>
    </p>
  )
}
