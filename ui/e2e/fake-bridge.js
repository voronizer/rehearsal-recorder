// The Python side of the app, faked for the interface's tests: every call
// the interface makes over the pywebview bridge, answered from state kept
// here. Loaded into the page before the app starts, by the tests in ui/e2e/
// and by tests/docs_screenshots.py, which lays a band over it.
//
// A page can set things up before it loads — window.__LEVELS__,
// window.__DRAFTS__, window.__FAIL__ and the rest below — and a test can
// change them while it runs.

// How long the fake's own takes are, in seconds. TAKE_SECONDS in e2e/app.ts
// is the same number.
const TAKE = 6;
window.__CALLS__ = [];
const track = (name, fn) => async (...args) => {
  window.__CALLS__.push({name, args});
  return fn(...args);
};

const clock = () => performance.now() / 1000;
let P = null;                 // player state, mirroring audio/player.py
let session = null;
let takeCounter = 0;
let nextName = null;            // api.set_next_take_name, until a take is kept
let drafts = window.__DRAFTS__ || [];
let cloudDir = window.__CLOUD_DIR__ || null;
let cloudFormat = window.__CLOUD_FORMAT__ || 'wav';
let autoPublish = window.__AUTO_PUBLISH__ || {on:false, what:'mix'};
let recording = {device_index: window.__NO_DEVICE__ ? null : 0, samplerate: 44100, bit_depth: 24};
let outputDevice = {index: null};
// An XR18 switched on after the app started: absent from the list until the
// second look, since a desk takes a while to boot.
let pluggedIn = false;
let rescans = 0;
// Real playback reads each file's own length off disk; the mock has no
// disk, so a track's duration is looked up here by its own file path,
// falling back to the live session's TAKE-second default. Every path used
// for a "real" length has to be unique, or it leaks into whichever other
// take happens to reuse that dummy path.
let fileDurations = {};
let cloudQueue = {};
let checkState = {running:false};
// A rehearsal whose folder is gone — set to null once it is relocated or
// removed from history, the way the real database would stop listing it.
let missingRehearsal = {folder:'/rec/gone', name:'Missing jam',
  created_at:'2026-08-20T19:00:00', take_count:5, total_duration_sec:1200,
  disk_bytes:0, songs:[], runs:[], missing:true};

// The Python config lives in a file and survives a reload, so keep it in its
// own storage key rather than in page memory.
const CFG = 'mock-python-config';
const readCfg = () => {
  try { return JSON.parse(localStorage.getItem(CFG)) || {theme:'dark', ui_scale:1}; }
  catch { return {theme:'dark', ui_scale:1}; }
};
const writeCfg = (v) => localStorage.setItem(CFG, JSON.stringify(v));

function position() {
  if (!P) return 0;
  if (!P.playing) return P.position;
  let t = P.position + (clock() - P.t0);
  if (P.loop) {
    const span = P.loop.b - P.loop.a;
    if (t >= P.loop.b) t = P.loop.a + ((t - P.loop.a) % span);
  } else if (t >= P.duration) {
    P.playing = false; P.position = 0; P.t0 = clock();
    return 0;
  }
  return t;
}
// Which files are two channels: the tracks named in __STEREO_TRACKS__.
function stereo(name) { return (window.__STEREO_TRACKS__ || []).includes(name); }
// The icon the band keeps for a name, from __BAND_ICONS__, the way
// layouts.for_device and take_media hand it out.
function withIcon(t) {
  const icon = (window.__BAND_ICONS__ || {})[t.name];
  return icon ? {...t, icon} : t;
}
// Mirrors what audio/player.py measures in the mix: post-fader, silent when
// muted or when another track is soloed, and nothing at all while stopped.
function levels() {
  if (!P || !P.playing) return {};
  const t = position();
  return Object.fromEntries(Object.keys(P.volumes).map(n => {
    const silent = P.muted.includes(n) || (P.soloed && P.soloed !== n);
    const raw = Math.abs(Math.sin(t * 2.7)) * 0.9;
    const left = silent ? 0 : Math.round(raw * P.volumes[n] * 1000) / 1000;
    // A stereo track's right side at half the left, so the two can be told
    // apart.
    return [n, stereo(n) ? [left, Math.round(left * 500) / 1000] : [left]];
  }));
}
// The whole mix after the master, the way player.py measures it: the tracks
// add up, and a sum past full scale reads full.
function masterLevel() {
  if (!P || !P.playing) return 0;
  const sum = Object.values(levels()).reduce((a, v) => a + v[0], 0);
  return Math.min(1, Math.round(sum * P.master * 1000) / 1000);
}
// A test can hold a call where it is — window.__HOLD__[name], a promise it
// resolves when it has seen what it came to see.
async function held(name) {
  const h = window.__HOLD__ && window.__HOLD__[name];
  if (h) await h;
}

function playerState() {
  if (!P) return {open:false};
  return {open:true, ok:true, playing:P.playing, position:position(), duration:P.duration,
          loop:P.loop, muted:P.muted, soloed:P.soloed, volumes:P.volumes, master:P.master,
          levels:levels(), master_level:masterLevel()};
}
function moveTo(t) { P.position = Math.max(0, Math.min(P.duration, t)); P.t0 = clock(); }

