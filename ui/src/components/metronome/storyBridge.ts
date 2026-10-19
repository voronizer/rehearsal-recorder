/**
 * A bridge for the showcase, so the metronome's settings have something to
 * read and save: two outputs, the settings as Python starts with them, and
 * every change kept for as long as the page is open; and a song's tempo
 * saved and counted, and the click with a take, for the pieces that ask. Only the stories use
 * it; the app's bridge is pywebview's. `saved` changes the settings it
 * starts with, and `missing` names a click output that is not plugged in.
 */
export function stubBridge(saved: Record<string, unknown> = {}, missing: string | null = null) {
  const settings: Record<string, unknown> = {
    click_device_index: null,
    click_channels: null,
    click_sound: "click",
    click_volume: 0.7,
    count_in_bars: 1,
    tempo_in_wav: true,
    metronome_on: true,
    output_device_index: 3,
    output_channels: [1, 2],
    ...saved,
  }
  const ok = async () => ({ ok: true })
  const w = window as unknown as { pywebview?: { api: Record<string, unknown> } }
  w.pywebview = {
    api: {
      ...w.pywebview?.api,
      get_settings: async () => ({ ...settings }),
      list_output_devices: async () => [
        { index: 1, name: "MacBook Pro Speakers", host_api: "Core Audio", max_input_channels: 0,
          max_output_channels: 2, default_samplerate: 48000, click_unavailable: null },
        { index: 3, name: "X18", host_api: "Core Audio", max_input_channels: 18,
          max_output_channels: 6, default_samplerate: 48000, click_unavailable: null },
      ],
      set_click_device: async (index: number | null) => {
        settings.click_device_index = index
        settings.click_channels = index === null ? null : [1, 2]
        return { ok: true }
      },
      set_click_channels: async (channels: number[]) => {
        settings.click_channels = channels
        return { ok: true }
      },
      set_metronome_setting: async (key: string, value: unknown) => {
        settings[key] = value
        return { ok: true }
      },
      metronome_preview: ok,
      metronome_tap_listen: ok,
      metronome_taps: async () => ({ ms_ago: [] }),
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
        output_missing: missing,
      }),
      metronome_set: ok,
      metronome_play: ok,
      metronome_stop: ok,
      // A song's page: its tempo saved as it is, and a count of 104 a
      // quarter (208 eighths in 6/8).
      set_song_tempo: async (id: number, tempo: number | null, signature: string | null) => ({
        ok: true,
        id,
        title: "Dym",
        tempo,
        signature: tempo === null ? null : signature,
      }),
      count_tempo: async (_folder: string, _take: number, signature: string) => ({
        ok: true,
        tempo: signature === "6/8" ? 208 : 104,
      }),
      player_set_click: ok,
    },
  }
}
