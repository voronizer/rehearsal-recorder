import { z } from "@hono/zod-openapi"

export const Signature = z.enum(["4/4", "3/4", "2/4", "6/8"])
export type Signature = z.infer<typeof Signature>

/** A song's tempo as РЭХА's metronome keeps it: a whole number from 30 to
 *  300, from 60 to 600 in 6/8, where it counts eighths. */
export const TEMPO_RANGE: Record<Signature, readonly [number, number]> = {
  "4/4": [30, 300],
  "3/4": [30, 300],
  "2/4": [30, 300],
  "6/8": [60, 600],
}

/** Why a tempo cannot be the song's, or null when it can. */
export function tempoRefused(tempo: number, signature: Signature): string | null {
  const [low, high] = TEMPO_RANGE[signature]
  return Number.isInteger(tempo) && tempo >= low && tempo <= high ? null : `A tempo in ${signature} is a whole number from ${low} to ${high}`
}

/** A take's click as РЭХА keeps it. One recorded with the click off has a
 *  tempo and `click` false; one with no tempo has neither. */
export const Meter = z
  .object({ tempo: z.number().positive().max(999).nullable(), signature: Signature.nullable(), click: z.boolean() })
  .openapi("Meter")

/** The band's tempo through a take, bar by bar, as РЭХА counts it
 *  (take_drift, audio/drift.py), or why there is none: too short, or no
 *  steady beat. */
export const Drift = z
  .discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      source: z.enum(["drums-mid", "drums", "mix"]),
      per_bar: z.number().positive(),
      middle: z.number().positive(),
      aim: z.object({
        tempo: z.number().positive(),
        signature: Signature,
        from: z.enum(["click", "take", "song", "middle"]),
        song: z.string().nullable(),
      }),
      // An hour at 240 a minute is 3600 bars of 4/4.
      bars: z
        .array(z.object({ n: z.int().min(1), start: z.number().min(0), end: z.number().min(0), tempo: z.number().positive().nullable() }))
        .max(20000),
    }),
    z.object({ ok: z.literal(false), why: z.enum(["short", "no-beat"]) }),
  ])
  .openapi("Drift")

/** A take's details as РЭХА sends them with PUT /api/reha/takes/:uid. */
export const TakeMeta = z
  .object({
    rehearsal: z.object({
      uid: z.uuid(),
      name: z.string(),
      /** A calendar day, with no time zone. */
      date: z.iso.date(),
    }),
    /** Its place in its rehearsal, which orders the evening's takes and is
     *  never shown. The take's own number, at its song or among the takes
     *  with no song, is the end of its name. */
    number: z.int().min(1),
    /** Its name, sent with its song when РЭХА changed which song it is a
     *  take of (or its number there), and the first time. Left out, the take
     *  keeps its song and name, so a ★ does not undo a move made here. */
    name: z.string().min(1).optional(),
    /** Its song by number, null for a take nobody named. */
    song_id: z.int().min(1).nullable().optional(),
    /** Its song by title, made when the band has none, for a song РЭХА has
     *  no number for yet; null for a take nobody named. */
    song: z.string().trim().min(1).nullable().optional(),
    duration_sec: z.number().min(0),
    /** 1, and one more for each crop. */
    gen: z.int().min(1),
    /** What the crops since the generation the service shows took off the
     *  start; below 0 when a crop was undone and the start put back. */
    cut_start: z.number(),
    starred: z.boolean(),
    balance: z.record(z.string(), z.number()),
    tracks: z.array(
      z.object({
        position: z.int().min(1),
        name: z.string(),
        icon: z.string().nullable(),
        files: z.array(z.string()),
        /** "backing" for the take's Backing track. Missing from РЭХА 0.24 and older. */
        kind: z.literal("backing").optional(),
      })
    ),
    /** `icon` is the track's; missing from РЭХА 0.21 and older. */
    notes: z.array(
      z.object({ position: z.int().min(1), name: z.string(), file: z.string(), icon: z.string().nullable().optional() })
    ),
    marks: z.array(z.object({ at: z.number().min(0), label: z.string(), colour: z.string(), note: z.string() })),
    /** The take's own click. Missing from РЭХА 0.21 and older: the take
     *  keeps what it had. */
    meter: Meter.optional(),
    /** Sent with the cloud button or **Send starred**: a take the band
     *  deleted comes out of the trash only then. Missing from РЭХА 0.20
     *  and older. */
    by_hand: z.boolean().optional(),
  })
  .refine((m) => (m.song_id === undefined && m.song === undefined) || m.name !== undefined, {
    error: "A take's song goes with its name",
  })
  .openapi("TakeMeta")

export type TakeMeta = z.infer<typeof TakeMeta>
export type Drift = z.infer<typeof Drift>

/** The names of the files a take's details list. */
export const fileNames = (row: { tracks: { files: string[] }[]; notes: { file: string }[] }) =>
  new Set([...row.tracks.flatMap((t) => t.files), ...row.notes.map((n) => n.file)])
