import { createPortal } from "react-dom"
import type { BandSet, SongItem } from "../api"
import { setLine } from "./length"

/*
  The set printed for the stage (Alex's pick, 9 November): one column in big
  letters on A4, the set's name and how long it plays at the top, then each
  song's number, title, and its key and tempo on the right. Twelve songs fit
  a sheet; more go on to the next. The sheet is on the set's page but shows
  only when printed (service.css), so **Print** opens the browser's own
  print window with it.
*/

// The sheet's own look, for paper and not the screen: its ink and its
// letters' sizes, each on one line with why.
// design-ok(raw-colour): a sheet made for paper, black on white whatever the theme, sized for A4
const INK = { sheet: "bg-white text-black", head: "border-black/30", song: "border-black/15", number: "text-black/50" }
// design-ok(px-text): the same sheet's letters, in the sizes a page of A4 is read in from the stage
const SIZE = { head: "text-[15px]", number: "text-[28px]", title: "text-[40px]", facts: "text-[24px]" }
const SHEET = `print-sheet ${INK.sheet}`
const HEAD = `mb-6 flex items-baseline justify-between gap-6 border-b pb-3 ${INK.head} ${SIZE.head}`
const SONG = `flex break-inside-avoid items-baseline gap-5 border-b py-3 ${INK.song}`
const NUMBER = `w-10 shrink-0 text-right ${SIZE.number} ${INK.number}`
const TITLE = `min-w-0 flex-1 leading-tight font-bold ${SIZE.title}`
const FACTS = `shrink-0 ${SIZE.facts}`

/** “E minor” as a set list writes it, “Em”; “F♯ major”, “F♯”. */
export const shortKey = (key: string | null) => (key ? key.replace(/ major$/, "").replace(/ minor$/, "m") : "")

export function PrintSheet({ set, songs }: { set: BandSet; songs: SongItem[] }) {
  return createPortal(
    <div className={SHEET} style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <div className={HEAD}>
        <span className="font-semibold">{set.name}</span>
        <span className="shrink-0">{setLine(songs, true)}</span>
      </div>
      <ol>
        {songs.map((s, i) => (
          <li key={s.id} className={SONG}>
            <span className={NUMBER}>{i + 1}</span>
            <span className={TITLE}>{s.title}</span>
            <span className={FACTS}>{[shortKey(s.key), s.tempo !== null ? String(Math.round(s.tempo)) : ""].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ol>
    </div>,
    document.body
  )
}
