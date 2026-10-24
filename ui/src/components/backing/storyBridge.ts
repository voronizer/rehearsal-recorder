/**
 * A bridge for the showcase, so a song's backing track has something to
 * answer it: a file picked and counted at 104, bar 1 and the tempo saved as
 * they are, peaks with a beat in them, ▶ running on the page's clock, and
 * New song making any title it is given. Only the stories use it; the app's
 * bridge is pywebview's.
 */
export function stubBackingBridge() {
  let started: number | null = null
  const ok = async () => ({ ok: true })
  const w = window as unknown as { pywebview?: { api: Record<string, unknown> } }
  w.pywebview = {
    api: {
      ...w.pywebview?.api,
      pick_backing_file: async () => ({ ok: true, path: "/Music/Dym minus.mp3", name: "Dym minus.mp3" }),
      add_backing: async () => {
        await new Promise((r) => setTimeout(r, 1200))
        return { ok: true, name: "Dym minus.mp3", seconds: 208, channels: 2, tempo: 104, first_bar: 2.1 }
      },
      remove_backing: ok,
      add_song: async (title: string) => ({ ok: true, id: 3, title }),
      set_backing_first_bar: async (_id: number, seconds: number) => ({ ok: true, first_bar: seconds }),
      set_backing_tempo: async (_id: number, tempo: number) => ({ ok: true, tempo }),
      set_song_tempo: async (id: number, tempo: number | null, signature: string | null) => ({
        ok: true,
        id,
        tempo,
        signature,
      }),
      song_backing_peaks: async (_id: number, end: number, buckets: number) => {
        const row = Array.from({ length: buckets }, (_, i) => {
          const t = ((i + 0.5) * end) / buckets
          if (t < 0.8) return 0.02
          const p = (t - 0.8) % (60 / 128)
          return 0.18 + 0.6 * Math.exp(-p / 0.06)
        })
        return { ok: true, peaks: [row, row.map((v) => v * 0.85)] }
      },
      backing_play: async () => {
        started = performance.now()
        return { ok: true }
      },
      backing_stop: async () => {
        started = null
        return { ok: true }
      },
      metronome_play: async () => {
        started = null
        return { ok: true }
      },
      metronome_stop: ok,
      metronome_state: async () => ({
        phase: "idle",
        tempo: null,
        signature: "4/4",
        per_bar: 4,
        on: true,
        case: "free",
        song: null,
        held: false,
        last_take: null,
        upcoming: [],
        count: 0,
        since_count_in_ms: null,
        output_missing: null,
        backing: {
          song: null,
          on: true,
          volume: 0.8,
          row: true,
          playing: started !== null,
          position_sec: started === null ? 0 : (performance.now() - started) / 1000,
          output_missing: null,
          getting_ready: false,
          free: false,
        },
      }),
    },
  }
}
