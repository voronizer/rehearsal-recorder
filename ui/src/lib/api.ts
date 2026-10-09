/**
 * Typed wrapper around the pywebview bridge (window.pywebview.api), which
 * exposes the methods of api.py.
 *
 * Everything coming from the Python side is described here with one set of
 * types, so screens never have to guess what a take object contains.
 */

import { reportBridgeError } from "@/lib/bridgeErrors"

export type Device = {
  index: number
  name: string
  /** Which audio system (driver) it came through. Settings groups by it and
   *  only shows it when there is more than one. */
  host_api: string
  max_input_channels: number
  max_output_channels: number
  default_samplerate: number
}

export type OutputDevice = Device

export type Track = {
  name: string
  /** Two adjacent inputs — `channel` and the one after it — written as one
   *  two-channel file. A property of the instrument, so it travels with the
   *  band between interfaces. */
  stereo?: boolean
  /** The icon chosen for it on the setup screen, a key of
   *  components/InstrumentIcon. Kept with the band, like stereo. */
  icon?: string
  /** The interface input this track comes from, counted from 1. null when
   *  the layout came from a card with more inputs than this one has and
   *  nobody has yet said who plays and who sits out, and for a track that
   *  records MIDI only, which has no input. */
  channel: number | null
  /** What it records: its sound, its notes or both. Left out, it records
   *  sound, as every band saved before MIDI does (lib/midi.ts modeOf). */
  mode?: RecordMode
  /** The port its notes come from, for a track on Both or MIDI. Python
   *  keeps only what the system said of it; null while none is picked. */
  midi_port?: MidiPortRef | null
}

/** What a track records: its audio, its MIDI notes, or both. The words are
 *  the ones the band's config and the database keep. */
export type RecordMode = "audio" | "both" | "midi"

/** A MIDI port as a band keeps it: the name first, and whatever else the
 *  system said of it, which finds the port again when its name changes. */
export type MidiPortRef = {
  name: string
  device?: string
  maker?: string
  id?: string
}

/**
 * A track of a rehearsal that is running. Its input is settled: a rehearsal
 * cannot start while any track that records sound is still waiting for one,
 * so nothing past the setup screen has to ask.
 */
export type PlacedTrack = {
  name: string
  /** null for a track that records MIDI only: it has no input. Every other
   *  track has one by now. */
  channel: number | null
  /** Two adjacent inputs, written as one two-channel file. */
  stereo?: boolean
  icon?: string
  mode?: RecordMode
  midi_port?: MidiPortRef | null
}

export type TrackFile = {
  name: string
  file: string
}

/** A take's notes of one track: the .mid saved beside the audio. `port` is
 *  the name of the port they came from. `after` is the audio track whose lane
 *  this one follows in the player (a Both track's own name), or null to go
 *  first; Python works it out from the band's order (rules.lane_after) and
 *  lib/midi.ts laneOrder lays the lanes out by it. */
export type NotesFile = {
  name: string
  file: string
  port: string
  after: string | null
}

/** A track that takes notes and has no .mid in this take: its port was not
 *  plugged in the whole take. Placed by `after` as a NotesFile is. */
export type MissingNotes = {
  name: string
  port: string
  after: string | null
}

/** A take already saved to disk. */
export type Take = {
  take_number: number
  name: string
  /** The song this take is a go at, or null for a take nobody named. Its
   *  name ("Polyn 3") follows from the two. */
  song?: string | null
  /** Which go at the song this is, counted across the library; null with no
   *  song. */
  go?: number | null
  /** ★: somebody starred this take as one worth coming back to. A song can
   *  have several, and a take with no song can have one. */
  starred?: boolean
  duration_sec: number
  /** The audio files only, as always. */
  tracks: TrackFile[]
  /** The .mid files beside them, for the tracks that took notes. Read a
   *  list that is not there as none: takes from before MIDI have no notes. */
  notes?: NotesFile[]
  /** Tracks that take notes and got none in this take. */
  notes_missing?: MissingNotes[]
  /** Spots marked while listening back, in order. */
  markers?: Marker[]
  /** What of this take was copied into the cloud folder, if anything. */
  cloud?: CloudShare
  /** Why this take is not in the cloud folder, if something went wrong. */
  cloud_error?: string
}

/** A label's colour, by name. What it looks like is the theme's:
 *  --label-<name> in index.css. */
export type LabelColour =
  | "grey"
  | "red"
  | "amber"
  | "green"
  | "teal"
  | "blue"
  | "violet"
  | "pink"

/**
 * What a mark can be called: a name and a colour the band made in Settings ›
 * Marks. It means nothing else to the app.
 */
