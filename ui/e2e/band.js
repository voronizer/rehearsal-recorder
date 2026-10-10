// The band: four musicians on an XR18, a song for them to play and the
// rehearsals they have had. Laid over fake-bridge.js, in the same script
// (see below), by tests/docs_screenshots.py for the docs' pictures, by the
// website in site/, and by e2e/band.spec.ts, which keeps it fitting the
// interface.
//
// ---- The song ----------------------------------------------------------
// 128 bpm: four clicks of the sticks, then intro, verse, chorus, verse,
// chorus, bridge, a long last chorus and an outro. Every level here is a
// function of time, so a zoomed-in window gets real detail, not a stretched
// picture of the whole take.
const BEAT = 60 / 128, BAR = 4 * BEAT;
const START = 4 * BEAT + 2.8;
const FORM = [['intro', 8], ['verse', 16], ['chorus', 8], ['verse', 16],
              ['chorus', 8], ['bridge', 8], ['chorus', 16], ['outro', 4]];
const SONG_END = START + FORM.reduce((s, f) => s + f[1] * BAR, 0);

function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
// Smooth noise between 0 and 1, the same for the same t and seed every time.
function wobble(t, rate, seed) {
  const x = t * rate + seed * 17.3, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash(i + seed * 3.1) * (1 - s) + hash(i + 1 + seed * 3.1) * s;
}
function sectionAt(t, end) {
  if (t < START || t >= end) return null;
  let at = START;
  for (const [kind, bars] of FORM) {
    if (t < at + bars * BAR) return {kind, pos: t - at};
    at += bars * BAR;
  }
  return null;
}
// What is still ringing after the song stopped, or broke down.
function tail(t, k, level, decay) {
  return t >= k.end ? level * Math.exp(-(t - k.end) / decay) : 0;
}

