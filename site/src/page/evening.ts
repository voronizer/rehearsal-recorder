// The items of the four steps (site/content/story.md): which are tiles and
// which cards, and what the app's window beside them shows for each, on a
// click: a moment of the live app, a step and its line as the story goes
// through them (site/src/stage/Story.tsx), seen from near enough to read,
// or a still piece of the app (site/src/page/pieces.tsx).
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

/** Where the window looks in the app's screen (1180 × 960 px): the middle of
 *  what it shows, and how many times nearer than the whole screen. Nearer
 *  than about 1.7, and the screen round what matters goes; much less, and
 *  the app is too small to read. */
export type Focus = { x: number; y: number; zoom: number }

export type Moment = { step: number; beat: number }
export type Shows = { moment: Moment; focus: Focus } | { piece: PieceId }

const NEAR = 1.7

const at = (step: number, beat: number, x: number, y: number, zoom = NEAR): Shows => ({
  moment: { step, beat },
  focus: { x, y, zoom },
})
const piece = (id: PieceId): Shows => ({ piece: id })

/** What the window shows for each item: a still piece, or a moment of the
 *  live app and where in it to look. The moments: before 1 the rehearsal's
 *  tracks, 3 last week's Pałyn playing, 4 Pałyn picked with its tempo;
 *  during 0 the count-in, 1 the band in, 2 the guitar's third clip; after 0
 *  the take just stopped, 2 the take named, with Clear false starts; later 1
 *  Marks, 2 Pałyn's page, 4 Pałyn 6 at Pałyn 5's loop. */
export const SHOWS: Record<ItemId, Shows> = {
  set: piece("set"),
  tempo: at(0, 4, 360, 760),
  "left-off": at(0, 3, 300, 330),
  tap: piece("tap"),
  counted: piece("counted"),
  "first-take": piece("first-take"),
  inputs: at(0, 1, 820, 400),
  tracks: at(1, 1, 480, 560, 1.4),
  midi: piece("midi"),
  "count-in": at(1, 0, 590, 200),
  // The top left corner, where the lit edge shows on two sides, with the
  // clock beside it.
  edge: at(1, 1, 0, 0, 1.4),
  "last-time": at(1, 1, 590, 290, 1.9),
  clip: at(1, 2, 730, 580),
  awake: piece("awake"),
  unplugged: piece("unplugged"),
  disk: piece("disk"),
  marks: piece("marks"),
  drift: piece("drift"),
  undo: piece("undo"),
  "same-bar": at(3, 4, 560, 600, 1.35),
  "false-starts": at(2, 2, 420, 370, 1.6),
  "song-page": at(3, 2, 700, 640, 1.5),
  cloud: piece("cloud"),
  "mark-lead": at(3, 1, 700, 440, 1.35),
  numbers: at(3, 4, 330, 300, 1.8),
  "cloud-follows": piece("cloud-follows"),
  "phone-mix": at(2, 0, 360, 800),
  bars: at(2, 0, 560, 420, 1.6),
  "wav-tempo": piece("wav-tempo"),
}

/** Where the window looks while the app goes through a step on its own,
 *  nothing picked: at each of the step's moments (site/src/stage/Story.tsx),
 *  what it is doing. */
export const BEAT_FOCUS: Focus[][] = [
  // The rehearsal named; its tracks; the check; last week's Pałyn; Pałyn
  // picked under Next take.
  [
    { x: 300, y: 760, zoom: 1.6 },
    { x: 820, y: 400, zoom: NEAR },
    { x: 820, y: 450, zoom: NEAR },
    { x: 300, y: 330, zoom: NEAR },
    { x: 870, y: 330, zoom: 1.6 },
  ],
  // The count-in; the band in; the guitar's clip.
  [
    { x: 590, y: 200, zoom: NEAR },
    { x: 590, y: 420, zoom: 1.4 },
    { x: 730, y: 580, zoom: NEAR },
  ],
  // The take just stopped; its song picked; Send starred.
  [
    { x: 590, y: 420, zoom: 1.3 },
    { x: 360, y: 620, zoom: 1.6 },
    { x: 420, y: 300, zoom: 1.6 },
  ],
  // History; Marks; Pałyn's page; Pałyn 5 looping; Pałyn 6 and 7 at the
  // same place.
  [
    { x: 450, y: 400, zoom: 1.4 },
    { x: 700, y: 440, zoom: 1.35 },
    { x: 700, y: 600, zoom: 1.4 },
    { x: 640, y: 650, zoom: 1.4 },
    { x: 560, y: 600, zoom: 1.35 },
    { x: 560, y: 600, zoom: 1.35 },
  ],
]