export type Label = {
  id: number
  name: string
  colour: LabelColour
  /** How many marks have it, in every rehearsal. */
  marks: number
  /** In how many rehearsals, and the newest of them (null with no marks):
   *  under the label in History's Marks view. */
  rehearsals?: number
  last_marked?: string | null
}

/** What a change to the labels answers: all of them, as they are now. */
export type LabelsAnswer = Ok<{ labels?: Label[] }>

/** What a change to the sets answers: every set as it now is. */
export type SetsAnswer = Ok<{ sets?: SongSet[] }>

export type Marker = {
  /** Position in the take, in seconds. */
  at: number
  /** Its label, one of list_labels()'s. */
  label_id: number
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
  /** The .mid files stop_take made, and the tracks that have none: keep_take
   *  and crop_draft are handed the first again. */
  notes?: NotesFile[]
  notes_missing?: MissingNotes[]
  suggested_name?: string
  /** The name it would have had with none picked before recording: what ✕
   *  in the review screen's name field puts back. */
  default_name?: string
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
      tracks: PlacedTrack[]
      takes: Take[]
      /** The takes grouped into songs, by Python's rule. */
      songs: Song[]
      next_take_number: number
      next_take_name: string
      /** The go beside the name field's title; null with no song. */
      next_take_go?: number | null
      /** What the next take would be called without a name picked for it. */
      next_take_default?: string
      /** The latest go at the song the next take is named for, if any. */
      last_attempt?: LastAttempt | null
      /** The set this rehearsal plays by, as it kept it at Start; null when
       *  it plays freely. */
      set?: RehearsalSet | null
      recording: boolean
      /** Takes the app is copying to the cloud folder right now. */
      cloud_queue?: Record<number, "queued" | "working">
      /** How much of the disk the rehearsal's folder uses, for the header. */
      disk_bytes?: number
    }

/**
 * How long the last go at a song ran, for the recording screen's
 * "Took 2:21 last time". Python finds it by the same rule as `songs`.
 */
export type LastAttempt = {
  song: string
  duration_sec: number
  /** The day of the rehearsal it was played at, when that was before
   *  tonight: "Took 3:05 on 28 Sep". Left out for a go tonight. */
  created_at?: string | null
}

/** A song in a set: its title now, or as typed when no song has it yet
 *  (`new`: a song not played yet, which Settings › Sets says). */
export type SetSong = { title: string; new: boolean }

/** A set of songs in the order the band means to play them (Settings ›
 *  Sets), as list_sets gives them. */
export type SongSet = { id: number; name: string; songs: SetSong[] }

/** The copy of a set a rehearsal keeps from its start: editing or deleting
 *  the set later leaves it as it was. */
export type RehearsalSet = { name: string; songs: SetSong[] }

/**
 * A song a rehearsal was spent on, and how many goes it got. Worked out from
 * the take names, which already carry it: "Polyn", "Polyn 2", "Polyn 3".
 */
export type Song = {
  name: string
  takes: number
  /** Which takes they were. Sent with an open rehearsal, for its overview;
   *  the history list has only the count. */
  take_numbers?: number[]
}

/**
 * A stretch of an evening spent on one song, as history draws a rehearsal:
 * its goes in the order played, each as its length and whether it is starred.
 * Python cuts the evening into these, by the same rule as `songs`.
 */
export type Run = {
  /** null for takes the app named itself. */
  song: string | null
  takes: { duration_sec: number; starred: boolean }[]
}

export type RehearsalSummary = {
  folder: string
  name: string
  created_at: string
  take_count: number
  total_duration_sec: number
  /** Empty when the takes were never named — there is nothing to report. */
  songs: Song[]
  /** The evening in order, song by song. */
  runs?: Run[]
  /** What the whole folder weighs, measured on disk rather than estimated. */
  disk_bytes: number
  /** How many of its takes have a copy in the cloud folder. */
  in_cloud?: number
  /** The folder is not on disk — deleted, renamed outside the app, or on a
   *  drive that is not plugged in. */
  missing?: boolean
  /** The name of the set it was played by, if any. */
  set_name?: string | null
}

export type RehearsalDetail = {
  ok: boolean
  error?: string
  folder: string
  name: string
  created_at: string
  takes: Take[]
  songs: Song[]
  /** The folder is not on disk — deleted, renamed outside the app, or on a
   *  drive that is not plugged in. */
  missing?: boolean
  /** The set it was played by, as it kept it; null when it was played
   *  freely. */
  set?: RehearsalSet | null
}