function drums(t, k) {
  const room = 0.006 + 0.006 * wobble(t, 30, k.seed);
  if (t < START) {
    const c = t - (START - 4 * BEAT);
    return c < 0 ? room : room + 0.32 * Math.exp(-(c % BEAT) / 0.02);
  }
  const s = sectionAt(t, k.end);
  if (!s) return room + tail(t, k, 0.8, 1.4);
  const beat = Math.floor(s.pos / BEAT), p = s.pos - beat * BEAT, even = beat % 2 === 0;
  const loud = {intro: 0.82, verse: 0.78, chorus: 1, bridge: 0.6, outro: 0.95}[s.kind]
    * (0.82 + 0.18 * hash(beat + k.seed * 13));                          // no two hits alike
  let v;
  if (s.kind === 'bridge') {
    v = (even ? 0.62 : 0.45) * Math.exp(-p / 0.2);                      // toms, half time
  } else {
    v = Math.max((even ? 0.9 : 0) * Math.exp(-p / 0.08),                 // kick
                 (even ? 0 : 0.82) * Math.exp(-p / 0.13),                // snare
                 0.2 * Math.exp(-(p % (BEAT / 2)) / 0.025));             // hi-hat
    if (s.kind === 'chorus' || s.kind === 'outro')
      v = Math.max(v, 0.3 + 0.1 * wobble(t, 20, k.seed));                // ride wash
    if (s.pos < 1.6) v = Math.max(v, 0.95 * Math.exp(-s.pos / 0.9));     // crash on the one
  }
  return Math.min(0.96, room + loud * v * (0.84 + 0.16 * wobble(t, 60, k.seed)));
}
function bass(t, k) {
  const s = sectionAt(t, k.end);
  if (!s) return 0.004 + tail(t, k, 0.4, 0.8);
  const step = s.kind === 'chorus' || s.kind === 'outro' ? BEAT / 2 : BEAT;
  const n = Math.floor(s.pos / step), p = s.pos - n * step;
  const level = {intro: 0.46, verse: 0.42, chorus: 0.58, bridge: 0.32, outro: 0.55}[s.kind]
    * (0.72 + 0.28 * hash(n + k.seed * 29))                              // some notes dig in
    * (0.85 + 0.15 * wobble(t, 0.4, k.seed + 5));                        // and the playing breathes
  const note = p < step * 0.88 ? 0.5 + 0.5 * Math.exp(-p / 0.1) : 0.2;
  return 0.004 + level * note * (0.9 + 0.1 * wobble(t, 25, k.seed + 1));
}
function guitar(t, k) {
  const s = sectionAt(t, k.end);
  if (!s) return 0.005 + tail(t, k, 0.5, 2.5);
  if (s.kind === 'bridge') {                                             // clean, picked
    const p = s.pos % (BEAT / 2);
    return 0.005 + 0.28 * (0.3 + 0.7 * Math.exp(-p / 0.18));
  }
  if (s.kind === 'verse') {                                              // palm-muted eighths
    const p = s.pos % (BEAT / 2);
    return 0.005 + 0.36 * (0.35 + 0.65 * Math.exp(-p / 0.05))
      * (0.9 + 0.1 * wobble(t, 30, k.seed + 2));
  }
  // The wall: strummed on the beat, harder on some bars than others.
  const bar = Math.floor(s.pos / BAR);
  return 0.005 + 0.6 * (0.72 + 0.28 * Math.exp(-(s.pos % BEAT) / 0.14))
    * (0.8 + 0.2 * hash(bar + k.seed * 31)) * (0.9 + 0.1 * wobble(t, 12, k.seed + 2));
}
function vocals(t, k) {
  // Every microphone in a rehearsal room hears the drums.
  const bleed = 0.004 + 0.08 * drums(t, k);
  const s = sectionAt(t, k.end);
  if (!s || s.kind === 'intro' || s.kind === 'outro') return bleed;
  const line = 2 * BAR, q = s.pos % line;
  const sung = s.kind === 'bridge' ? 0.55 : 0.78;
  if (q >= line * sung || (s.kind === 'bridge' && Math.floor(s.pos / line) % 2)) return bleed;
  const level = {verse: 0.42, chorus: 0.64, bridge: 0.36}[s.kind];
  const shape = Math.max(0, Math.min(1, q / 0.15, (line * sung - q) / 0.3));
  const syllables = 0.3 + 0.7 * wobble(t, 6, k.seed + 3);
  const grain = 0.72 + 0.28 * wobble(t, 110, k.seed + 4);               // consonants, breath
  return Math.max(bleed, level * shape * syllables * grain);
}
const VOICE = {Drums: drums, Bass: bass, Guitar: guitar, Vocals: vocals};
const PARTS = [{name: 'Drums', channel: 1, icon: 'drums'},
               {name: 'Bass', channel: 2, icon: 'bass'},
               {name: 'Guitar', channel: 3, icon: 'guitar-electric'},
               {name: 'Vocals', channel: 4, icon: 'vocals'}];

// ---- The takes ---------------------------------------------------------
// seed makes each take a little different; end is where the song stopped,
// a take that broke down stopping early.
const KIND = {};
// What a take is a go at, from its name, as the library would say: "Pałyn 2"
// is the second go at Pałyn, "Take 11" a go at nothing.
function goOfName(name) {
  if (/^Take \d+$/.test(name)) return {song: null, go: null};
  const m = /^(.*?)(?: (\d+))?$/.exec(name);
  return {song: m[1], go: m[2] ? Number(m[2]) : 1};
}
// The goes someone marked as the one to keep are starred.
const isTheTake = markers => markers.some(m => /the take|keep this/.test(m.note));
function takeOf(n, name, length, end, markers) {
  const tracks = PARTS.map(p => ({name: p.name, file: `/rec/tue/${n}/${p.name}.wav`}));
  for (const tr of tracks) {
    KIND[tr.file] = {part: tr.name, seed: n, end};
    fileDurations[tr.file] = length;
  }
  return {take_number: n, name, ...goOfName(name), starred: isTheTake(markers),
          duration_sec: length, tracks, markers};
}
const SECTION = name => {
  let at = START;
  for (const [kind, bars] of FORM) { if (kind === name) return at; at += bars * BAR; }
};
const EARLIER = [
  takeOf(1, 'Pałyn', 58, 51, [{at: 50, note: 'lost the count', label_id: 3}]),
  takeOf(2, 'Pałyn 2', Math.round(SONG_END + 4), SONG_END, [
    {at: 50.5, note: 'chorus came in early', label_id: 3},
    {at: 112, note: 'bridge — try it slower', label_id: 4},
    {at: 131, note: 'this one is the take', label_id: 2}]),
  // A count-in that went wrong, and a take nobody named: what sorting the
  // evening is for. Ahoń, so tonight's Pałyn and Viasna keep their goes, and
  // before Viasna, so Viasna is still the last song played and the Next
  // take field still offers its next go.
  takeOf(3, 'Ahoń', 12, 11, []),
  takeOf(4, 'Take 4', 108, 104, []),
  takeOf(5, 'Viasna', 141, 137, []),
];
// For the script driving the page: where things are in the song.
window.__SONG__ = {length: n => fileDurations[`/rec/tue/${n}/Drums.wav`],
                   bridge: SECTION('bridge'), bar: BAR};

