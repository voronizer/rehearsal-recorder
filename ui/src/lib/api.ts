/**
 * Typed wrapper around the pywebview bridge (window.pywebview.api), which
 * exposes the methods of api.py.
 *
 * Everything coming from the Python side is described here with one set of
 * types, so screens never have to guess what a take object contains.
 */

export type Device = {
  index: number
  name: string
  /** Which audio system it came through — only set when there is more than
   *  one, which in practice means Windows. */
  host_api: string
  max_input_channels: number
  max_output_channels: number
  default_samplerate: number
}

export type OutputDevice = Device

export type Track = {
  name: string
  channel: number
}

export type TrackFile = {
  name: string
  file: string
}

/** A take already saved to disk. */
export type Take = {
  take_number: number
  name: string
  duration_sec: number
  tracks: TrackFile[]
  /** Spots marked while listening back, in order. */
  markers?: Marker[]
  /** What of this take was copied into the cloud folder, if anything. */
  cloud?: CloudShare
  /** Why this take is not in the cloud folder, if something went wrong. */
  cloud_error?: string
}

/**
 * What a marker is for. The colour follows from it, so a glance at the
 * waveform says whether a take needs work or is the one to keep.
 */
export type MarkerKind = "note" | "good" | "issue" | "redo"

export type Marker = {
  /** Position in the take, in seconds. */
  at: number
  kind: MarkerKind
  note: string
}

/** Paths inside the cloud folder; empty means the take is not shared. */
export type CloudShare = {
  mix?: string
  mix_format?: CloudFormat
  tracks?: string
  tracks_format?: CloudFormat
  /** How much the mix had to be turned down to keep from clipping. */
  gain?: number
}

export type ShareWhat = "mix" | "tracks" | "both"

/** What the cloud copies are written as. */
export type CloudFormat = "wav" | "flac" | "mp3"

/** A take that was just stopped — still a draft, still unnamed. */
export type PendingTake = {
  ok: true
  take_number: number
  temp_dir: string
  duration_sec: number
  tracks: TrackFile[]
  suggested_name?: string
}

/** A take that was recorded but never saved (the app died mid-take). */
export type Draft = {
  dir: string
  name: string
  tracks: string[]
  duration_sec: number
  rehearsal_folder: string
  rehearsal_name: string
  created_at: string
}

export type SessionState =
  | { active: false }
  | {
      active: true
      name: string
      folder: string
      tracks: Track[]
      takes: Take[]
      next_take_number: number
      next_take_name: string
      recording: boolean
      /** Takes the app is copying to the cloud folder right now. */
      cloud_queue?: Record<number, "queued" | "working">
    }

/**
 * A song a rehearsal was spent on, and how many goes it got. Worked out from
 * the take names, which already carry it: "Polyn", "Polyn 2", "Polyn 3".
 */
export type Song = {
  name: string
  takes: number
}

export type RehearsalSummary = {
  folder: string
  name: string
  created_at: string
  take_count: number
  total_duration_sec: number
  /** Empty when the takes were never named — there is nothing to report. */
  songs: Song[]
  /** What the whole folder weighs, measured on disk rather than estimated. */
  disk_bytes: number
}

export type RehearsalDetail = {
  ok: boolean
  error?: string
  folder: string
  name: string
  created_at: string
  takes: Take[]
}

export type TrackTemplate = {
  device_index?: number
  samplerate?: number
  bit_depth?: number
  tracks?: Track[]
}

/** A track of a take as take_media returns it: address, length and waveform. */
export type TrackMedia = {
  name: string
  url: string | null
  error?: string
  frames: number
  samplerate: number
  duration_sec: number
  peaks: number[]
}

/** Player state on the Python side. */
export type PlayerState = {
  open?: boolean
  ok?: boolean
  error?: string
  playing?: boolean
  position?: number
  duration?: number
  finished?: boolean
  loop?: { a: number; b: number } | null
  soloed?: string | null
  muted?: string[]
  volumes?: Record<string, number>
  /** The chosen output could not be used and the system one was taken. */
  warning?: string
}

export type DeleteResult = {
  ok: boolean
  error?: string
  /** true — the system Trash; false — the _deleted folder. Never destroyed. */
  trashed?: boolean
  location?: string | null
  takes_left?: number
}

export type DiskEstimate = {
  ok: boolean
  error?: string
  free_bytes?: number
  bytes_per_sec?: number
  minutes?: number
  low?: boolean
}

export type RecordingHealth = {
  recording: boolean
  error?: string | null
  active?: boolean
  free_bytes?: number
  minutes_left?: number
  low_space?: boolean
}

