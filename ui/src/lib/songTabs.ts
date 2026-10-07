import type { SongGo, Take } from "@/lib/api"

/**
 * One tab of the player's strip: a song and its goes that evening, in the
 * order played, or a take nobody named, which is a tab of its own. `key` is
 * `song:<title>`, or `take:<n>` for a take with no song: a song can be
 * called anything, "take:3" included, and must not share a key with take 3.
 */
export type SongTab = { key: string; song: string | null; takes: Take[] }

/** The strip's tabs, in the order each song was first played. */
export function songTabs(takes: Take[]): SongTab[] {
  const tabs: SongTab[] = []
  const bySong = new Map<string, SongTab>()
  for (const take of takes) {
    const song = take.song ?? null
    if (song === null) {
      tabs.push({ key: `take:${take.take_number}`, song: null, takes: [take] })
      continue
    }
    const tab = bySong.get(song)
    if (tab) {
      tab.takes.push(take)
    } else {
      const fresh = { key: `song:${song}`, song, takes: [take] }
      bySong.set(song, fresh)
      tabs.push(fresh)
    }
  }
  return tabs
}

/** The go a click on a tab opens: the song's last of the evening. */
export function lastPlayed(tab: SongTab): Take {
  return tab.takes[tab.takes.length - 1]
}

/**
 * A song's goes as the player goes through them from its page: the oldest
 * rehearsal first, in the order played within one. Goes from a rehearsal
 * whose folder is not on disk are left out, since they cannot be opened.
 */
export function goesByTime(goes: SongGo[]): SongGo[] {
  const rehearsals = new Map<string, SongGo[]>()
  for (const go of goes) {
    if (go.missing) continue
    const list = rehearsals.get(go.folder)
    if (list) list.push(go)
    else rehearsals.set(go.folder, [go])
  }
  // A stable sort: two rehearsals begun the same second keep the order
  // they came in.
  return [...rehearsals.values()]
    .sort((a, b) => a[0].created_at.localeCompare(b[0].created_at))
    .flat()
}

/** The one before (`-1`) or after (`1`) the place `at`, or nothing. */
export function neighbour<T>(list: T[], at: number, dir: -1 | 1): T | null {
  if (at < 0 || at >= list.length) return null
  return list[at + dir] ?? null
}