function peaksOf(file, buckets, from, to) {
  const k = KIND[file];
  const voice = k ? VOICE[k.part] : (() => 0.004);
  const out = new Array(buckets);
  const width = (to - from) / buckets;
  const step = Math.min(width, 0.004);
  for (let i = 0; i < buckets; i++) {
    let top = 0;
    for (let t = from + i * width; t < from + (i + 1) * width; t += step)
      top = Math.max(top, voice(t, k || {seed: 0, end: 0}));
    out[i] = top;
  }
  return out;
}

// ---- The bridge, set up for the pictures -------------------------------
const api = window.pywebview.api;
recording = {device_index: 3, samplerate: 48000, bit_depth: 24};
outputDevice = {index: 3, channels: [1, 2]};
cloudDir = 'C:\\Users\\alex\\Google Drive\\Band';
cloudFormat = 'mp3';
autoPublish = {on: true, what: 'mix'};

api.list_input_devices = async () => [
  {index: 0, name: 'X18/XR18', host_api: 'MME', max_input_channels: 2,
   max_output_channels: 0, default_samplerate: 48000},
  {index: 3, name: 'X18/XR18', host_api: 'ASIO', max_input_channels: 18,
   max_output_channels: 18, default_samplerate: 48000},
  {index: 5, name: 'Microphone Array (Realtek(R) Audio)', host_api: 'Windows WASAPI',
   max_input_channels: 2, max_output_channels: 0, default_samplerate: 48000}];
api.list_output_devices = async () => [
  {index: 1, name: 'Speakers (Realtek(R) Audio)', host_api: 'MME', max_input_channels: 0,
   max_output_channels: 2, default_samplerate: 48000},
  {index: 3, name: 'X18/XR18', host_api: 'ASIO', max_input_channels: 18,
   max_output_channels: 18, default_samplerate: 48000}];
api.recording_formats = async () => ({ok: true, formats: {'44100': [16, 24], '48000': [16, 24]}});
api.load_default_tracks = async () => ({tracks: PARTS.map(p => ({...p, stereo: false}))});
api.disk_estimate = async (count, rate, depth) => {
  const perSec = count * rate * (depth === 24 ? 3 : 2), free = 61e9;
  return {ok: true, free_bytes: free, bytes_per_sec: perSec, minutes: free / perSec / 60, low: false};
};
api.recording_health = async () => ({recording: true, error: null, active: true,
  free_bytes: 61e9, minutes_left: 1720, low_space: false});

// Meters, from a chorus as it would be playing now: the loud part, with
// everyone in, is what a level check is for. At the level a band sets its
// gain for, the loudest hit reaching about −18 dBFS, since the meters are in
// dB and a song at full scale would stand every tile at the top.
const song = () => SECTION('chorus') + (performance.now() / 1000) % 12;
const AS_SET = 10 ** (-18 / 20);
const meters = () => Object.fromEntries(PARTS.map(p =>
  [p.name, [AS_SET * VOICE[p.name](song(), {seed: 9, end: SONG_END})]]));
api.monitor_levels = async () => meters();
api.get_levels = async () => meters();
levels = function () {
  if (!P || !P.playing) return {};
  const t = position();
  return Object.fromEntries(Object.keys(P.volumes).map(n => {
    const silent = P.muted.includes(n) || (P.soloed && P.soloed !== n);
    return [n, [silent ? 0 : VOICE[n](t, {seed: 2, end: SONG_END}) * P.volumes[n]]];
  }));
};

