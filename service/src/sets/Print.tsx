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

/** “E minor” as a set list writes it, “Em”; “F♯ major”, “F♯”. */
export const shortKey = (key: string | null) => (key ? key.replace(/ major$/, "").replace(/ minor$/, "m") : "")

export function PrintSheet({ set, songs }: { set: BandSet; songs: SongItem[] }) {
  return createPortal(
    <div className="print-sheet bg-white text-black" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      <div className="mb-6 flex items-baseline justify-between gap-6 border-b border-black/30 pb-3 text-[15px]">
        <span className="font-semibold">{set.name}</span>
        <span className="shrink-0">{setLine(songs, true)}</span>
      </div>
      <ol>
        {songs.map((s, i) => (
          <li key={s.id} className="flex break-inside-avoid items-baseline gap-5 border-b border-black/15 py-3">
            <span className="w-10 shrink-0 text-right text-[28px] text-black/50">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[40px] leading-tight font-bold">{s.title}</span>
            <span className="shrink-0 text-[24px]">{[shortKey(s.key), s.tempo !== null ? String(Math.round(s.tempo)) : ""].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ol>
    </div>,
    document.body
  )
}