// Mirrors api.suggest_take_name: n is the take being named, left out it means
// the one that comes next.
function suggestName(n, chosen = true) {
  if (chosen && session && nextName) return nextName;
  const number = n === undefined ? takeCounter + 1 : n;
  if (!session || session.takes.length === 0) return 'Take ' + number;
  const last = session.takes[session.takes.length - 1].name;
  const m = /^(.*?)\s+(\d+)$/.exec(last);
  return m ? `${m[1]} ${Number(m[2]) + 1}` : `${last} 2`;
}

// Python groups takes into songs (api._songs_of) and hands the result over;
// the mock does the same, simply: drop a trailing attempt number, skip the
// takes the app named itself.
function songsOf(takes) {
  const songs = [], byKey = {};
  for (const t of takes) {
    const name = (t.name || '').trim();
    if (!name || /^Take \d+$/.test(name)) continue;
    const base = name.replace(/\s+\d+$/, '');
    const key = base.toLowerCase();
    if (byKey[key]) { byKey[key].takes++; byKey[key].take_numbers.push(t.take_number); }
    else { byKey[key] = {name: base, takes: 1, take_numbers: [t.take_number]}; songs.push(byKey[key]); }
  }
  return songs;
}

// And api._runs_of: the evening in order, in runs of goes at one song, each
// go as its length and whether it was marked to keep.
function runsOf(takes) {
  const spelled = {};
  for (const s of songsOf(takes)) spelled[s.name.toLowerCase()] = s.name;
  const runs = [];
  for (const t of takes) {
    const name = (t.name || '').trim();
    const base = !name || /^Take \d+$/.test(name) ? null : name.replace(/\s+\d+$/, '');
    const song = base ? spelled[base.toLowerCase()] : null;
    const go = {duration_sec: t.duration_sec,
                keep: (t.markers || []).some(m => m.kind === 'good')};
    if (runs.length && runs[runs.length - 1].song === song) runs[runs.length - 1].takes.push(go);
    else runs.push({song, takes: [go]});
  }
  return runs;
}

// The rehearsals before this one, as get_rehearsal gives them. Tuesday jam
// is one take long unless a page asks for a fuller evening; the others are
// what the setup screen's last time needs: one with nothing named, and an
// older one with a song Tuesday jam did not play.
function pastRehearsal(folder) {
  if (folder === '/rec/quiet') {
    const takes = [
      {take_number:1, name:'Take 1', duration_sec:300, markers:[],
       tracks:[{name:'Guitar', file:'/rec/quiet/t1.wav'}]},
      {take_number:2, name:'Take 2', duration_sec:300, markers:[],
       tracks:[{name:'Guitar', file:'/rec/quiet/t2.wav'}]}];
    return {folder, name:'Wednesday jam', created_at:'2026-09-03T19:00:00', takes};
  }
  if (folder === '/rec/older') {
    const takes = [
      {take_number:1, name:'Doroga', duration_sec:230, markers:[],
       tracks:[{name:'Guitar', file:'/rec/older/d1.wav'}]},
      {take_number:2, name:'Doroga 2', duration_sec:240, markers:[],
       tracks:[{name:'Guitar', file:'/rec/older/d2.wav'}]}];
    return {folder, name:'First rehearsal', created_at:'2026-08-25T19:00:00', takes};
  }
  // Its own path, distinct from the live session's /rec/g.wav — two takes
  // sharing a dummy path would let one's mocked length leak onto the other.
  // A page can ask for another length, to put a tick where it wants one.
  const oldLength = window.__OLD_LENGTH_SEC__ || 600;
  // A page can ask for a fuller evening, for the rehearsal overview.
  const takes = window.__FULL_EVENING__ ? [
    {take_number:1, name:'Polyn', duration_sec:192, markers:[],
     tracks:[{name:'Guitar', file:'/rec/old/p1.wav'}]},
    {take_number:2, name:'Polyn 2', duration_sec:178,
     markers:[{at:72, note:'this one is the take', kind:'good'}],
     cloud:{mix:'/cloud/Tuesday jam/02 - Polyn 2.mp3', mix_format:'mp3'},
     tracks:[{name:'Guitar', file:'/rec/old/p2.wav'}]},
    {take_number:3, name:'Take 3', duration_sec:90,
     markers:[{at:5, note:'', kind:'note'}],
     tracks:[{name:'Guitar', file:'/rec/old/t3.wav'}]},
    {take_number:4, name:'Vesna', duration_sec:250,
     markers:[{at:40, note:'guitar drifts here', kind:'issue'}],
     tracks:[{name:'Guitar', file:'/rec/old/v1.wav'}]},
  ] : [{take_number:1, name:'Polyn', duration_sec:oldLength, markers:[],
        tracks:[{name:'Guitar', file:'/rec/old/g.wav'}]}];
  return {folder, name:'Tuesday jam', created_at:'2026-09-10T19:00:00', takes};
}

// And api._last_attempt: how long the latest go at the song the next take
// is named for ran, under the name songsOf gives that song.
// And api._next_go: the song itself the first time, then one past the
// highest number any go at it carries.
function nextGo(takes, song) {
  let highest = 0, spelled = song;
  for (const t of takes) {
    const name = (t.name || '').trim();
    if (!name || /^Take \d+$/.test(name)) continue;
    const m = /^(.*?)\s+(\d+)$/.exec(name);
    const base = m ? m[1] : name;
    if (base.toLowerCase() !== song.toLowerCase()) continue;
    if (!highest) spelled = base;
    highest = Math.max(highest, m ? Number(m[2]) : 1);
  }
  return highest ? `${spelled} ${highest + 1}` : song;
}

