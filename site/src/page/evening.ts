// The items of the four steps (site/content/story.md): which are tiles and
// which cards, and what the app's window beside them shows for each, on a
// click: a moment of the live app, a step and its line as the story goes
// through them (site/src/stage/Story.tsx), or a still piece of the app
// (site/src/page/pieces.tsx).
import type { ItemId } from "../content"
import type { PieceId } from "./pieces"

/** A tile is one of the important things: grey, and bigger than a card,
 *  which is a trick. */
export const KIND: Record<ItemId, "tile" | "card"> = {
  set: "tile",
  tempo: "tile",
  "left-off": "card",
  tap: "card",
  counted: "card",
  "first-take": "card",
  inputs: "card",
  tracks: "tile",
  midi: "tile",
  "count-in": "card",
  edge: "card",
  "last-time": "card",
  clip: "card",
  awake: "card",
  unplugged: "card",
  disk: "card",
  marks: "tile",
  drift: "tile",
  undo: "tile",
  "same-bar": "card",
  "false-starts": "card",
  "song-page": "tile",
  cloud: "tile",
  "mark-lead": "card",
  numbers: "card",
  "cloud-follows": "card",
  "phone-mix": "card",
  bars: "card",
  "wav-tempo": "card",
}

export type Moment = { step: number; beat: number }
export type Shows = { moment: Moment } | { piece: PieceId }

const at = (step: number, beat: number): Shows => ({ moment: { step, beat } })
const piece = (id: PieceId): Shows => ({ piece: id })

/** What the window shows for each item. The moments: before 0 the rehearsal
 *  named, 1 its tracks, 3 last week's Pałyn playing, 4 Pałyn picked with its
 *  tempo; during 0 the count-in, 1 the band in, 2 the guitar's third clip;
 *  after 2 the take named, with Clear false starts; later 1 Marks, 2
 *  Pałyn's page, 4 Pałyn 6 at Pałyn 5's loop. */
export const SHOWS: Record<ItemId, Shows> = {
  set: piece("set"),
  tempo: at(0, 4),
  "left-off": at(0, 3),
  tap: piece("tap"),
  counted: piece("counted"),
  "first-take": piece("first-take"),
  inputs: at(0, 1),
  tracks: at(1, 1),
  midi: piece("midi"),
  "count-in": at(1, 0),
  edge: at(1, 1),
  "last-time": at(1, 1),
  clip: at(1, 2),
  awake: piece("awake"),
  unplugged: piece("unplugged"),
  disk: piece("disk"),
  marks: piece("marks"),
  drift: piece("drift"),
  undo: piece("undo"),
  "same-bar": at(3, 4),
  "false-starts": at(2, 2),
  "song-page": at(3, 2),
  cloud: piece("cloud"),
  "mark-lead": at(3, 1),
  numbers: at(3, 2),
  "cloud-follows": piece("cloud"),
  "phone-mix": piece("cloud"),
  bars: piece("drift"),
  "wav-tempo": piece("wav-tempo"),
}