export type Settings = {
  recordings_dir: string
  default_recordings_dir: string
  device_index: number | null
  samplerate: number | null
  bit_depth: number
  supported_bit_depths: number[]
  tracks: Track[]
  volumes: Record<string, number>
  theme: "dark" | "light" | "system"
  ui_scale: number
  output_device_index: number | null
  cloud_dir: string | null
  cloud_format: CloudFormat
  cloud_formats: { id: CloudFormat; label: string; hint: string }[]
  auto_publish: boolean
  auto_publish_what: ShareWhat
  /** Which encoder the machine has, if any. */
  encoder: string | null
  /** What to say when there is none — the reason differs by system. */
  encoder_hint: string | null
  /** "system" — a real Trash; "folder" — a _deleted folder instead. */
  trash_kind: "system" | "folder"
  fallback_trash: string
  /** Set on Windows when the recordings path is near the 260-character limit. */
  path_warning: string | null
  server_url: string
  config_path: string
  /** The release this was built from, or "unknown" outside a build. */
  version: string
}

type Ok<T = object> = { ok: boolean; error?: string } & T

type PyApi = {
  ping(): Promise<{ ok: boolean; message: string }>
  list_input_devices(): Promise<Device[]>
  list_output_devices(): Promise<OutputDevice[]>
  load_default_tracks(): Promise<TrackTemplate | null>
  save_default_tracks(config: TrackTemplate): Promise<Ok>
  media_url(absPath: string): Promise<string | null>
  take_media(tracks: TrackFile[], buckets?: number): Promise<TrackMedia[]>

  start_rehearsal(
    name: string,
    deviceIndex: number,
    samplerate: number,
    tracks: Track[],
    bitDepth?: number
  ): Promise<Ok<{ folder?: string }>>
  /** Which rate/depth combinations this input actually accepts. */
  recording_formats(
    deviceIndex: number,
    channelCount: number
  ): Promise<Ok<{ formats?: Record<string, number[]> }>>
  session_state(): Promise<SessionState>
  finish_rehearsal(): Promise<
    Ok<{ folder?: string; take_count?: number; folder_removed?: boolean }>
  >

  start_take(): Promise<Ok<{ take_number?: number }>>
  get_levels(): Promise<Record<string, number>>
  stop_take(): Promise<PendingTake | { ok: false; error: string }>
  keep_take(
    takeNumber: number,
    tempDir: string,
    customName: string,
    durationSec: number,
    tracks: TrackFile[],
    markers?: Marker[]
  ): Promise<Ok<{ take?: Take }>>
  discard_take(tempDir: string): Promise<Ok>
  /** Keep only [startSec, endSec) of a saved take; the rest goes to the Trash. */
  crop_take(
    folder: string,
    takeNumber: number,
    startSec: number,
    endSec: number
  ): Promise<Ok<{ take?: Take; markers_dropped?: number }>>
  /** The same, for a take that is still on the review screen. */
  crop_draft(
    tempDir: string,
    tracks: TrackFile[],
    startSec: number,
    endSec: number
  ): Promise<Ok<{ tracks?: TrackFile[]; duration_sec?: number }>>

  list_rehearsals(): Promise<RehearsalSummary[]>
  get_rehearsal(folder: string): Promise<RehearsalDetail>
  rename_take(
    folder: string,
    takeNumber: number,
    newName: string
  ): Promise<Ok<{ take?: Take }>>
  rename_rehearsal(
    folder: string,
    newName: string
  ): Promise<Ok<{ folder?: string; name?: string; takes?: Take[] }>>
  share_take(
    folder: string,
    takeNumber: number,
    what: ShareWhat
  ): Promise<
    Ok<{
      take?: Take
      cloud?: CloudShare
      needs_dir?: boolean
      /** Set when the copy was made but not in the chosen format. */
      note?: string
    }>
  >
  unshare_take(
    folder: string,
    takeNumber: number
  ): Promise<Ok<{ removed?: string[]; trashed?: boolean }>>
  set_cloud_dir(path: string): Promise<Ok<{ cloud_dir?: string }>>
  set_cloud_format(
    fmt: CloudFormat
  ): Promise<Ok<{ cloud_format?: CloudFormat; encoder?: string | null }>>
  set_auto_publish(
    enabled: boolean,
    what?: ShareWhat
  ): Promise<Ok<{ auto_publish?: boolean; auto_publish_what?: ShareWhat }>>
  set_recording_format(
    deviceIndex: number | null,
    samplerate: number,
    bitDepth: number
  ): Promise<Ok<{ device_index?: number | null; samplerate?: number; bit_depth?: number }>>
  choose_cloud_dir(): Promise<
    Ok<{ cloud_dir?: string; cancelled?: boolean }>
  >
  clear_cloud_dir(): Promise<Ok>

  delete_take(folder: string, takeNumber: number): Promise<DeleteResult>
  delete_rehearsal(folder: string): Promise<DeleteResult>

  add_take_marker(
    folder: string,
    takeNumber: number,
    seconds: number,
    note?: string,
    kind?: MarkerKind
  ): Promise<Ok<{ markers?: Marker[] }>>
  update_take_marker(
    folder: string,
    takeNumber: number,
    seconds: number,
    note?: string | null,
    kind?: MarkerKind | null
  ): Promise<Ok<{ markers?: Marker[] }>>
  remove_take_marker(
    folder: string,
    takeNumber: number,
    seconds: number
  ): Promise<Ok<{ markers?: Marker[] }>>

  list_drafts(): Promise<Draft[]>
  recover_draft(draftDir: string, name?: string): Promise<Ok<{ take?: Take }>>
  discard_draft(draftDir: string): Promise<DeleteResult>

  get_settings(): Promise<Settings>
  set_recordings_dir(path: string): Promise<Ok<{ recordings_dir?: string }>>
  choose_recordings_dir(): Promise<
    Ok<{ recordings_dir?: string; cancelled?: boolean }>
  >
  save_mix(volumes: Record<string, number>): Promise<Ok>
  save_appearance(theme: string, uiScale: number): Promise<Ok>
  set_output_device(deviceIndex: number | null): Promise<Ok>

  start_monitor(
    deviceIndex: number,
    samplerate: number,
    tracks: Track[]
  ): Promise<Ok>
  monitor_levels(): Promise<Record<string, number>>
  stop_monitor(): Promise<Ok>

  player_open(tracks: TrackFile[]): Promise<PlayerState>
  player_close(): Promise<Ok>
  player_state(): Promise<PlayerState>
  player_toggle(): Promise<PlayerState>
  player_play(): Promise<PlayerState>
  player_pause(): Promise<PlayerState>
  player_seek(seconds: number): Promise<PlayerState>
  player_set_loop(
    startSec: number | null,
    endSec: number | null
  ): Promise<PlayerState>
  player_set_volume(name: string, volume: number): Promise<Ok>
  player_set_muted(name: string, muted: boolean): Promise<PlayerState>
  player_set_solo(name: string | null): Promise<PlayerState>

  disk_estimate(
    trackCount: number,
    samplerate: number,
    bitDepth?: number
  ): Promise<DiskEstimate>
  recording_health(): Promise<RecordingHealth>
}