// The rest of the band's repertoire, as other rehearsals in the library
// played it, the latest first.
const REPERTOIRE = ['Polyn', 'Vesna', 'Ogon', 'Sonce', 'Dym', 'Ptaha', 'Doroga'];

function lastAttempt(takes, nextName) {
  const songOf = (n) => {
    n = (n || '').trim();
    if (!n || /^Take \d+$/.test(n)) return null;
    return n.replace(/\s+\d+$/, '') || null;
  };
  const song = songOf(nextName);
  if (!song) return null;
  const goes = takes.filter(t => (songOf(t.name) || '').toLowerCase() === song.toLowerCase());
  return goes.length
    ? {song: songOf(goes[0].name), duration_sec: goes[goes.length - 1].duration_sec}
    : null;
}

window.__MAKE_API__ = () => ({
  ping: async () => ({ok:true, message:'mock'}),
  startup_problems: track('startup_problems', async () =>
    (window.__STARTUP_PROBLEM__ ? [window.__STARTUP_PROBLEM__] : [])),
  // With a host API named, this is the Windows shape once ASIO is loaded:
  // one mixer through three systems with three different input counts.
  list_input_devices: track('list_input_devices', async () => (window.__PLUGGED_IN_LATE__ ? [
    {index:0, name:'MacBook Pro Microphone', host_api:'Core Audio',
     max_input_channels:1, max_output_channels:0, default_samplerate:48000},
    ...(pluggedIn ? [{index:1, name:'X18/XR18', host_api:'Core Audio',
     max_input_channels:18, max_output_channels:18, default_samplerate:48000}] : [])] :
    window.__TRACKS_FROM_A_BIGGER_CARD__ ? [
    {index:0, name:'Little USB box', host_api:'Core Audio',
     max_input_channels:2, max_output_channels:0, default_samplerate:48000}] :
    window.__HOST_API__ ? [
    {index:0, name:'X32 USB', host_api:'MME',
     max_input_channels:2, max_output_channels:0, default_samplerate:48000},
    {index:3, name:'X32 USB', host_api:'ASIO',
     max_input_channels:16, max_output_channels:16, default_samplerate:48000},
    {index:5, name:'X32 USB', host_api:window.__HOST_API__,
     max_input_channels:8, max_output_channels:0, default_samplerate:48000}] : [
    {index:0, name:'Universal Audio Thunderbolt', host_api:'Core Audio',
     max_input_channels:18, max_output_channels:0, default_samplerate:48000}])),
  rescan_devices: track('rescan_devices', async () => {
    rescans += 1;
    if (window.__PLUGGED_IN_LATE__ && !pluggedIn && rescans >= 2) {
      pluggedIn = true;
      return {ok:true, found:['X18/XR18'], gone:[]};
    }
    return {ok:true, found:[], gone:[]};
  }),
  list_output_devices: async () => (window.__HOST_API__ ? [
    {index:1, name:'Speakers', host_api:'MME', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000},
    {index:3, name:'X32 USB', host_api:'ASIO', max_input_channels:16,
     max_output_channels:16, default_samplerate:48000}] : [
    {index:0, name:'UA Monitors', host_api:'Core Audio', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000},
    {index:1, name:'MacBook Speakers', host_api:'Core Audio', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000}]),
  set_output_device: track('set_output_device', async (idx) => {
    outputDevice = {index: idx, channels: [1, 2]};
    // What Python says when a take is open and the card refused it.
    const name = ['UA Monitors', 'MacBook Speakers'][idx] || 'That output';
    return window.__OUTPUT_FALLBACK__
      ? {ok:true, warning:'“' + name + '” will not take 44100 Hz right now — ' +
          'using the system output.'}
      : {ok:true};
  }),
  set_output_channels: track('set_output_channels', async (channels) => {
    outputDevice = {...outputDevice, channels};
    return {ok:true};
  }),
  load_default_tracks: track('load_default_tracks', async (band) => window.__PLUGGED_IN_LATE__ ? ({
    // Like layouts.for_device: with no card there is one input to go round;
    // with the desk, every name gets its own.
    tracks: (band || [{name:'Guitar'}, {name:'Vocals'}]).map((t, i) => ({
      name: t.name, stereo: !!t.stereo, ...(t.icon ? {icon: t.icon} : {}),
      channel: pluggedIn ? i + 1 : (i === 0 ? 1 : null)}))}) : ({
    tracks: (window.__TRACKS_FROM_A_BIGGER_CARD__
      ? [{name:'Guitar', channel:1}, {name:'Vocals', channel:12}]
      : [{name:'Guitar', channel:1}, {name:'Vocals', channel:2}]).map(withIcon)})),
  set_recording_format: track('set_recording_format', async (dev, rate, depth) => {
    recording = {device_index: dev, samplerate: rate, bit_depth: depth};
    return {ok:true, ...recording};
  }),
  set_cloud_format: track('set_cloud_format', async (f) => {
    cloudFormat = f;
    return {ok:true, cloud_format:f, encoder:'soundfile'};
  }),
  set_auto_publish: track('set_auto_publish', async (on, what) => {
    autoPublish = {on, what: what || autoPublish.what};
    return {ok:true, auto_publish:autoPublish.on, auto_publish_what:autoPublish.what};
  }),
  recording_formats: track('recording_formats', async () => (
    window.__FORMATS_REFUSED__
      ? {ok:true, formats:{}, trouble:'This interface would not say which ' +
          'rates it takes. The driver said: Unanticipated host error ' +
          '[PaErrorCode -9999]'}
      : {ok:true, formats:{'44100':[16,24], '48000':[16,24], '96000':[24]}})),
  save_default_tracks: track('save_default_tracks', async () => ({ok:true})),

  disk_estimate: track('disk_estimate', async (count, rate, depth) => {
    const perSec = count * rate * (depth === 24 ? 3 : 2);
    return {ok:true, free_bytes:1e11, bytes_per_sec:perSec,
            minutes: window.__LOW_SPACE__ ? 5 : 1e11 / perSec / 60,
            low: !!window.__LOW_SPACE__};
  }),
  recording_health: async () => ({recording:true, error: window.__IFACE_GONE__ || null,
    active: !window.__IFACE_GONE__, free_bytes:1e11,
    minutes_left: window.__LOW_SPACE__ ? 5 : 640, low_space: !!window.__LOW_SPACE__}),

  start_monitor: track('start_monitor', async () => ({ok:true})),
  monitor_levels: track('monitor_levels', async () =>
    window.__MONITOR_LEVELS__ || ({'Guitar':[0.62], 'Vocals':[0.0004]})),
  monitor_health: async () => ({checking:true, problem: window.__CHECK_QUIET__ || null}),

  // Long work, scripted by the test through window.__ACTIVITY__. Counted, so
  // a test can wait for the screen to have looked again.
  activity: async () => {
    window.__ACTIVITY_POLLS__ = (window.__ACTIVITY_POLLS__ || 0) + 1;
    return {entries: JSON.parse(JSON.stringify(window.__ACTIVITY__ || [])), recording: false};
  },
  activity_seen: track('activity_seen', async () => {
    for (const e of (window.__ACTIVITY__ || []))
      if (e.state === 'done' || e.state === 'failed') e.seen = true;
    return {ok:true};
  }),
  clear_activity: track('clear_activity', async () => {
    window.__ACTIVITY__ = (window.__ACTIVITY__ || [])
      .filter(e => e.state === 'running' || e.state === 'waiting');
    return {ok:true};
  }),
  retry_cloud: track('retry_cloud', async (_id) => (window.__RETRY_REFUSED__
    ? {ok:false, error: window.__RETRY_REFUSED__} : {ok:true, queued:true})),
  stop_monitor: track('stop_monitor', async () => ({ok:true})),

  start_rehearsal: track('start_rehearsal', async (name, _dev, _rate, _tr, _depth) => {
    session = {name, folder:'/rec/' + name, takes:[],
               tracks: window.__SESSION_TRACKS__ || [{name:'Guitar',channel:1},{name:'Vocals',channel:2}]};
    takeCounter = 0;
    nextName = null;
    return {ok:true, folder:session.folder};
  }),
  session_state: async () => {
    if (!session) return {active:false};
    // Drain on read, the way the real queue empties once a take is copied —
    // otherwise the interface would see the same take "queued" forever.
    const cq = cloudQueue;
    cloudQueue = {};
    // The real bridge deserializes its own JSON on every call, so the
    // interface never gets the same object twice. Handing out session.takes
    // directly would let the interface's "selected" take alias the mock's
    // own mutable state, silently hiding any bug where a listener keeps
    // rendering a stale copy instead of reading the fresh one.
    return JSON.parse(JSON.stringify({active:true, name:session.name, folder:session.folder,
       tracks:session.tracks, takes:session.takes, songs:songsOf(session.takes),
       next_take_number:takeCounter + 1,
       next_take_name:suggestName(), next_take_default:suggestName(undefined, false),
       last_attempt:lastAttempt(session.takes, suggestName()),
       recording:false, cloud_queue:cq}));
  },
  finish_rehearsal: track('finish_rehearsal', async () => {
    const r = {ok:true, folder:session.folder, take_count:session.takes.length};
    session = null;
    return r;
  }),

  start_take: track('start_take', async () => { takeCounter += 1; return {ok:true, take_number:takeCounter}; }),
  set_next_take_name: track('set_next_take_name', async (name) => {
    if (!session) return {ok:false, error:'No rehearsal in progress'};
    nextName = (name || '').trim() || null;
    return {ok:true, next_take_name:suggestName()};
  }),
  // api.song_choices: the songs of the rehearsal (the live one with no
  // folder), each as the next go at it, and the rest of the repertoire.
  song_choices: track('song_choices', async (folder, n) => {
    const takes = !folder || (session && folder === session.folder)
      ? (session ? session.takes : []) : pastRehearsal(folder).takes;
    const others = takes.filter(t => t.take_number !== n);
    const here = songsOf(takes).map(s => ({song:s.name, name:nextGo(others, s.name)}));
    const seen = new Set(here.map(c => c.song.toLowerCase()));
    const other = REPERTOIRE.filter(song => !seen.has(song.toLowerCase()))
      .map(song => ({song, name:song}));
    return {here, other};
  }),
  // One input pinned at the top and one silent, unless a test plays its own.
  // Counted, so a test can wait for the page to have asked again.
  get_levels: async () => {
    window.__LEVEL_POLLS__ = (window.__LEVEL_POLLS__ || 0) + 1;
    return window.__LEVELS__ || ({'Guitar':[0.99], 'Vocals':[0.0005]});
  },
  stop_take: track('stop_take', async () => (await held('stop_take'), {ok:true, take_number:takeCounter, temp_dir:'/tmp/draft',
    duration_sec:TAKE, suggested_name:suggestName(takeCounter),
    tracks:[{name:'Guitar', file:'/rec/g.wav'}, {name:'Vocals', file:'/rec/v.wav'}]})),
  keep_take: track('keep_take', async (n, _t, name, dur, tracks, markers) => {
    const take = {take_number:n, name:name || ('Take ' + n), duration_sec:dur,
                  tracks, markers: markers || []};
    session.takes.push(take);
    if (n === takeCounter) nextName = null;
    cloudQueue = {...cloudQueue, [n]: 'queued'};
    return {ok:true, take};
  }),
  discard_take: track('discard_take', async () => ({ok:true})),
  crop_take: track('crop_take', async (folder, n, a, b) => {
    await held('crop_take');
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (!take) return {ok:false, error:'Take not found'};
    let dropped = 0;
    take.markers = (take.markers || [])
      .filter(m => { const keep = m.at >= a && m.at <= b; if (!keep) dropped++; return keep; })
      .map(m => ({...m, at: Math.round((m.at - a) * 100) / 100}));
    take.duration_sec = b - a;
    // A rewritten file is a different file as far as the player is
    // concerned, and the mock looks lengths up by path, so give it one.
    take.tracks = take.tracks.map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of take.tracks) fileDurations[t.file] = take.duration_sec;
    P = null;   // Python lets go of the files before rewriting them
    // Deep copy, same as rename_take — a live handle would let the interface
    // alias the mock's own state, which the real bridge never allows.
    return JSON.parse(JSON.stringify(
      {ok:true, take, trashed:true, location:null, markers_dropped:dropped}));
  }),
  crop_draft: track('crop_draft', async (dir, tracks, a, b) => {
    await held('crop_draft');
    const cut = (tracks || []).map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of cut) fileDurations[t.file] = b - a;
    P = null;
    return JSON.parse(JSON.stringify(
      {ok:true, tracks:cut, duration_sec: b - a, trashed:true, location:null}));
  }),

  take_media: track('take_media', async (tracks, _buckets, _from, _to) => tracks.map(t => {
    const dur = fileDurations[t.file] ?? TAKE;
    const row = Array.from({length:300}, (_, i) => Math.abs(Math.sin(i / 9)) * 0.9);
    const {icon} = withIcon({name: t.name});
    return {name:t.name, ...(icon ? {icon} : {}), url:'about:blank', frames:48000*dur,
      samplerate:48000, duration_sec:dur,
      peaks: stereo(t.name) ? [row, row.map(v => v / 2)] : [row]};
  })),

  player_open: track('player_open', async (tracks) => {
    const dur = tracks.length ? (fileDurations[tracks[0].file] ?? TAKE) : TAKE;
    P = {playing:false, position:0, t0:clock(), duration:dur, loop:null, muted:[], soloed:null,
         volumes:Object.fromEntries(tracks.map(t => [t.name, 1])),
         master:readCfg().master_volume ?? 1};
    const out = {ok:true, ...playerState()};
    if (window.__OUTPUT_GONE__) out.warning = 'That playback device is gone — using the system output.';
    return out;
  }),
  player_close: track('player_close', async () => { P = null; return {ok:true}; }),
  // An output gone quiet pauses the take and says so, the way Python does;
  // the next play opens it again.
  player_state: async () => {
    if (P && P.playing && window.__OUTPUT_QUIET__) {
      moveTo(position()); P.playing = false; P.problem = window.__OUTPUT_QUIET__;
    }
    return {...playerState(), ...(P && P.problem ? {problem:P.problem} : {})};
  },
  player_toggle: track('player_toggle', async () => {
    if (!P) return {ok:false};
    let reopened = false;
    if (P.playing) { moveTo(position()); P.playing = false; }
    else {
      if (P.problem) { P.problem = null; reopened = true; }
      if (P.position >= P.duration) moveTo(0); P.playing = true; P.t0 = clock();
    }
    return {ok:true, ...playerState(), ...(reopened ? {reopened:true} : {})};
  }),
  player_play: async () => { if (P) { P.playing = true; P.t0 = clock(); } return {ok:true, ...playerState()}; },
  player_pause: async () => { if (P) { moveTo(position()); P.playing = false; } return {ok:true, ...playerState()}; },
  player_seek: track('player_seek', async (s) => { if (P) moveTo(s); return {ok:true, ...playerState()}; }),
  player_set_loop: track('player_set_loop', async (a, b) => {
    if (!P) return {ok:false};
    P.loop = (a === null || b === null || b - a < 0.2) ? null : {a, b};
    if (P.loop && (position() < P.loop.a || position() >= P.loop.b)) moveTo(P.loop.a);
    return {ok:true, ...playerState()};
  }),
  player_set_volume: track('player_set_volume', async (n, v) => { if (P) P.volumes[n] = v; return {ok:true}; }),
  player_set_master: track('player_set_master', async (v) => { if (P) P.master = v; return {ok:true}; }),
  player_set_muted: track('player_set_muted', async (n, m) => {
    if (!P) return {ok:false};
    P.muted = m ? [...new Set([...P.muted, n])] : P.muted.filter(x => x !== n);
    return {ok:true, ...playerState()};
  }),
  player_set_solo: track('player_set_solo', async (n) => { if (P) P.soloed = n; return {ok:true, ...playerState()}; }),

  add_take_marker: track('add_take_marker', async (folder, n, sec, note, kind) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    const at = Math.round(sec * 100) / 100;
    if (take) {
      const kept = (take.markers || []).filter(m => Math.abs(m.at - at) > 0.01);
      take.markers = [...kept, {at, note: note || '', kind: kind || 'note'}]
        .sort((a, b) => a.at - b.at);
    }
    // Same reason as session_state/get_rehearsal: a live handle here would
    // let the interface alias the mock's own mutable state, which the real
    // bridge's JSON round-trip never allows.
    return JSON.parse(JSON.stringify({ok:true, markers: take ? take.markers : []}));
  }),
  update_take_marker: track('update_take_marker', async (folder, n, sec, note, kind) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) for (const m of take.markers || []) {
      if (Math.abs(m.at - sec) <= 0.01) {
        if (note !== null && note !== undefined) m.note = note;
        if (kind !== null && kind !== undefined) m.kind = kind;
      }
    }
    return {ok:true, markers: take ? take.markers : []};
  }),
  remove_take_marker: track('remove_take_marker', async (folder, n, sec) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) take.markers = (take.markers || []).filter(m => Math.abs(m.at - sec) > 0.01);
    return {ok:true, markers: take ? take.markers : []};
  }),

  rename_take: track('rename_take', async (folder, n, name) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) take.name = name;
    // Deep copy, same as session_state/get_rehearsal — a live handle would
    // alias the mock's own state, which the real bridge's JSON round-trip
    // never allows.
    return JSON.parse(JSON.stringify({ok:true, take}));
  }),
  rename_rehearsal: track('rename_rehearsal', async (folder, name) => {
    if (session) session.name = name;
    return {ok:true, folder:'/rec/' + name, name,
            takes: session ? session.takes : []};
  }),

  list_drafts: async () => drafts,
  recover_draft: track('recover_draft', async (dir) => {
    await held('recover_draft');
    if (window.__RECOVER_FAILS__)
      return {ok:false, error:'Could not recover the take: its folder is read-only'};
    drafts = drafts.filter(d => d.dir !== dir);
    return {ok:true, take:{take_number:1, name:'Recovered', duration_sec:5, tracks:[], markers:[]}};
  }),
  discard_draft: track('discard_draft', async (dir) => {
    drafts = drafts.filter(d => d.dir !== dir);
    return {ok:true, trashed:true};
  }),

  list_rehearsals: track('list_rehearsals', async () => ([
    {folder:'/rec/old', name:'Tuesday jam', created_at:'2026-09-10T19:00:00',
     take_count:9, total_duration_sec:2520, disk_bytes:1200000000, in_cloud:3,
     songs:[{name:'Polyn', takes:3}, {name:'Vesna', takes:2}, {name:'Ogon', takes:1},
            {name:'Sonce', takes:1}, {name:'Dym', takes:1}, {name:'Ptaha', takes:1}],
     runs:[{song:'Polyn', takes:[{duration_sec:300, keep:false}, {duration_sec:280, keep:false},
                                 {duration_sec:290, keep:true}]},
           {song:'Vesna', takes:[{duration_sec:260, keep:false}, {duration_sec:250, keep:false}]},
           {song:'Ogon', takes:[{duration_sec:330, keep:false}]},
           {song:'Sonce', takes:[{duration_sec:240, keep:false}]},
           {song:'Dym', takes:[{duration_sec:270, keep:false}]},
           {song:'Ptaha', takes:[{duration_sec:300, keep:false}]}]},
    {folder:'/rec/quiet', name:'Wednesday jam', created_at:'2026-09-03T19:00:00',
     take_count:2, total_duration_sec:600, disk_bytes:340000000, songs:[],
     runs:runsOf(pastRehearsal('/rec/quiet').takes)},
    {folder:'/rec/older', name:'First rehearsal', created_at:'2026-08-25T19:00:00',
     take_count:2, total_duration_sec:470, disk_bytes:160000000, songs:[{name:'Doroga', takes:2}],
     runs:runsOf(pastRehearsal('/rec/older').takes)},
    ...(missingRehearsal ? [missingRehearsal] : [])])),
  forget_rehearsal: track('forget_rehearsal', async (folder) => {
    if (missingRehearsal && folder === missingRehearsal.folder) missingRehearsal = null;
    return {ok:true};
  }),
  choose_rehearsal_folder: track('choose_rehearsal_folder', async (folder) => {
    if (window.__CANCEL_LOCATE__) return {ok:false, cancelled:true};
    if (missingRehearsal && folder === missingRehearsal.folder) missingRehearsal = null;
    return {ok:true, folder:'/rec/relocated'};
  }),
  get_rehearsal: track('get_rehearsal', async (folder) => {
    if (window.__REHEARSAL_UNREADABLE__)
      return {ok:false, error:'Could not read the rehearsal: session.json is damaged'};
    const r = pastRehearsal(folder);
    for (const t of r.takes) fileDurations[t.tracks[0].file] = t.duration_sec;
    return JSON.parse(JSON.stringify({ok:true, ...r, songs:songsOf(r.takes)}));
  }),
  // The setup screen's last time (api.last_time): Tuesday jam song by song,
  // Doroga from the rehearsal before it, and the others in history's order.
  // A page with window.__NO_HISTORY__ has none of it.
  last_time: track('last_time', async () => {
    if (window.__NO_HISTORY__) return {last:null, not_played:[], earlier:[], count:0};
    const last = pastRehearsal('/rec/old');
    const older = pastRehearsal('/rec/older');
    for (const r of [last, older])
      for (const t of r.takes) fileDurations[t.tracks[0].file] = t.duration_sec;
    const inCloud = last.takes.filter(t => t.cloud && (t.cloud.mix || t.cloud.tracks)).length;
    const earlier = [
      {folder:'/rec/quiet', name:'Wednesday jam', created_at:'2026-09-03T19:00:00',
       take_count:2, total_duration_sec:600, missing:false},
      {folder:'/rec/older', name:'First rehearsal', created_at:'2026-08-25T19:00:00',
       take_count:2, total_duration_sec:470, missing:false},
      ...(missingRehearsal ? [{folder:missingRehearsal.folder, name:missingRehearsal.name,
        created_at:missingRehearsal.created_at, take_count:5, total_duration_sec:1200,
        missing:true}] : [])];
    return JSON.parse(JSON.stringify({
      last: {...last, songs:songsOf(last.takes), runs:runsOf(last.takes), in_cloud:inCloud},
      not_played: [{name:'Doroga', folder:'/rec/older', rehearsal:'First rehearsal',
                    created_at:'2026-08-25T19:00:00', goes:2, take:older.takes[1]}],
      earlier,
      count: earlier.length + 1}));
  }),
  delete_take: track('delete_take', async () => ({ok:true, trashed:true, takes_left:0})),
  delete_rehearsal: track('delete_rehearsal', async () => ({ok:true, trashed:true})),

  set_cloud_dir: track('set_cloud_dir', async (p) => { cloudDir = p; return {ok:true, cloud_dir:p}; }),
  choose_cloud_dir: track('choose_cloud_dir', async () => {
    cloudDir = '/Users/alex/Google Drive/Band';
    return {ok:true, cloud_dir:cloudDir};
  }),
  // Python switches sending off with the folder (api.py, clear_cloud_dir):
  // left on, every take saved afterwards is queued, refused and marked "No
  // cloud folder chosen". The mock said only that the folder was gone, so
  // the suite was checking a state the app never gets into.
  clear_cloud_dir: track('clear_cloud_dir', async () => {
    cloudDir = null;
    autoPublish = {on:false, what:autoPublish.what};
    return {ok:true};
  }),
  share_take: track('share_take', async (folder, n, what) => {
    if (!cloudDir) return {ok:false, error:'No cloud folder chosen', needs_dir:true};
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    const shared = {};
    if (what === 'mix' || what === 'both') shared.mix = cloudDir + '/mix.wav';
    if (what === 'tracks' || what === 'both') shared.tracks = cloudDir + '/tracks';
    if (take) take.cloud = shared;
    // Deep copy, same as session_state/get_rehearsal — a live handle would
    // alias the mock's own state, which the real bridge's JSON round-trip
    // never allows.
    return JSON.parse(JSON.stringify({ok:true, take, cloud:shared}));
  }),
  unshare_take: track('unshare_take', async (folder, n) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) take.cloud = {};
    return JSON.parse(JSON.stringify({ok:true, removed:[], trashed:true}));
  }),

  // Settings › Under the hood: the machine, the report, and the check of
  // the interface, which a page scripts through __CHECK_RESULT__ ('works',
  // 'no_sound') and __CHECK_MS__, how long it listens.
  under_the_hood: track('under_the_hood', async () => ({
    version:'0.2.0', running_as:'source', executable:'python.exe',
    system:'Windows 11 Pro 10.0.26200, x64',
    audio:{engine:'PortAudio V19.7.0-devel',
           systems:[{name:'MME', devices:6}, {name:'ASIO', devices:2},
                    {name:'Windows WASAPI', devices:4}],
           recording:{name:'X32 USB', host_api:'ASIO', inputs:16,
                      samplerate:48000, bit_depth:24},
           playback:'System output'},
    files:[{key:'settings', path:'C:\\Users\\alex\\.rehearsal-recorder\\config.json',
            exists:true, size:2100, modified:'2026-09-29T10:00:00'},
           {key:'history', path:'C:\\Users\\alex\\RehearsalRecordings\\library.sqlite',
            exists:true, size:98304, modified:'2026-09-29T10:00:00'},
           {key:'crash_log', path:'C:\\Users\\alex\\.rehearsal-recorder\\crash.log',
            exists:true, size:5120, modified:'2026-09-29T10:00:00'}],
    deleting:'system', fallback_trash:'_deleted', libsndfile:'1.2.2',
    server_url:'http://127.0.0.1:1234',
    releases_url:'https://github.com/voronizer/rehearsal-recorder/releases'})),
  bug_report: track('bug_report', async () => ({ok:true,
    text:'Rehearsal Recorder 0.2.0, run from source\nWindows 11 Pro 10.0.26200, x64\n'})),
  show_file: track('show_file', async () => ({ok:true})),
  open_releases: track('open_releases', async () => ({ok:true})),
  start_interface_check: track('start_interface_check', async () => {
    const result = window.__CHECK_RESULT__ || 'works';
    const works = result !== 'no_sound';
    const first = {label:'the settings in force', opened:true, flowing:works,
                   frames: works ? 48000 : 1024, expected:48000, error:null};
    checkState = {running:true, stopped:false, rows:[], verdict:null, peaks:null,
      signal:null, checked_at:null,
      device:{name:'X32 USB', host_api:'ASIO', channels:6, samplerate:48000, bit_depth:24}};
    const mine = checkState;
    setTimeout(() => { if (mine.running) mine.rows = [first]; }, 150);
    setTimeout(() => {
      if (!mine.running) return;
      if (works) {
        mine.rows = [first];
        mine.verdict = {cause:'none', headline:'It works now.', advice:'-'};
        const hushed = result === 'silent';
        mine.peaks = hushed ? [0, 0, 0, 0, 0, 0] : [0.4, 0.3, 0, 0.2, 0, 0];
        mine.signal = hushed
          ? "sound arrives, but every input is silent — play into them, or look at what the card's own routing sends, and check again"
          : 'signal on inputs 1, 2, 4; the rest silent';
      } else {
        mine.rows = [first, {...first, label:'the first two channels only'}];
        mine.verdict = {cause:'no_sound', headline:'The card opens, but sends no sound.',
          advice:'The driver takes the stream and then delivers little or nothing.'};
      }
      mine.checked_at = '2026-09-29T14:05:00';
      mine.running = false;
    }, window.__CHECK_MS__ || 900);
    return {ok:true};
  }),
  interface_check: async () => JSON.parse(JSON.stringify(checkState)),
  stop_interface_check: track('stop_interface_check', async () => {
    if (checkState.running) {
      checkState.running = false; checkState.stopped = true;
      checkState.checked_at = '2026-09-29T14:06:00';
    }
    return {ok:true};
  }),
  get_settings: async () => ({recordings_dir:'/Users/alex/RehearsalRecordings',
    default_recordings_dir:'/Users/alex/RehearsalRecordings',
    device_index: window.__PLUGGED_IN_LATE__ ? (pluggedIn ? 1 : null)
      : recording.device_index,
    missing_device: window.__PLUGGED_IN_LATE__ && !pluggedIn
      ? {name:'X18/XR18', host_api:'Core Audio'} : null,
    samplerate: recording.samplerate,
    bit_depth: recording.bit_depth, supported_bit_depths:[16, 24],
    tracks:[], volumes:{}, output_device_index: outputDevice.index,
    output_channels: outputDevice.channels || [1, 2],
    cloud_format: cloudFormat,
    auto_publish: autoPublish.on, auto_publish_what: autoPublish.what,
    cloud_formats:[
      {id:'wav', label:'As recorded', hint:'Exactly the files on disk.'},
      {id:'flac', label:'Lossless (FLAC)', hint:'About half the size.'},
      {id:'mp3', label:'Compressed (MP3)', hint:'Roughly a tenth, lossy.'}],
    encoder: window.__NO_ENCODER__ ? null : 'soundfile',
    encoder_hint: window.__NO_ENCODER__
      ? 'The soundfile package is missing, so copies will go up as WAV.'
      : null,
    trash_kind: window.__TRASH_KIND__ || 'system',
    fallback_trash: '_deleted',
    path_warning: window.__PATH_WARNING__ || null,
    theme: readCfg().theme, ui_scale: readCfg().ui_scale,
    cloud_dir: cloudDir,
    server_url:'http://127.0.0.1:1234/', config_path:'/Users/alex/.rehearsal-recorder/config.json',
    version:'0.2.0'}),
  // A folder under /nope cannot be written to. Its message carries the
  // whole path, so a long one shows what a long message does to a notice.
  set_recordings_dir: async (p) => (p.startsWith('/nope')
    ? {ok:false, error:'Cannot write to ' + p}
    : {ok:true, recordings_dir:p}),
  choose_recordings_dir: track('choose_recordings_dir', async () => ({ok:true, recordings_dir:'/Users/alex/Dropbox/Band'})),
  save_mix: track('save_mix', async () => ({ok:true})),
  save_master_volume: track('save_master_volume', async (v) => {
    writeCfg({...readCfg(), master_volume:v});
    return {ok:true};
  }),
  save_appearance: track('save_appearance', async (theme, scale) => {
    writeCfg({...readCfg(), theme, ui_scale:scale});
    return {ok:true};
  }),
});
window.pywebview = { api: window.__MAKE_API__() };
// A page can make a call fail the way pywebview fails one whose Python
// raised: the promise rejects with an Error carrying the exception's name.
for (const [method, message] of Object.entries(window.__FAIL__ || {})) {
  window.pywebview.api[method] = async () => {
    const e = new Error(message);
    e.name = 'UnicodeEncodeError';
    throw e;
  };
}
