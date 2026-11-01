import { asc } from "drizzle-orm"
import type { Database } from "../shared/db"
import { label, status } from "../shared/schema"

/** РЭХА's eight label colours, as it keeps them; "blue" is drawn orange. */
export const COLOURS = ["grey", "red", "amber", "green", "teal", "blue", "violet", "pink"] as const
export type Colour = (typeof COLOURS)[number]

/** A colour from РЭХА as one of the eight: any other is grey. */
export const colourOf = (colour: string): Colour => ((COLOURS as readonly string[]).includes(colour) ? (colour as Colour) : "grey")

/** Names match whatever their case, as SQLite's NOCASE does: in ASCII. */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The band's label for a mark РЭХА sent under `name`: the label of that
 * name, or the one that had it before a rename here, whatever colour РЭХА
 * sent. Otherwise a new label at the end, in РЭХА's colour. A mark with no
 * label's name gets the first label, as in РЭХА.
 */
export async function labelFor(db: Database, name: string, colour: string): Promise<number> {
  const labels = await db.select().from(label).orderBy(asc(label.position))
  if (!name.trim()) return labels[0].id
  const found = labels.find((l) => same(l.name, name)) ?? labels.find((l) => l.was.some((w) => same(w, name)))
  if (found) return found.id
  const [made] = await db
    .insert(label)
    .values({ name: name.trim(), colour: colourOf(colour), position: (labels.at(-1)?.position ?? -1) + 1 })
    .returning({ id: label.id })
  return made.id
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
