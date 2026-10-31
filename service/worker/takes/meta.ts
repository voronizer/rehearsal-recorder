import { z } from "@hono/zod-openapi"

/** A take's details as РЭХА sends them with PUT /api/reha/takes/:uid. */
export const TakeMeta = z
  .object({
    rehearsal: z.object({
      uid: z.uuid(),
      name: z.string(),
      /** A calendar day, with no time zone. */
      date: z.iso.date(),
    }),
    number: z.int().min(1),
    name: z.string().min(1),
    /** null for a take nobody named. */
    song: z.string().trim().min(1).nullable(),
    duration_sec: z.number().min(0),
    /** 1, and one more for each crop. */
    gen: z.int().min(1),
    /** What the crops since the generation the service shows took off the start. */
    cut_start: z.number().min(0),
    starred: z.boolean(),
    balance: z.record(z.string(), z.number()),
    tracks: z.array(
      z.object({
        position: z.int().min(1),
        name: z.string(),
        icon: z.string().nullable(),
        files: z.array(z.string()),
      })
    ),
    notes: z.array(z.object({ position: z.int().min(1), name: z.string(), file: z.string() })),
    marks: z.array(z.object({ at: z.number().min(0), label: z.string(), colour: z.string(), note: z.string() })),
  })
  .openapi("TakeMeta")

export type TakeMeta = z.infer<typeof TakeMeta>

/** The names of the files a take's details list. */
export const fileNames = (row: { tracks: { files: string[] }[]; notes: { file: string }[] }) =>
  new Set([...row.tracks.flatMap((t) => t.files), ...row.notes.map((n) => n.file)])