api.start_rehearsal = async (name, _device, _rate, _tracks, _depth, setId) => {
  // The set picked beside Start, as the rehearsal keeps it (Library.set_of).
  const byIt = sets.find(st => st.id === setId);
  session = {name, folder: `C:\\Users\\alex\\RehearsalRecordings\\${name} - 2026-09-29 19-00`,
             tracks: PARTS,
             takes: JSON.parse(JSON.stringify(EARLIER)),
             set: byIt ? {name: byIt.name, songs: [...byIt.songs]} : null};
  takeCounter = EARLIER.length;
  return {ok: true, folder: session.folder};
};
api.stop_take = async () => {
  const draft = takeOf(takeCounter, 'draft', 151, 147, []);
  return {ok: true, take_number: takeCounter, temp_dir: '/rec/tue/_drafts',
          duration_sec: 151, suggested_name: suggestName(takeCounter),
          default_name: suggestName(takeCounter), tracks: draft.tracks};
};
api.take_media = async (tracks, buckets, from, to) => tracks.map(t => {
  const dur = fileDurations[t.file] ?? 6;
  const a = from ?? 0, b = to ?? dur;
  // The band's icon, found by the name, as take_media does.
  const icon = (PARTS.find(p => p.name === t.name) || {}).icon;
  return {name: t.name, icon, url: 'about:blank', frames: 48000 * dur, samplerate: 48000,
          duration_sec: dur, peaks: [peaksOf(t.file, buckets || 900, a, b)]};
});

// ---- History ----------------------------------------------------------
// The evenings before this one, take by take: [name, seconds, marks]. Few
// marks, as in life. Their files are never played in the pictures. Goes are
// numbered across them, oldest first, as Python numbers them: a song's page
// lists Pałyn 1 to 7, not two Pałyn 2s.
const PAST = {
  '/rec/tue': ['Tuesday jam', '2026-09-22T19:00:00', 1560000000, [
    ['Pałyn 4', 185, [{at: 111, note: 'came in late after the break', label_id: 3}]],
    ['Pałyn 5', 192, [{at: 58, note: 'chorus came in early', label_id: 3},
                      {at: 134, note: 'bridge — try it slower', label_id: 4}]],
    ['Pałyn 6', 200, []],
    ['Pałyn 7', 198, [{at: 158, note: 'this one is the take', label_id: 2}]],
    ['Viasna 3', 250, [{at: 100, note: 'guitar drifts here', label_id: 3}]],
    ['Viasna 4', 265, []], ['Viasna 5', 252, []],
    ['Ahoń 3', 340, [{at: 187, note: 'solo too long, cut to 8 bars', label_id: 4}]],
    ['Ahoń 4', 302, []], ['Sonca 2', 390, []],
    ['Take 11', 130, [{at: 42, note: 'bass riff after the count-in', label_id: 1}]]]],
  '/rec/sat': ['New songs', '2026-09-19T15:00:00', 1070000000, [
    ['Dym 2', 280, []],
    ['Dym 3', 275, [{at: 130, note: 'tempo drops in the second verse', label_id: 3}]],
    ['Dym 4', 290, []],
    ['Dym 5', 270, [{at: 200, note: 'keep this ending', label_id: 2}]],
    ['Ptuška', 245, []],
    ['Ptuška 2', 260, [{at: 75, note: 'half-time groove in the bridge', label_id: 1}]],
    ['Ptuška 3', 255, []]]],
  '/rec/tue-before': ['Tuesday jam', '2026-09-15T19:00:00', 1310000000, [
    ['Pałyn', 210, []], ['Pałyn 2', 195, []], ['Pałyn 3', 202, []],
    ['Viasna', 280, []],
    ['Viasna 2', 270, [{at: 210, note: 'guitar drifts here again', label_id: 3}]],
    ['Ahoń', 310, []],
    ['Ahoń 2', 295, [{at: 20, note: 'drum intro, 4 bars alone', label_id: 1}]],
    ['Sonca', 305, [{at: 150, note: '', label_id: 4}]], ['Dym', 228, []]]],
  '/rec/soundcheck': ['Soundcheck', '2026-09-12T18:30:00', 173000000, [
    ['Take 1', 140, []],
    ['Take 2', 165, [{at: 65, note: 'the riff we jammed while setting up', label_id: 1}]]]]};
