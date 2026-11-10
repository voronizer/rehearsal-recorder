import { CalendarDays, Diamond, House, ListMusic, Music, Trash2, Users, type LucideIcon } from "lucide-react"

export type SectionTo = "/" | "/rehearsals" | "/songs" | "/sets" | "/marks" | "/members" | "/trash"

/** The band's sections in the column on the left, each with its icon; a pill to a song or a rehearsal has the same one. */
export const SECTIONS: [SectionTo, string, LucideIcon][] = [
  ["/", "Home", House],
  ["/rehearsals", "Rehearsals", CalendarDays],
  ["/songs", "Songs", Music],
  ["/sets", "Sets", ListMusic],
  ["/marks", "Marks", Diamond],
  ["/members", "Members", Users],
  ["/trash", "Trash", Trash2],
]

/** A section's icon, by its address. */
export const sectionIcon = (to: SectionTo): LucideIcon => SECTIONS.find(([t]) => t === to)![2]
