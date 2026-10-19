import type { ShareWhat } from "@/lib/api"

/** What the share dialog says under its title: how a copy gets up. */
export const SHARE_INTRO =
  "The files are copied into your cloud folder, and the app that syncs it does the uploading."

/**
 * What a take can go up to the cloud folder as, each with the line that
 * says what it is for. The share dialog offers them for one take, and
 * Settings › Folders picks one for What gets sent, which is what automatic
 * sending and Send starred send. Both say them in these words (B8).
 */
export const SHARE_OPTIONS: { id: ShareWhat; label: string; hint: string }[] = [
  {
    id: "mix",
    label: "The mix",
    hint: "One stereo file with the balance from the player. This is what you send people.",
  },
  {
    id: "tracks",
    label: "The original tracks",
    hint: "Every track as recorded, untouched, and the notes as .mid, to open in a DAW later.",
  },
  {
    id: "both",
    label: "Both",
    hint: "The mix to listen to, the tracks to work from.",
  },
]