/** A song a take can be named after, and the go naming it so would make. */
export type SongChoice = {
  /** The title: what a pill puts in the name field. */
  song: string
  /** The go a take would be as this song. */
  go: number
  /** On a song this rehearsal played: the number of its latest take. */
  last_take?: number
  /** Titles the song had, or songs merged into it: typed, they are this
   *  song too (Library._resolve). */
  also?: string[]
}

/** The songs a take can be named after (api.song_choices): what its own
 *  rehearsal played, in order, and every other, the most recent first. */
export type SongChoices = { here: SongChoice[]; other: SongChoice[] }

/** What a song's ▶ plays (api.last_time): its newest ★ go, from whichever
 *  rehearsal it was played at, or with none its last go at the rehearsal it
 *  is listed under. */
export type SongPlays = {
  folder: string
  rehearsal: string
  created_at: string
  take: Take
}

/** History's three views (api.save_history_view). */
export type HistoryView = "rehearsals" | "songs" | "marks"

/** How History's Marks view groups a label's marks
 *  (api.save_marks_grouping). */
export type MarksGrouping = "rehearsal" | "song" | "list"

/** One mark with a label, from any rehearsal (api.list_marks): what its row
 *  in History's Marks view shows. The take itself is read from its
 *  rehearsal when it is played or opened. `missing` is the rehearsal's
 *  folder not being on disk. */
export type MarkHit = {
  folder: string
  rehearsal: string
  created_at: string
  missing: boolean
  take_number: number
  name: string
  song: string | null
  duration_sec: number
  at: number
  note: string
}

/** A label's marks, newest rehearsal first, then the take, then the moment. */
export type MarksAnswer = Ok<{ marks?: MarkHit[] }>

/** A song in History's Songs view (api.list_songs): how many goes it got,
 *  at how many rehearsals, when, and how many of them have ★. Rehearsals
 *  whose folder is not on disk are counted too. */
export type SongSummary = {
  id: number
  title: string
  goes: number
  rehearsals: number
  first_played: string
  last_played: string
  starred: number
  /** Its old names: titles it had, and songs merged into it. */
  also: string[]
}

/** The takes nobody named, as the last row of the Songs view. */
export type NotNamedSummary = { takes: number; rehearsals: number; last_played: string }

/** Every song with a go, and the takes with no song (api.list_songs). */
export type SongIndex = { songs: SongSummary[]; not_named: NotNamedSummary | null }

/** One go at a song, with the rehearsal it was played at (api.get_song).
 *  `missing` is that rehearsal's folder not being on disk. */
export type SongGo = {
  folder: string
  rehearsal: string
  created_at: string
  missing: boolean
  take: Take
}

/** A song's page (api.get_song): its goes from every rehearsal, the newest
 *  rehearsal first and the order played within one, and what its ▶ plays.
 *  `id` and `title` are null for the takes nobody named. */
export type SongDetail = {
  ok: boolean
  error?: string
  id?: number | null
  title?: string | null
  /** Its old names, which typed are this song too. */
  also?: string[]
  plays?: SongPlays | null
  goes?: SongGo[]
}

/** A song renamed (api.rename_song). Refused because the title is another
 *  song's, title or old name, `into` is that song: merging into it is what
 *  to offer. */
export type RenameSongAnswer = Ok<{
  title?: string
  goes?: number
  into?: { id: number; title: string } | null
}>

/** A song merged into another, or asked about first (api.merge_songs): how
 *  many goes from how many rehearsals, and the goes they become. */
export type MergeAnswer = Ok<{
  into?: string
  goes?: number
  rehearsals?: number
  first?: number | null
  last?: number | null
}>

/**
 * What the setup screen says about the rehearsals before this one
 * (api.last_time): the last one song by song, the songs it left out, and
 * the few after it in history's list.
 */
export type LastTime = {
  /** The newest rehearsal on disk that played a song, or with none named,
   *  the newest with takes. */
  last: {
    folder: string
    name: string
    created_at: string
    takes: Take[]
    songs: (Song & { plays: SongPlays })[]
    runs: Run[]
    in_cloud: number
  } | null
  /** Songs of older rehearsals that the last one did not play, the latest
   *  time each was played first, with the last go it got then. */
  not_played: {
    name: string
    folder: string
    /** The rehearsal it was last played at. */
    rehearsal: string
    created_at: string
    goes: number
    take: Take
    /** What its ▶ plays. */
    plays: SongPlays
  }[]
  earlier: {
    folder: string
    name: string
    created_at: string
    take_count: number
    total_duration_sec: number
    missing: boolean
  }[]
  /** Every rehearsal in history. */
  count: number
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
  /** The band's icon for this name, when it has one. */
  icon?: string
  url: string | null
  error?: string
  frames: number
  samplerate: number
  duration_sec: number
  /** One row per channel: a stereo track has two. */
  peaks: number[][]
}