declare global {
  interface Window {
    pywebview?: { api: PyApi }
  }
}

/**
 * The bridge does not appear instantly: pywebview adds window.pywebview.api
 * and fires pywebviewready after the page has loaded.
 *
 * Listening for the event alone is not enough: the interface is served from a
 * local server and can load before the bridge is ready — but the reverse also
 * happens, the event fires before we subscribe, and then the app waits
 * forever (this was the "connecting to the audio engine" hang). So we poll,
 * and treat the event only as a shortcut.
 *
 * We check for a specific method rather than the api object itself, because
 * the object can show up empty.
 */
const API_POLL_INTERVAL_MS = 50

function apiIsReady(): boolean {
  return typeof window.pywebview?.api?.session_state === "function"
}

export function waitForApi(timeoutMs = 15000): Promise<PyApi> {
  return new Promise((resolve, reject) => {
    if (apiIsReady()) return resolve(window.pywebview!.api)

    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      window.clearInterval(poll)
      window.clearTimeout(timer)
      window.removeEventListener("pywebviewready", onReady)
      fn()
    }

    const check = () => {
      if (apiIsReady()) finish(() => resolve(window.pywebview!.api))
    }

    const onReady = () => check()
    const poll = window.setInterval(check, API_POLL_INTERVAL_MS)
    const timer = window.setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "The Python side did not respond. Restarting the app usually helps."
          )
        )
      )
    }, timeoutMs)

    window.addEventListener("pywebviewready", onReady)
    check()
  })
}

export function api(): PyApi {
  if (!window.pywebview?.api) {
    throw new Error("The bridge to Python is not ready yet")
  }
  return window.pywebview.api
}

/** The read-only calls the interface asks for over and over. */
type Pollable = {
  player_state: PlayerState
  get_levels: Record<string, number>
  monitor_levels: Record<string, number>
  recording_health: RecordingHealth
  session_state: SessionState
}

// Whether the http route works is decided once: either the interface is being
// served by the app's own server, or it is not.
let httpPolling: boolean | null = null

/**
 * Asks Python for something that is polled many times a second.
 *
 * Deliberately not over the pywebview bridge. Every call that crosses that
 * bridge starts an OS thread and makes the main thread hand the answer back
 * to JavaScript; at fourteen polls a second that is thousands of threads over
 * a rehearsal. The same call over the app's local server is an ordinary fetch
 * the webview handles itself.
 *
 * If the server is not there — the interface opened some other way — it falls
 * back to the bridge, which is slower but correct.
 */
export async function poll<K extends keyof Pollable>(
  name: K
): Promise<Pollable[K]> {
  if (httpPolling !== false) {
    try {
      const res = await fetch(`/api/${name}`, { cache: "no-store" })
      if (res.ok) {
        httpPolling = true
        return (await res.json()) as Pollable[K]
      }
      if (httpPolling === null) httpPolling = false
    } catch {
      if (httpPolling === null) httpPolling = false
    }
  }
  return (await api()[name]()) as Pollable[K]
}
