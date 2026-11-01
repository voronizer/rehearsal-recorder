import { asc, sql } from "drizzle-orm"
import type { Database } from "../shared/db"
import { same } from "../shared/names"
import { label, status } from "../shared/schema"

/** РЭХА's eight label colours, as it keeps them; "blue" is drawn orange. */
export const COLOURS = ["grey", "red", "amber", "green", "teal", "blue", "violet", "pink"] as const
export type Colour = (typeof COLOURS)[number]

/** A colour from РЭХА as one of the eight: any other is grey. */
export const colourOf = (colour: string): Colour => ((COLOURS as readonly string[]).includes(colour) ? (colour as Colour) : "grey")


/**
 * The band's labels for the marks of one take РЭХА sent, read once. A mark
 * sent under `label` gets the label of that name, or the one that had it
 * before a rename here, whatever colour РЭХА sent. Otherwise a new label at
 * the end, in РЭХА's colour; if another take made it a moment before, that
 * one. A mark with no label's name gets the first label, as in РЭХА.
 */
export async function labelsFor(db: Database, marks: { label: string; colour: string }[]): Promise<number[]> {
  if (!marks.length) return []
  const labels = await db.select().from(label).orderBy(asc(label.position))
  const ids: number[] = []
  for (const { label: name, colour } of marks) {
    if (!name.trim()) {
      ids.push(labels[0].id)
      continue
    }
    const found = labels.find((l) => same(l.name, name)) ?? labels.find((l) => l.was.some((w) => same(w, name)))
    if (found) {
      ids.push(found.id)
      continue
    }
    const values = { name: name.trim(), colour: colourOf(colour), position: (labels.at(-1)?.position ?? -1) + 1 }
    const [made] = await db.insert(label).values(values).onConflictDoNothing().returning()
    const row = made ?? (await db.select().from(label).where(sql`${label.name} = ${values.name} COLLATE NOCASE`).limit(1))[0]
    labels.push(row)
    ids.push(row.id)
  }
  return ids
}

/** The first status, which a new song gets. */
export async function firstStatus(db: Database): Promise<number> {
  const [first] = await db.select({ id: status.id }).from(status).orderBy(asc(status.position)).limit(1)
  return first.id
}

/** The first label, which a new mark gets. */
export async function firstLabel(db: Database): Promise<number> {
  const [first] = await db.select({ id: label.id }).from(label).orderBy(asc(label.position)).limit(1)
  return first.id
}