/**
 * The MIDI ports the system lists (api.list_midi_ports): a port as the band
 * keeps it, and how many notes it has sent since the counts last started
 * again, which only a port that is open says anything about (a track's, or one
 * the check opened).
 */
export type MidiPort = MidiPortRef & { notes: number }

export type MidiPorts = {
  /** The MIDI system in use, or null when there is none. */
  system: string | null
  /** A device's playing port first. */
  ports: MidiPort[]
  /** Why there is no MIDI system, in words; null when there is one. */
  error: string | null
}

/** How a track's port stands: "ok" is open and heard as there; "missing" not
 *  plugged in, or gone quiet; "in_use" held by another app; "ambiguous" two
 *  ports it could be; "none" no port picked. */
export type MidiState = "ok" | "missing" | "in_use" | "ambiguous" | "none"

/** What one track that takes notes is doing (api.midi_activity). */
export type MidiTrackActivity = {
  /** The loudest note-on since the last call, 0..1. */
  vel: number
  /** Note-ons since the counts last started again: this check, this take. */
  notes: number
  /** Whether `state` is "ok". */
  connected: boolean
  state: MidiState
  /** The track whose notes this port gets too: probably one instrument
   *  plugged in twice. */
  echo?: string
}

/** Every track that takes notes, by name. */
export type MidiActivity = Record<string, MidiTrackActivity>

/**
 * One track's notes, read back from its .mid for the player (api.take_notes).
 * Times are seconds from the take's start. Drums come as the six rows (plus
 * "Other" when a note falls outside them) and a note's third figure is its
 * row, counted from 0 at the top; anything else comes by pitch, from `low` to
 * `high` (whole octaves, C to B). The fourth is the velocity as the .mid has
 * it.
 */