const pastTakes = folder => PAST[folder][3].map(([name, length, markers], i) => ({
  take_number: i + 1, name, ...goOfName(name), starred: isTheTake(markers),
  duration_sec: length, markers,
  tracks: PARTS.map(p => ({name: p.name, file: `${folder}/${i + 1}/${p.name}.wav`}))}));
// The set a rehearsal was played by, when the page gives one
// (window.__PLAYED_BY__): its songs are all the band's, so none is new. Not
// the fake's setAsSent, which reads the library, and so this.
const playedSet = folder => {
  const set = playedBy(folder);
  return set ? {name: set.name, songs: set.songs.map(title => ({title, new: false}))} : null;
};
api.list_rehearsals = async () => Object.keys(PAST).map(folder => {
  const [name, created_at, disk_bytes] = PAST[folder];
  const takes = pastTakes(folder);
  return {folder, name, created_at, take_count: takes.length, disk_bytes,
          total_duration_sec: takes.reduce((sum, t) => sum + t.duration_sec, 0),
          songs: songsOf(takes), runs: runsOf(takes), in_cloud: folder === '/rec/tue' ? 3 : 0,
          set_name: playedBy(folder)?.name ?? null};
});
api.get_rehearsal = async folder => {
  const [name, created_at] = PAST[folder];
  const takes = pastTakes(folder);
  if (folder === '/rec/tue')
    for (const n of [4, 7, 9]) takes[n - 1].cloud = {mix: `/cloud/${n}.mp3`, mix_format: 'mp3'};
  return {ok: true, folder, name, created_at, takes, songs: songsOf(takes),
          set: playedSet(folder)};
};
api.last_time = async () => {
  const last = await api.get_rehearsal('/rec/tue');
  const sat = pastTakes('/rec/sat');
  const all = await api.list_rehearsals();
  return {
    last: {...last, runs: runsOf(last.takes), in_cloud: 3,
           songs: last.songs.map(s => ({...s, plays: playsOf(s.name, last,
             last.takes.filter(t => s.take_numbers.includes(t.take_number)), [last])}))},
    not_played: [
      {name: 'Dym', folder: '/rec/sat', rehearsal: 'New songs', created_at: '2026-09-19T15:00:00',
       goes: 4, take: sat[3],
       plays: {folder: '/rec/sat', rehearsal: 'New songs', created_at: '2026-09-19T15:00:00', take: sat[3]}},
      {name: 'Ptuška', folder: '/rec/sat', rehearsal: 'New songs', created_at: '2026-09-19T15:00:00',
       goes: 3, take: sat[6],
       plays: {folder: '/rec/sat', rehearsal: 'New songs', created_at: '2026-09-19T15:00:00', take: sat[6]}}],
    earlier: all.slice(1).map(r => ({folder: r.folder, name: r.name, created_at: r.created_at,
      take_count: r.take_count, total_duration_sec: r.total_duration_sec, missing: false})),
    count: all.length};
};

// History's Songs view reads the same evenings.
library = async () => Promise.all(Object.keys(PAST).map(async folder => (
  {...(await api.get_rehearsal(folder)), missing: false})));

// Pałyn was typed "Palyn" one night, and merged since: the old spelling
// still leads to it (Library song_name).
oldNames.set('palyn', {name: 'Palyn', song: 'Pałyn'});

// The set the band plays its gigs by (Settings › Sets), for the site's sets
// tile and the docs' pictures. A page that kept sets of its own has those.
if (sets.length === 0) {
  sets = [{id: 1, name: 'Gig on the 25th',
           songs: ['Pałyn', 'Viasna', 'Ahoń', 'Sonca', 'Dym', 'Ptuška']}];
  nextSetId = 2;
}

const settings = api.get_settings;
api.get_settings = async () => ({...(await settings()),
  recordings_dir: 'C:\\Users\\alex\\RehearsalRecordings',
  default_recordings_dir: 'C:\\Users\\alex\\RehearsalRecordings',
  config_path: 'C:\\Users\\alex\\.rehearsal-recorder\\config.json',
  version: '0.7.8'});