export type TakeNotes =
  | { name: string; error: string }
  | {
      name: string
      drums: true
      rows: string[]
      /** [start, length, row, velocity] */
      notes: [number, number, number, number][]
    }
  | {
      name: string
      drums: false
      low: number
      high: number
      /** [start, length, pitch, velocity] */
      notes: [number, number, number, number][]
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
  /** 0..1, how loud the whole mix plays, after every track's fader. */
  master?: number
  /** 0..1, the whole mix as it went out a moment ago; past full scale reads
   *  1. Zero while paused. */
  master_level?: number
  /** 0..1 per channel of each track, as it came out of the mix a moment
   *  ago. A list even for a mono track, so one shape serves both. */
  levels?: Record<string, number[]>
  /** The chosen output could not be used and the system one was taken. */
  warning?: string
  /** Why playback stopped by itself: the output went quiet under it. Stays
   *  until an output is opened again, which the next play does. */
  problem?: string | null
  /** This play had to open the output again first; `warning` says where it
   *  went if not to the chosen card. */
  reopened?: boolean
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

/** One piece of long work — see activity.py. */
export type ActivityEntry = {
  id: number
  kind: "cloud" | "crop" | "stop" | "recover" | "names"
  title: string
  folder: string | null
  take_number: number | null
  state: "waiting" | "running" | "done" | "failed"
  fraction: number
  step: string | null
  error: string | null
  detail: string | null
  /** What to copy again, on a failed cloud copy. */
  retry: string | null
  seen: boolean
}

export type Activity = {
  /** Running and waiting first, then the last twenty finished, newest first. */
  entries: ActivityEntry[]
  /** A take is being recorded: cloud copies wait until it stops. */
  recording: boolean
}

/** Whether the card is still sending while the signal is checked. */
export type MonitorHealth = {
  checking: boolean
  problem: string | null
}

export type RecordingHealth = {
  recording: boolean
  error?: string | null
  active?: boolean
  free_bytes?: number
  minutes_left?: number
  low_space?: boolean
  /** On battery: its charge, 0 to 100. Null on mains or with no battery. */
  battery_percent?: number | null
}

/** One of the app's own files, for Under the hood's Show buttons. */
export type OwnFile = {
  key: "settings" | "history" | "crash_log"
  path: string
  exists: boolean
  size: number | null
  modified: string | null
}

/** What this copy of the app runs on — see api.under_the_hood. */
export type UnderTheHood = {
  version: string
  running_as: "built" | "source"
  executable: string
  system: string
  audio: {
    engine: string | null
    /** Each audio system PortAudio found, with how many devices it lists. */
    systems: { name: string; devices: number }[]
    recording: {
      name: string
      host_api: string
      inputs: number
      samplerate: number
      bit_depth: number
      /** Saved, but not plugged in. */
      missing?: boolean
    } | null
    playback: string
  }
  files: OwnFile[]
  deleting: "system" | "folder"
  fallback_trash: string
  /** Its version when copies can be compressed, else null. */
  libsndfile: string | null
  server_url: string
  releases_url: string
}

/** One way the check opened the card, and what came of it. */
export type CheckRow = {
  label: string
  opened: boolean
  flowing: boolean
  frames: number
  expected: number
  error: string | null
}

/** The check of the interface, as far as it has got — see probe.InterfaceCheck. */
export type InterfaceCheck = {
  running: boolean
  stopped?: boolean
  device?: {
    name: string
    host_api: string
    channels: number
    samplerate: number
    bit_depth: number
  }
  rows?: CheckRow[]
  verdict?: { cause: string; headline: string; advice: string } | null
  /** Each input's loudest moment, 0..1, when the settings in force worked. */
  peaks?: number[] | null
  signal?: string | null
  checked_at?: string | null
}

export type Settings = {
  recordings_dir: string
  default_recordings_dir: string
  device_index: number | null
  /** The saved recording interface when it is not plugged in. */
  missing_device: { name: string; host_api: string } | null
  samplerate: number | null
  bit_depth: number
  supported_bit_depths: number[]
  volumes: Record<string, number>
  /** 0..1, how loud takes play back: lib/listening.ts. */
  master_volume: number
  theme: "dark" | "light" | "system"
  /** Which of History's views it opens on: the one used last. */
  history_view?: HistoryView
  /** How its Marks view groups a label's marks. */
  marks_grouping?: MarksGrouping
  /** The set picked beside Start rehearsal, kept across restarts; null to
   *  play freely, and when that set is gone. */
  next_set: number | null
  ui_scale: number
  output_device_index: number | null
  /** Outputs of that card the mix comes out of, from 1: [3, 4] or [5]. */
  output_channels: number[]
  cloud_dir: string | null
  cloud_format: CloudFormat
  cloud_formats: { id: CloudFormat; label: string; hint: string }[]
  auto_publish: boolean
  auto_publish_what: ShareWhat
  /** A take shorter than this, with no ★ and no marks, is a false start. */
  false_start_sec: number
  /** Whether the app asks GitHub if a newer version is out — updates.py. */
  check_updates: boolean
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
  /** The band placed on the interface in force. Without `band`, the saved
   *  one; with it, those names, stereo switches and icons — what is on
   *  screen. */
  load_default_tracks(
    band?: Pick<Track, "name" | "stereo" | "icon" | "mode" | "midi_port">[]
  ): Promise<TrackTemplate | null>
  /** Looks for interfaces again — one plugged in after the app started is
   *  not listed until it does. Refused while recording. `found` and `gone`
   *  are device names. */
  rescan_devices(): Promise<
    Ok<{ found?: string[]; gone?: string[]; warning?: string }>
  >
  save_default_tracks(config: TrackTemplate): Promise<Ok>
  media_url(absPath: string): Promise<string | null>
  /** A track's address, length and waveform. A range narrows the waveform to
   *  the part on screen; the lengths returned are always the whole file's. */
  take_media(
    tracks: TrackFile[],
    buckets?: number,
    startSec?: number,
    endSec?: number
  ): Promise<TrackMedia[]>

  start_rehearsal(
    name: string,
    deviceIndex: number,
    samplerate: number,
    tracks: Track[],
    bitDepth?: number,
    /** The set it plays by; left out or null, it plays freely. */
    setId?: number | null
  ): Promise<Ok<{ folder?: string }>>
  /** Which rate/depth combinations this input actually accepts. */
  recording_formats(
    deviceIndex: number,
    channelCount: number
  ): Promise<
    Ok<{ formats?: Record<string, number[]>; trouble?: string }>
  >
  session_state(): Promise<SessionState>
  finish_rehearsal(): Promise<
    Ok<{ folder?: string; take_count?: number; folder_removed?: boolean }>
  >

  start_take(): Promise<Ok<{ take_number?: number }>>
  /** Names the take recorded next; blank goes back to the name it would
   *  have had. Holds until a take is kept. */
  set_next_take_name(name: string): Promise<Ok<{ next_take_name?: string; next_take_go?: number | null }>>
  /** The latest go at the song `name` resolves to, by session_state's rule
   *  for last_attempt: what the screen after a take measures it against.
   *  null with no rehearsal on, no song, or a song never played. */
  last_attempt(name: string): Promise<LastAttempt | null>
  get_levels(): Promise<Record<string, number>>
  stop_take(): Promise<PendingTake | { ok: false; error: string }>
  keep_take(
    takeNumber: number,
    tempDir: string,
    customName: string,
    durationSec: number,
    tracks: TrackFile[],
    markers?: Marker[],
    /** This take's own answer: null follows the setting, false keeps it
     *  out of the cloud folder, true sends it with sending off. */
    sendToCloud?: boolean | null,
    /** The .mid files stop_take made, to be kept beside the audio. */
    notes?: NotesFile[]
  ): Promise<Ok<{ take?: Take }>>
  discard_take(tempDir: string): Promise<Ok>
  /**
   * Keep only [startSec, endSec) of a saved take; the rest goes to the Trash.
   * `error` can be set even when `ok` is true — the crop itself went
   * through, but the originals could not be swept away, and `location` is
   * where they are sitting instead.
   */
  crop_take(
    folder: string,
    takeNumber: number,
    startSec: number,
    endSec: number
  ): Promise<
    Ok<{ take?: Take; markers_dropped?: number; location?: string | null }>
  >
  /** The same, for a take that is still on the review screen. */
  crop_draft(
    tempDir: string,
    tracks: TrackFile[],
    startSec: number,
    endSec: number,
    /** The draft's .mid files, cropped with the audio. */
    notes?: NotesFile[]
  ): Promise<
    Ok<{
      tracks?: TrackFile[]
      /** The notes again, cut to the same part. */
      notes?: NotesFile[]
      duration_sec?: number
      location?: string | null
    }>
  >

  list_rehearsals(): Promise<RehearsalSummary[]>
  get_rehearsal(folder: string): Promise<RehearsalDetail>
  last_time(): Promise<LastTime>
  list_songs(): Promise<SongIndex>
  /** A song's page; null is the takes nobody named. */
  get_song(songId: number | null): Promise<SongDetail>
  save_history_view(view: HistoryView): Promise<Ok>
  /** Every mark with the label, from every rehearsal. */
  list_marks(labelId: number): Promise<MarksAnswer>
  save_marks_grouping(grouping: MarksGrouping): Promise<Ok>
  /** The songs a take of `folder` can be named after, `takeNumber` being
   *  the take named, which does not count as a go. With no folder, the
   *  rehearsal in progress. */
  song_choices(folder?: string | null, takeNumber?: number | null): Promise<SongChoices>
  /** A song's new title; its takes' folders and cloud copies follow in the
   *  background. */
  rename_song(songId: number, title: string): Promise<RenameSongAnswer>
  /** One song's goes become another's, numbered after its own; `dryRun`
   *  only counts them, for the question. */
  merge_songs(fromId: number, intoId: number, dryRun?: boolean): Promise<MergeAnswer>
  /** An old name forgotten: typed again, it is a new song. */
  forget_song_name(name: string): Promise<Ok>
  /** Takes a rehearsal whose folder is gone out of history. Nothing on disk
   *  is touched — there is nothing left to touch. */
  forget_rehearsal(folder: string): Promise<Ok>
  /** The folder dialog for pointing a missing rehearsal at where it is now. */
  choose_rehearsal_folder(
    folder: string
  ): Promise<Ok<{ folder?: string; cancelled?: boolean }>>
  rename_take(
    folder: string,
    takeNumber: number,
    newName: string
  ): Promise<Ok<{ take?: Take }>>
  /** Puts ★ on a take, or takes it off. Set, not toggled. */
  set_take_star(
    folder: string,
    takeNumber: number,
    starred: boolean
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
  /** Queues the rehearsal's ★ takes with no copy in the cloud folder and
   *  none waiting, as What gets published says. `failed`: the ones that
   *  could not be sent (their files gone), with why. */
  send_starred(folder: string): Promise<
    Ok<{
      queued?: number[]
      failed?: { take_number: number; error: string }[]
      needs_dir?: boolean
    }>
  >
  /** Seconds, kept within 5 to 120. */
  set_false_start(seconds: number): Promise<Ok<{ false_start_sec?: number }>>

  delete_take(folder: string, takeNumber: number): Promise<DeleteResult>
  /** Each as delete_take does it; what could not go is said take by take. */
  delete_takes(
    folder: string,
    takeNumbers: number[]
  ): Promise<
    Ok<{ deleted?: number[]; failed?: { take_number: number; error: string }[] }>
  >
  delete_rehearsal(folder: string): Promise<DeleteResult>

  add_take_marker(
    folder: string,
    takeNumber: number,
    seconds: number,
    note?: string,
    /** None gives the first label. */
    labelId?: number | null
  ): Promise<Ok<{ markers?: Marker[] }>>
  update_take_marker(
    folder: string,
    takeNumber: number,
    seconds: number,
    note?: string | null,
    labelId?: number | null
  ): Promise<Ok<{ markers?: Marker[] }>>
  remove_take_marker(
    folder: string,
    takeNumber: number,
    seconds: number
  ): Promise<Ok<{ markers?: Marker[] }>>
  /** Every label, in order, with how many marks each has. */
  list_labels(): Promise<Label[]>
  add_label(name: string, colour: LabelColour): Promise<LabelsAnswer>
  rename_label(labelId: number, name: string): Promise<LabelsAnswer>
  recolour_label(labelId: number, colour: LabelColour): Promise<LabelsAnswer>
  /** To `position` in the list, from 0. */
  move_label(labelId: number, position: number): Promise<LabelsAnswer>
  /** A label in use needs `marksTo`: the label its marks get. */
  delete_label(labelId: number, marksTo?: number | null): Promise<LabelsAnswer>

  /** Every set, in order. */
  list_sets(): Promise<SongSet[]>
  /** Each answers with every set as it now is, or with the reason it was
   *  refused: no name, or a name another set has. */
  add_set(name: string, songs: string[]): Promise<SetsAnswer>
  /** null leaves the name, or the songs, as they are. */
  update_set(setId: number, name: string | null, songs: string[] | null): Promise<SetsAnswer>
  /** Rehearsals played by it keep their copy of it. */
  delete_set(setId: number): Promise<SetsAnswer>
  /** The set Start rehearsal plays by, or null to play freely. */
  save_next_set(setId: number | null): Promise<Ok>

  list_drafts(): Promise<Draft[]>
  recover_draft(draftDir: string, name?: string): Promise<Ok<{ take?: Take }>>
  discard_draft(draftDir: string): Promise<DeleteResult>

  get_settings(): Promise<Settings>
  /** Settings › Under the hood: what this copy runs on, asked now. */
  under_the_hood(): Promise<UnderTheHood>
  /** The text Copy details puts on the clipboard. */
  bug_report(): Promise<Ok<{ text?: string }>>
  /** The folder one of the app's own files is in, with the file picked out. */
  show_file(which: OwnFile["key"]): Promise<Ok>
  /** A rehearsal's folder, opened in Finder, Explorer or the desktop's own. */
  show_rehearsal_folder(folder: string): Promise<Ok>
  /** The releases page, or with `latest` the newest release's own page. */
  open_releases(latest?: boolean): Promise<Ok>
  /** Whether a newer version is out, as far as the last check knows. */
  update_status(): Promise<UpdateStatus>
  set_check_updates(on: boolean): Promise<Ok<{ check_updates?: boolean }>>
  /** Fetches the newer version's zip into Downloads, checks it, and shows it
   *  in its folder; how far along it is comes in update_status. */
  download_update(): Promise<Ok>
  /** The downloaded zip, picked out in its folder again. */
  show_update(): Promise<Ok>
  start_interface_check(): Promise<Ok>
  interface_check(): Promise<InterfaceCheck>
  stop_interface_check(): Promise<Ok>
  set_recordings_dir(path: string): Promise<Ok<{ recordings_dir?: string }>>
  choose_recordings_dir(): Promise<
    Ok<{ recordings_dir?: string; cancelled?: boolean }>
  >
  save_mix(volumes: Record<string, number>): Promise<Ok>
  /** The listening level, kept between takes. Not part of the cloud mix. */
  save_master_volume(volume: number): Promise<Ok>
  save_appearance(theme: string, uiScale: number): Promise<Ok>
  /** `warning` when a take is open and it now plays somewhere else. */
  set_output_device(deviceIndex: number | null): Promise<Ok<{ warning?: string }>>
  set_output_channels(channels: number[]): Promise<Ok<{ warning?: string }>>

  start_monitor(
    deviceIndex: number,
    samplerate: number,
    tracks: Track[]
  ): Promise<Ok>
  monitor_levels(): Promise<Record<string, number>>
  monitor_health(): Promise<MonitorHealth>
  /** The MIDI ports the system lists now, for the picker on the setup
   *  screen. Polled while it is up. */
  list_midi_ports(): Promise<MidiPorts>
  /** What each track that takes notes is doing: the loudest note since the
   *  last call, the count, and whether its port is there. Polled with the
   *  levels. */
  midi_activity(): Promise<MidiActivity>
  /** The notes of a take's tracks, read back from their .mid files, one answer
   *  per file in the order asked. */
  take_notes(files: TrackFile[]): Promise<TakeNotes[]>
  activity(): Promise<Activity>
  activity_seen(): Promise<Ok>
  clear_activity(): Promise<Ok>
  retry_cloud(entryId: number): Promise<Ok<{ queued?: boolean }>>
  /** `keepPorts`: the rehearsal about to start takes the check's MIDI ports
   *  as they are, open, rather than closing them to open them again. */
  stop_monitor(keepPorts?: boolean): Promise<Ok>

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
  player_set_master(volume: number): Promise<Ok>
  player_set_muted(name: string, muted: boolean): Promise<PlayerState>
  player_set_solo(name: string | null): Promise<PlayerState>

  /** Counted in channels, not tracks: a stereo track writes two. */
  disk_estimate(
    channelCount: number,
    samplerate: number,
    bitDepth?: number
  ): Promise<DiskEstimate>
  recording_health(): Promise<RecordingHealth>
  /** What went wrong while starting, each said once: returned, then
   *  forgotten on the Python side. */
  startup_problems(): Promise<{ name: string; message: string }[]>
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

/**
 * The calls that answer with a value rather than `{ok, error}` — a list, the
 * settings, the session. A failure has no honest stand-in for those, so they
 * still reject (after the bar has said so); every other call, on failure,
 * answers `{ok: false, error}`, which is the shape each screen already
 * handles: it shows the error and lets go of its busy state.
 */
const ANSWERS_WITH_A_VALUE = new Set<keyof PyApi>([
  "ping",
  "list_input_devices",
  "list_output_devices",
  "load_default_tracks",
  "media_url",
  "take_media",
  "session_state",
  "get_levels",
  "monitor_levels",
  "monitor_health",
  "list_midi_ports",
  "midi_activity",
  "take_notes",
  "activity",
  "recording_health",
  "list_rehearsals",
  "list_songs",
  "list_drafts",
  "list_labels",
  "list_sets",
  "last_attempt",
  "get_settings",
  "startup_problems",
])

let guarded: { raw: PyApi; proxy: PyApi } | null = null

/**
 * The bridge, with every call guarded: a Python exception reaches the
 * person as a bar with its message (see `bridgeErrors`), never as a button
 * that dims and stays dimmed.
 */
export function api(): PyApi {
  const raw = window.pywebview?.api
  if (!raw) {
    throw new Error("The bridge to Python is not ready yet")
  }
  if (guarded?.raw !== raw) {
    const wrapped = new Map<PropertyKey, unknown>()
    const proxy = new Proxy(raw, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== "function") return value
        const cached = wrapped.get(prop)
        if (cached) return cached
        const method = String(prop)
        const call = async (...args: unknown[]) => {
          // Looked up per call, not captured: a method replaced on the bridge
          // after the first call must still be the one that runs.
          const fn = Reflect.get(target, prop) as (...a: unknown[]) => Promise<unknown>
          try {
            return await fn.apply(target, args)
          } catch (e) {
            reportBridgeError(method, e)
            if (ANSWERS_WITH_A_VALUE.has(method as keyof PyApi)) throw e
            const err = e instanceof Error ? e : new Error(String(e))
            return { ok: false, error: `${err.name}: ${err.message}` }
          }
        }
        wrapped.set(prop, call)
        return call
      },
    })
    guarded = { raw, proxy }
  }
  return guarded.proxy
}

/** What updates.py last found. `latest` is only ever a newer release than
 *  the one running, and none while checking is switched off. */
export type UpdateStatus = {
  on: boolean
  latest: { version: string } | null
  /** Once somebody has pressed Download: how far it got, the file's name in
   *  Downloads once it is there and checked, what went wrong if not. */
  download?: UpdateDownload | null
  /** Whether GitHub has answered since the app started: no newer version
   *  found before then says nothing. */
  checked?: boolean
}

export type UpdateDownload = {
  state: "running" | "done" | "failed"
  version: string
  fraction?: number
  file?: string
  error?: string
}

/** The read-only calls the interface asks for over and over. */
type Pollable = {
  player_state: PlayerState
  /** One figure per channel of each track: a stereo track has two. */
  get_levels: Record<string, number[]>
  monitor_levels: Record<string, number[]>
  monitor_health: MonitorHealth
  list_midi_ports: MidiPorts
  midi_activity: MidiActivity
  activity: Activity
  recording_health: RecordingHealth
  session_state: SessionState
  update_status: UpdateStatus
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
      // Let go of the answer's body: left unread, the request stays open as
      // far as the browser is concerned — for as long as the page lives.
      void res.body?.cancel()
      if (httpPolling === null) httpPolling = false
    } catch {
      if (httpPolling === null) httpPolling = false
    }
  }
  return (await api()[name]()) as Pollable[K]
}
