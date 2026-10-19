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
let playerClick = false;       // player_set_click: off in a fresh app, kept from take to take
let session = null;
let controlSequence = 0;
let controlEvents = [];
let controlPending = null;
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
          levels:levels(), master_level:masterLevel(), click:playerClick};
}
function moveTo(t) { P.position = Math.max(0, Math.min(P.duration, t)); P.t0 = clock(); }

// The rehearsals before this one, as get_rehearsal gives them. Tuesday jam
// is one take long unless a page asks for a fuller evening; the others are
// what the setup screen's last time needs: one with nothing named, and an
// older one with a song Tuesday jam did not play.
// Takes starred in the rehearsals before this one, as "folder#take_number".
// A page can star some with window.__STARRED__; set_take_star adds and
// removes. The live session's takes carry their own `starred`.
const stars = new Set(window.__STARRED__ || []);
function withStars(r) {
  for (const t of r.takes) t.starred = stars.has(`${r.folder}#${t.take_number}`);
  return r;
}
// Takes in the cloud folder, in the rehearsals before this one, as
// "folder#take_number". Python records a copy once it is made, not when it is
// asked for, so a page sets window.__SHARED__ as its scripted copy finishes.
function withCloud(r) {
  for (const t of r.takes)
    if ((window.__SHARED__ || []).includes(`${r.folder}#${t.take_number}`))
      t.cloud = {mix:`/cloud/${r.name}/${t.name}.mp3`, mix_format:'mp3'};
  return r;
}

// A page can ask for more marks across the library (window.__MORE_MARKS__),
// for History's Marks view: Daroha 2 at First rehearsal, Pałyn 8 at the
// Missing jam, and two on Take 1 at the Wednesday jam.

// Marks changed on takes of the rehearsals before this one, as
// "folder#take_number": those rehearsals are built afresh on every call, so
// what the player changed is kept here and laid over them.
const pastMarks = {};
// Takes of the rehearsals before this one that were cropped, by
// "folder#take_number": their length and their rewritten files, laid over
// them as their marks are; a crop's Undo takes it off again.
const pastCrops = {};
function withEdits(r) {
  for (const t of r.takes) {
    const crop = pastCrops[`${r.folder}#${t.take_number}`];
    if (crop) Object.assign(t, crop);
    const kept = pastMarks[`${r.folder}#${t.take_number}`];
    if (kept) t.markers = kept.map(m => ({...m, label_id: labelIdOf(m.label_id)}));
  }
  return r;
}
// The take a mark is changed on: tonight's, or one of a rehearsal before.
async function markedTake(folder, n) {
  if (session && folder === session.folder) return session.takes.find(t => t.take_number === n);
  const r = (await libraryNow()).find(x => x.folder === folder);
  return r && r.takes.find(t => t.take_number === n);
}
function keepMarks(folder, n, take) {
  if (take && !(session && folder === session.folder)) pastMarks[`${folder}#${n}`] = take.markers;
}
// crop_take on a take of a rehearsal before this one: laid over it in
// pastCrops and pastMarks, which its Undo puts back as they were.
async function cropPast(folder, n, a, b) {
  const take = await markedTake(folder, n);
  if (!take) return {ok:false, error:'Take not found'};
  [a, b] = cutAt(take, a, b, take.duration_sec);
  const key = `${folder}#${n}`;
  const was = {crop: pastCrops[key], marks: pastMarks[key]};
  let dropped = 0;
  const markers = (take.markers || [])
    .filter(m => { const keep = m.at >= a && m.at <= b; if (!keep) dropped++; return keep; })
    .map(m => ({...m, at: Math.round((m.at - a) * 100) / 100}));
  const tracks = take.tracks.map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
  pastCrops[key] = {duration_sec: b - a, tracks};
  pastMarks[key] = markers;
  for (const t of tracks) fileDurations[t.file] = b - a;
  P = null;
  const ended = endHeld(folder, [n], true);
  const undo = hold(() => {
    if (was.crop) pastCrops[key] = was.crop; else delete pastCrops[key];
    if (was.marks) pastMarks[key] = was.marks; else delete pastMarks[key];
    P = null;
    return {kind:'crop', folder, take_numbers:[n]};
  }, {folder, takes:[n], crop:true});
  return JSON.parse(JSON.stringify({ok:true, take:{...take, duration_sec: b - a, tracks, markers},
    markers_dropped:dropped, undo, ended, start_sec:a, end_sec:b}));
}

// The library's labels, in their order, as list_labels gives them: the four
// every library starts with (migration 0004), or a page's own
// (window.__LABELS__ = [{id, name, colour}, …]).
let labels = (window.__LABELS__ || [
  {id:1, name:'Note', colour:'grey'},
  {id:2, name:'Keep this', colour:'green'},
  {id:3, name:'Went wrong', colour:'red'},
  {id:4, name:'Do again', colour:'amber'},
]).map(l => ({...l}));
const LABEL_COLOURS = ['grey', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];
// Ids are never given twice, as in Python (AUTOINCREMENT).
let nextLabelId = Math.max(0, ...labels.map(l => l.id)) + 1;

function labelRefusal(name, colour, id) {
  const trimmed = String(name || '').trim().slice(0, 40).trim();
  if (!trimmed) return 'A label needs a name';
  const other = labels.find(l => l.id !== id && l.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  if (other) return `There is already a label called ${other.name}`;
  if (!LABEL_COLOURS.includes(colour)) return 'Pick a colour from the palette';
  return null;
}

// The recordings folder in use: the one get_settings starts on, then each
// switched to.
let recordingsNow = '/Users/alex/RehearsalRecordings';

// Another recordings folder is another library, with labels of its own: a
// page can give them (window.__OTHER_FOLDER_LABELS__ = [{id, name, colour}, …]).
function toOtherFolder() {
  if (!window.__OTHER_FOLDER_LABELS__) return;
  labels = window.__OTHER_FOLDER_LABELS__.map(l => ({...l}));
  nextLabelId = Math.max(0, ...labels.map(l => l.id)) + 1;
}

// Where the marks of a deleted label went: the past rehearsals are built
// afresh on every call, so their marks are moved as they are sent.
const movedMarks = {};

// A mark's label as Python keeps it: one there is, or the first.
function labelIdOf(id) {
  while (movedMarks[id] !== undefined) id = movedMarks[id];
  return labels.some(l => l.id === id) ? id : labels[0].id;
}

// When the live rehearsal was made, for the marks in it: Python has it in
// the library from its start.
const TONIGHT_AT = '2026-10-06T19:00:00';

// Every mark in the library, the live rehearsal's first, as Python has them:
// [{r: the rehearsal, t: the take, m: the mark}], the newest rehearsal first,
// then the order played, then the moment.
async function marksNow() {
  const all = await libraryNow();
  const rehearsals = [
    ...(session ? [{folder:session.folder, name:session.name, created_at:TONIGHT_AT,
                    missing:false, takes:session.takes}] : []),
    ...all.filter(r => !session || r.folder !== session.folder)];
  const out = [];
  for (const r of rehearsals)
    for (const t of [...r.takes].sort((a, b) => a.take_number - b.take_number))
      for (const m of [...(t.markers || [])].sort((a, b) => a.at - b.at))
        out.push({r, t, m: {...m, label_id: labelIdOf(m.label_id)}});
  return out;
}

// The labels with how many marks each has, in how many rehearsals, and the
// newest of them (api.list_labels).
async function labelsAsSent() {
  const marks = await marksNow();
  return labels.map(l => {
    const mine = marks.filter(x => x.m.label_id === l.id);
    const days = mine.map(x => x.r.created_at).sort();
    return {...l, marks: mine.length, rehearsals: new Set(mine.map(x => x.r.folder)).size,
            last_marked: days.length ? days[days.length - 1] : null};
  });
}

function pastRehearsal(folder) {
  if (folder === '/rec/quiet') {
    const takes = [
      {take_number:1, name:'Take 1', duration_sec:300,
       markers: window.__MORE_MARKS__
         ? [{at:120, note:'the riff', label_id:1}, {at:200, note:'the riff, slower', label_id:1}] : [],
       tracks:[{name:'Guitar', file:'/rec/quiet/t1.wav'}]},
      {take_number:2, name:'Take 2', duration_sec:300, markers:[],
       tracks:[{name:'Guitar', file:'/rec/quiet/t2.wav'}]}];
    return withCloud(withStars(withEdits({folder, name:'Wednesday jam', created_at:'2026-09-03T19:00:00', takes: asSent(takes)})));
  }
  if (folder === '/rec/older') {
    const takes = [
      {take_number:1, name:'Daroha', duration_sec:230, markers:[],
       tracks:[{name:'Guitar', file:'/rec/older/d1.wav'}]},
      {take_number:2, name:'Daroha 2', duration_sec:240,
       markers: window.__MORE_MARKS__ ? [{at:30, note:'', label_id:3}] : [],
       tracks:[{name:'Guitar', file:'/rec/older/d2.wav'}]}];
    return withCloud(withStars(withEdits({folder, name:'First rehearsal', created_at:'2026-08-25T19:00:00', takes: asSent(takes)})));
  }
  // Its own path, distinct from the live session's /rec/g.wav — two takes
  // sharing a dummy path would let one's mocked length leak onto the other.
  // A page can ask for another length, to put a tick where it wants one.
  const oldLength = window.__OLD_LENGTH_SEC__ || 600;
  // A page can ask for a fuller evening, for the rehearsal overview.
  const takes = window.__FULL_EVENING__ ? [
    {take_number:1, name:'Pałyn', duration_sec:192, markers:[],
     tracks:[{name:'Guitar', file:'/rec/old/p1.wav'}]},
    {take_number:2, name:'Pałyn 2', duration_sec:178,
     markers:[{at:72, note:'this one is the take', label_id:2}],
     cloud:{mix:'/cloud/Tuesday jam/02 - Pałyn 2.mp3', mix_format:'mp3'},
     tracks:[{name:'Guitar', file:'/rec/old/p2.wav'}]},
    {take_number:3, name:'Take 3', duration_sec:90,
     markers:[{at:5, note:'', label_id:1}],
     tracks:[{name:'Guitar', file:'/rec/old/t3.wav'}]},
    {take_number:4, name:'Viasna', duration_sec:250,
     markers:[{at:40, note:'guitar drifts here', label_id:3}],
     tracks:[{name:'Guitar', file:'/rec/old/v1.wav'}]},
  ] : [{take_number:1, name:'Pałyn', duration_sec:oldLength, markers:[],
        tracks:[{name:'Guitar', file:'/rec/old/g.wav'}],
        // A page can give it notes: {notes, notes_missing}, as a take has them.
        ...(window.__OLD_TAKE_NOTES__ || {})}];
  return withCloud(withStars(withEdits({folder, name:'Tuesday jam', created_at:'2026-09-10T19:00:00', takes: asSent(takes)})));
}

// The whole library, as History's Songs view reads it (api.list_songs and
// api.get_song): every rehearsal with its takes, and whether its folder is on
// disk. Missing jam's takes are only here: the Rehearsals view never reads
// them, since its folder is gone. The band sets its own.
//
// A page can add songs with window.__EXTRA_SONGS__ = ['Opus', …]: takes of
// First rehearsal after its two, 200 s each, read by this alone.
function goneTakes() {
  const take = (n, name, song, go, length) => ({take_number:n, name, song, go,
    ...meterOf(song),
    duration_sec:length, starred: stars.has(`/rec/gone#${n}`),
    markers: window.__MORE_MARKS__ && n === 1 ? [{at:60, note:'late again', label_id:3}] : [],
    tracks:[{name:'Guitar', file:`/rec/gone/t${n}.wav`}]});
  // Numbered apart from the other rehearsals' goes, so a test naming one
  // names one take.
  return [take(1, 'Pałyn 8', 'Pałyn', 8, 240), take(2, 'Pałyn 9', 'Pałyn', 9, 250),
          take(3, 'Daroha 8', 'Daroha', 8, 230), take(4, 'Daroha 9', 'Daroha', 9, 240),
          take(5, 'Take 5', null, null, 240)];
}
function withExtraSongs(r) {
  const takes = [...r.takes];
  for (const name of window.__EXTRA_SONGS__ || []) {
    const n = takes.length + 1;
    const named = resolved(name, takes, n);
    takes.push({take_number:n, duration_sec:200, markers:[],
      tracks:[{name:'Guitar', file:`${r.folder}/x${n}.wav`}],
      ...meterOf(named.song), ...named, starred: stars.has(`${r.folder}#${n}`)});
  }
  return {...r, takes};
}
// Takes deleted from the rehearsals before this one, as "folder#take_number":
// gone from the library the Songs view reads.
const deleted = new Set();
// Removals waiting for their Undo, by the token each answered with, as
// Python keeps them in its holding folder: each is the function that puts
// it back and answers what came back. undo_trash runs one, end_trash
// forgets it (it has gone on to the Trash). A test reads which are waiting.
window.__UNDOABLE__ = {};
// What each waiting removal took, {folder, takes?, crop?}, for the ends
// Python makes on its own (api.py _ends).
const heldItems = {};
// The tokens whose Undo put them back: asked again, they are back already.
const backAgain = new Set();
let removals = 0;
function hold(putBack, item) {
  const token = `undo-${++removals}`;
  window.__UNDOABLE__[token] = putBack;
  heldItems[token] = item;
  return token;
}
function forgetHeld(token) {
  delete window.__UNDOABLE__[token];
  delete heldItems[token];
}
// Python's own ends: removing a take ends what waits of that take, a crop
// of it among them; a crop, the take's earlier crops; a rehearsal, all of
// it, its drafts too. They go on to the Trash, with no Undo left, and the
// call answers their tokens ("ended"), as Python's do. Matched here by the
// folder each was made with, which a rename does not change (spelledNow):
// Python knows them by the rehearsal's id.
function endHeld(folder, takes, cropsOnly = false) {
  const ended = [];
  for (const [token, item] of Object.entries(heldItems)) {
    if (cropsOnly && !item.crop) continue;
    const same = takes
      ? item.folder === folder && (item.takes || []).some(n => takes.includes(n))
      : item.folder === folder || item.folder.startsWith(folder + '/');
    if (same) {
      forgetHeld(token);
      ended.push(token);
    }
  }
  return ended;
}
// Rehearsals renamed (rename_rehearsal), by the folder each was made with:
// the folder it has now. Python moves the folder and goes on knowing the
// rehearsal by its id; here everything stays kept under the folder it was
// made with, and the two cross at the bridge (spelledNow): what comes in
// under the new folder is read under the old one, and what goes out under
// the old one is said under the new. A path under a folder a rename moved
// away is not there any more: a call that names one finds no rehearsal, as
// Python's would, but take_media, which says it of each track it cannot
// find. A test reads the calls as the interface made them.
const renamedTo = new Map();
const formerFolders = new Set();
// A rehearsal before this one, renamed: its name now, by the folder it was
// made with.
const pastNames = new Map();
const under = (path, folder) => path === folder || path.startsWith(folder + '/');
function cameIn(path) {
  for (const [made, now] of renamedTo) if (under(path, now)) return made + path.slice(now.length);
  for (const former of formerFolders) if (under(path, former)) return '/gone' + path;
  return path;
}
function goesOut(path) {
  for (const [made, now] of renamedTo) if (under(path, made)) return now + path.slice(made.length);
  return path;
}
function respell(value, spell) {
  if (typeof value === 'string') return spell(value);
  if (Array.isArray(value)) return value.map(v => respell(v, spell));
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, respell(v, spell)]));
  return value;
}
function spelledNow(api) {
  for (const [method, call] of Object.entries(api)) {
    if (typeof call !== 'function') continue;
    api[method] = async (...args) => {
      if (!renamedTo.size) return call(...args);
      let stale = false;
      const read = respell(args, path => {
        const now = cameIn(path);
        if (now.startsWith('/gone/')) stale = true;
        return now;
      });
      if (stale && method !== 'take_media') {
        window.__CALLS__.push({name: method, args});
        return {ok:false, error:'Rehearsal not found'};
      }
      // A tracked call is logged as it starts, before its first await:
      // logged with what the interface sent, not the folder it was made with.
      const at = window.__CALLS__.length;
      const answer = call(...read);
      if (window.__CALLS__.length > at) window.__CALLS__[at].args = args;
      return respell(await answer, goesOut);
    };
  }
  return api;
}
// Everything waiting ends before the recordings folder changes (api.py
// _end_all), and is answered as ended; what window.__KEPT__ names is what
// could not be, which stays in the old folder all the same.
function endEverything() {
  const ended = Object.keys(heldItems);
  for (const token of ended) forgetHeld(token);
  return ended;
}
// Takes of the live rehearsal taken out of it, back where they were.
function backTonight(folder, takes) {
  if (!session || session.folder !== folder) return;
  session.takes = [...session.takes, ...takes].sort((a, b) => a.take_number - b.take_number);
}
let library = async () => [
  pastRehearsal('/rec/old'), pastRehearsal('/rec/quiet'), withExtraSongs(pastRehearsal('/rec/older')),
  ...(missingRehearsal ? [{folder:missingRehearsal.folder, name:missingRehearsal.name,
    created_at:missingRehearsal.created_at, takes:goneTakes(), missing:true}] : []),
];
// Rehearsals deleted, by folder: gone from the library too.
const deletedRehearsals = new Set();
// Takes whose song a rename or a merge changed (api.rename_song,
// api.merge_songs), as "folder#take_number" → {song, go}: the rehearsals
// before this one are built afresh on every call, so this is laid over them.
const retitled = new Map();
function retitle(r, t) {
  const o = retitled.get(`${r.folder}#${t.take_number}`);
  return o ? {...t, song:o.song, go:o.go, name:`${o.song} ${o.go}`} : t;
}
async function libraryNow() {
  const all = (await library()).filter(r => !deletedRehearsals.has(r.folder)).map(r => ({...r,
    name: pastNames.get(r.folder) ?? r.name, missing: Boolean(r.missing),
    takes: r.takes.filter(t => !deleted.has(`${r.folder}#${t.take_number}`)).map(t => retitle(r, t))}));
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
// Python numbers songs as they are made; here, in the order they were first
// played, oldest first, once: a song renamed keeps its id, as in Python. A
// page can add songs with no goes left (window.__TAKELESS_SONGS__ = ['Old']),
// which Python keeps and the Songs view does not list.
const knownIds = new Map();
function songIds(all) {
  for (const r of [...all].reverse())
    for (const t of r.takes) if (t.song && !knownIds.has(t.song)) knownIds.set(t.song, knownIds.size + 1);
  for (const title of window.__TAKELESS_SONGS__ || [])
    if (!knownIds.has(title)) knownIds.set(title, knownIds.size + 1);
  return knownIds;
}
const titleOfId = (id) => [...knownIds].find(([, i]) => i === id)?.[0];

// Songs' old names (Library song_name): titles renamed or merged away, which
// typed are the song they went to. Keyed lower case: {name, song}. A page
// can give some (window.__OLD_NAMES__ = [['Palyn', 'Pałyn'], …]).
const oldNames = new Map((window.__OLD_NAMES__ || []).map(([name, song]) =>
  [name.toLowerCase(), {name, song}]));
const alsoOf = (song) => [...oldNames.values()].filter(v => v.song === song).map(v => v.name)
  .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
// What a rename or a merge leaves in the background-work list, done.
// Its title says how many takes, as api.rename_song and merge_songs title it.
function namesDone(title, n) {
  window.__ACTIVITY__ = [...(window.__ACTIVITY__ || []), {
    id: 950 + (window.__ACTIVITY__ || []).length, kind:'names',
    title: `${title} · ${n === 1 ? '1 take' : `${n} takes`}`, folder:null,
    take_number:null, state:'done', fraction:1, step:null, error:null,
    detail: n === 1 ? '1 take renamed' : `${n} takes renamed`, retry:null, seen:false}];
}
// api._plays_of: the newest ★ go on disk, else the last go at the newest
// rehearsal on disk.
function songPlays(goes) {
  const onDisk = goes.filter(g => !g.missing);
  if (!onDisk.length) return null;
  const star = onDisk.find(g => g.take.starred);
  const folder = star ? star.folder : onDisk[0].folder;
  const pick = onDisk.filter(g => g.folder === folder && (!star || g.take.starred)).at(-1);
  return {folder:pick.folder, rehearsal:pick.rehearsal, created_at:pick.created_at, take:pick.take};
}

// The rest of the band's repertoire, as other rehearsals in the library
// played it, the latest first.
const REPERTOIRE = ['Pałyn', 'Viasna', 'Ahoń', 'Sonca', 'Dym', 'Ptuška', 'Daroha'];
// The repertoire as renames and merges have left it. A page can add songs
// to it (window.__MORE_SONGS__ = ['Opus', …]), played at other rehearsals.
let repertoire = [...REPERTOIRE, ...(window.__MORE_SONGS__ || [])];

// The tempo each song of the repertoire has and the signature it is counted
// in, by title as the library keeps them with the song (a 6/8 song's tempo
// counts eighths). Dym and Ptuška have none: their first take kept to the
// click gives them one. A page can change them, a song to its tempo or to
// null for none: window.__SONG_TEMPOS__ = {Dym: {tempo: 104, signature:
// '4/4'}, Sonca: null}.
const songTempos = new Map(Object.entries({
  'Pałyn': {tempo: 128, signature: '4/4'}, 'Viasna': {tempo: 128, signature: '4/4'},
  'Ahoń': {tempo: 198, signature: '6/8'}, 'Sonca': {tempo: 96, signature: '3/4'},
  'Daroha': {tempo: 118, signature: '4/4'},
  ...(window.__SONG_TEMPOS__ || {}),
}).filter(([, own]) => own));
// What a song page and a list carry of it.
const tempoOf = (title) => {
  const own = title ? songTempos.get(title) : null;
  return {tempo: own ? own.tempo : null, signature: own ? own.signature : null};
};
// What the metronome gave a take in the fixtures: one of a song with a tempo
// was recorded to the click at it, any other has none. A fixture says
// otherwise with tempo, signature and click of its own.
const NO_METER = {tempo: null, signature: null, click: false};
const meterOf = (title) => {
  const own = title ? songTempos.get(title) : null;
  return own ? {tempo: own.tempo, signature: own.signature, click: true} : NO_METER;
};

// Python groups takes by the song each is a go at (api._songs_of) and hands
// the result over; the mock does the same.
function songsOf(takes) {
  const songs = [], bySong = {};
  for (const t of takes) {
    if (!t.song) continue;
    if (bySong[t.song]) { bySong[t.song].takes++; bySong[t.song].take_numbers.push(t.take_number); }
    else { bySong[t.song] = {name: t.song, takes: 1, take_numbers: [t.take_number]}; songs.push(bySong[t.song]); }
  }
  return songs;
}

// And api._runs_of: the evening in order, in runs of goes at one song, each
// go as its length and whether it is starred.
function runsOf(takes) {
  const runs = [];
  for (const t of takes) {
    const song = t.song || null;
    const go = {duration_sec: t.duration_sec,
                starred: Boolean(t.starred)};
    if (runs.length && runs[runs.length - 1].song === song) runs[runs.length - 1].takes.push(go);
    else runs.push({song, takes: [go]});
  }
  return runs;
}

// And api.last_time's "plays": a song's newest ★ go across the rehearsals
// given, newest first, or with none its last go at `r`.
function playsOf(song, r, goes, rehearsals) {
  for (const x of rehearsals)
    for (const t of [...x.takes].reverse())
      if (t.starred && t.song === song)
        return {folder:x.folder, rehearsal:x.name, created_at:x.created_at, take:t};
  return {folder:r.folder, rehearsal:r.name, created_at:r.created_at, take:goes[goes.length - 1]};
}

// And api._last_attempt: how long the latest go at a song ran, tonight, or
// with none the go before tonight (`before`, goBeforeTonight's), with its day.
function lastAttempt(takes, song, before = null) {
  if (!song) return null;
  const goes = takes.filter(t => t.song === song);
  if (goes.length) return {song, duration_sec: goes[goes.length - 1].duration_sec};
  return before ? {song, duration_sec: before.take.duration_sec,
                   created_at: before.created_at} : null;
}

// api._go_before_tonight: the go at a song played before tonight that it is
// measured against — songPlays' pick over the library, less the rehearsal in
// progress and the rehearsals not on disk.
async function goBeforeTonight(song) {
  if (!song) return null;
  const goes = [];
  for (const r of await libraryNow()) {
    if (r.missing || (session && r.folder === session.folder)) continue;
    for (const t of r.takes)
      if (t.song && t.song.toLowerCase() === song.toLowerCase()) {
        for (const tr of t.tracks) fileDurations[tr.file] = t.duration_sec;
        goes.push({folder:r.folder, rehearsal:r.name, created_at:r.created_at, missing:false, take:t});
      }
  }
  return songPlays(goes);
}

// The library's sets, in their order (Library.sets): kept, as the database
// keeps them, across a reload — in localStorage, beside the config. A page
// can give its own (window.__SETS__ = [{id, name, songs: ['Pałyn', …]}, …]).
const SETS = 'mock-sets';
let sets = (() => {
  try {
    const kept = JSON.parse(localStorage.getItem(SETS));
    if (Array.isArray(kept)) return kept;
  } catch { /* none kept */ }
  return (window.__SETS__ || []).map(st => ({...st, songs:[...st.songs]}));
})();
const keepSets = () => localStorage.setItem(SETS, JSON.stringify(sets));
// Ids are never given twice, as in Python (AUTOINCREMENT).
let nextSetId = Math.max(0, ...sets.map(st => st.id)) + 1;

// Library._titles_of: a title in a set as the song it is now — by its title
// or an old name, compared case-blind, else by what it is a go at ("Viasna
// 2") — or as typed and new when no song has it.
async function setTitles() {
  const known = new Map();
  for (const r of await libraryNow())
    for (const t of r.takes) if (t.song) known.set(t.song.toLowerCase(), t.song);
  for (const t of session ? session.takes : []) if (t.song) known.set(t.song.toLowerCase(), t.song);
  for (const title of [...repertoire, ...(window.__TAKELESS_SONGS__ || [])])
    if (!known.has(title.toLowerCase())) known.set(title.toLowerCase(), title);
  const find = (text) => known.get(text.toLowerCase()) ?? oldNames.get(text.toLowerCase())?.song;
  return (text) => {
    const m = /^(.*?)\s+(\d+)$/.exec(text.trim());
    const title = find(text) ?? (m && m[1].trim() ? find(m[1].trim()) : undefined);
    return title ? {title, new:false} : {title:text, new:true};
  };
}
// Library._songs_of_set: a set's songs as they are now, each song once, in
// the place it first comes.
function songsOfSet(titles, stored) {
  const seen = new Set();
  return stored.map(titles).filter(x => {
    const key = x.title.toLowerCase();
    return seen.has(key) ? false : (seen.add(key), true);
  });
}
async function setsAsSent() {
  const titles = await setTitles();
  return JSON.parse(JSON.stringify(sets.map(st => ({id:st.id, name:st.name,
    songs:songsOfSet(titles, st.songs)}))));
}
// A rehearsal's own copy of its set, as sent (Library._rehearsal_data).
async function setAsSent(copy) {
  if (!copy) return null;
  const titles = await setTitles();
  return {name:copy.name, songs:songsOfSet(titles, copy.songs)};
}
// The set a rehearsal before this one was played by, as it kept it: a page
// gives them by folder (window.__PLAYED_BY__ = {'/rec/old': {name, songs:
// ['Pałyn', …]}}); the others were played freely.
const playedBy = (folder) => (window.__PLAYED_BY__ || {})[folder] || null;
// The same rules and the same words as Python's (Library._set_name, _set_songs).
function setNameRefusal(name, id) {
  const trimmed = String(name || '').trim().slice(0, 40).trim();
  if (!trimmed) return 'A set needs a name';
  const other = sets.find(st => st.id !== id && st.name.toLowerCase() === trimmed.toLowerCase());
  return other ? `There is already a set called ${other.name}` : null;
}
function setSongs(songs) {
  const out = [], seen = new Set();
  for (const raw of songs || []) {
    const title = String(raw || '').trim();
    if (title && !seen.has(title.toLowerCase())) { seen.add(title.toLowerCase()); out.push(title); }
  }
  return out;
}

// What a take is a go at, as Python's library resolves a name
// (Library._resolve), over the songs the mock knows: the takes it is given,
// the repertoire and the old names. Python numbers goes across the whole
// library; the mock counts them within the takes it is given, which is all
// the interface's tests need — the interface shows what it is sent.
function songOf(text, takes) {
  const name = (text || '').trim();
  if (!name || /^Take \d+$/.test(name)) return null;
  const known = new Map();
  for (const t of takes) if (t.song) known.set(t.song.toLowerCase(), t.song);
  for (const s of repertoire) if (!known.has(s.toLowerCase())) known.set(s.toLowerCase(), s);
  const find = (x) => known.get(x.toLowerCase()) ?? oldNames.get(x.toLowerCase())?.song;
  const whole = find(name);
  if (whole) return whole;
  const m = /^(.*?)\s+(\d+)$/.exec(name);
  return (m && find(m[1].trim())) || name;
}
function goAt(song, takes, n) {
  const own = takes.find(t => t.take_number === n);
  if (own && own.song === song) return own.go;
  return Math.max(0, ...takes.filter(t => t.song === song && t.take_number !== n).map(t => t.go)) + 1;
}
// A take's song, go and name, as Python returns them.
function resolved(text, takes, n) {
  const song = songOf(text, takes);
  if (!song) return {song: null, go: null, name: 'Take ' + n};
  const go = goAt(song, takes, n);
  return {song, go, name: `${song} ${go}`};
}
// The fixtures below are written as old names; this makes them what Python
// sends.
function asSent(takes) {
  const out = [];
  for (const t of takes) {
    const named = resolved(t.name, out, t.take_number);
    out.push({
      ...meterOf(named.song), ...t, ...named,
      markers: (t.markers || []).map(m => ({...m, label_id: labelIdOf(m.label_id)})),
    });
  }
  return out;
}

// Mirrors api._next_take: what the take being named would be.
function nextTake(n, chosen = true) {
  const number = n === undefined ? takeCounter + 1 : n;
  const takes = session ? session.takes : [];
  if (chosen && session && nextName) return resolved(nextName, takes, number);
  const last = takes[takes.length - 1];
  // The evening's first take is the set's first song (R3).
  const first = !takes.length && session && session.set ? session.set.songs[0] : null;
  return resolved(last && last.song ? last.song : first || '', takes, number);
}
// And the name field's text for it: the title, or "Take N".
const fieldText = (r) => r.song || r.name;

// Mirrors api.suggest_take_name: n is the take being named, left out it means
// the one that comes next.
function suggestName(n, chosen = true) { return fieldText(nextTake(n, chosen)); }

// ---- The metronome ------------------------------------------------------
// The Python side of the metronome (spec Parts 2 to 5 and 11). The row's tempo
// and signature live here, not in the screen: they follow the song the next
// take is named for, a change made in the row is held until that name names
// another song, and Record reads them (start_take takes none). A take counts
// in and clicks by the clock; metronome_state says where it is and lists the
// clicks heard in the next 1.5 s, which is all the screen lights. A page can
// set up, before it loads (the songs' tempos are window.__SONG_TEMPOS__, above):
//   window.__CLICK_MISSING__ = 'X18'      the click's output is not there
//   window.__CLICK_UNAVAILABLE__ = {3: 'why'}  outputs the click cannot use, by
//                                         index (by default, with __HOST_API__,
//                                         the ASIO desk)
//   window.__COUNT_ERROR__ = 'No files'   count_tempo fails with it
//   window.__TAKE_LATE_MS__ = 500         for this long after Record, metronome_state
//                                         still answers as between takes
//   window.__COUNT_IN_LATE_MS__ = 1500    a click take's first click is chosen
//                                         this long after Record, as on another
//                                         device: till then it says `count`
//                                         with no count-in time
//   window.__PAD_TAP__()                  a hit on a pad: a tap, while the screen
//                                         has asked to hear them
//   window.__TAP_ERROR__ = 'X18 is busy'  the band's ports will not open for Tap
//   window.__CROP_ON_GRID__ = true        a click take's crop is cut on its grid, as
//                                         Python cuts one whose files it reads: the
//                                         start back to the bar line, the end on to
//                                         the next quarter. Without it the fake's
//                                         takes are cut as asked, as Python cuts a
//                                         take whose audio it cannot read.
// and a test can change them while it runs.
const PER_BAR = {'4/4': 4, '3/4': 3, '2/4': 2, '6/8': 6};
const tempoBounds = (signature) => (signature === '6/8' ? [60, 600] : [30, 300]);
const signatureRefusal = (signature) =>
  PER_BAR[signature] ? null : 'Pick one of 4/4, 3/4, 2/4 or 6/8';
const tempoRefusal = (tempo, signature) => {
  const [low, high] = tempoBounds(signature);
  return signatureRefusal(signature) || (Number.isInteger(tempo) && tempo >= low && tempo <= high
    ? null : `A tempo in ${signature} is a whole number from ${low} to ${high}`);
};
const CLICK_SOUNDS = ['click', 'wood', 'hihat'];
// Where a crop of a take with this meter cuts it (api._on_grid, snap_region):
// a click take's region on its grid with __CROP_ON_GRID__, else as asked.
function cutAt(meter, a, b, duration) {
  if (!window.__CROP_ON_GRID__ || !meter || !meter.click || !meter.tempo) return [a, b];
  const click = 60 / meter.tempo, bar = PER_BAR[meter.signature] * click;
  const quarter = (meter.signature === '6/8' ? 2 : 1) * click;
  const start = Math.floor(a / bar + 1e-9) * bar;
  return [start, Math.min(duration, Math.ceil(b / quarter - 1e-9) * quarter)];
}
// The tempo through a take, as take_drift counts it, from the take's first
// track: steady on its aim, unless the band (band.js) says how the take went
// through driftCurve(file, aim's tempo or null): {start, seed, middle, keys},
// the band's tempo at a few times, [[seconds, bpm], ...], joined smoothly, with a little unevenness
// from bar to bar on top. The aim is as Python finds it: the click's, the
// take's own, the song's now, or the middle of the bars.
let driftCurve = () => null;
function driftKeyed(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
    if (t <= t1) { const f = (t - t0) / (t1 - t0), s = f * f * (3 - 2 * f); return v0 + (v1 - v0) * s; }
  }
  return keys[keys.length - 1][1];
}
function fakeDrift(tracks, meter) {
  if (!tracks || !tracks.length) return {ok:false, why:'missing'};
  const {tempo, signature, click, song} = meter || {};
  const own = song ? songTempos.get(song) : null;
  const aim = tempo && signature ? {tempo, signature, from: click ? 'click' : 'take', song: null}
    : own ? {tempo: own.tempo, signature: own.signature, from: 'song', song} : null;
  const curve = driftCurve(tracks[0].file, aim ? aim.tempo : null);
  const sig = aim ? aim.signature : '4/4';
  const around = aim ? aim.tempo : curve ? curve.middle : 120;
  const bar = PER_BAR[sig] * 60 / around;
  const seconds = fileDurations[tracks[0].file] ?? (P ? P.duration : TAKE);
  const start = curve ? curve.start : aim && aim.from === 'click' ? bar : 0;
  const bars = [];
  for (let n = 0, at = start; at + bar <= seconds + 0.01; n++, at += bar) {
    const played = curve ? driftKeyed(curve.keys, at + bar / 2) + (driftHash(n * 7 + curve.seed * 31) - 0.5) * 0.9 : around;
    bars.push({n: n + 1, start: at, end: at + bar, tempo: Math.round(played * 10) / 10});
  }
  if (!bars.length) return {ok:false, why:'short'};
  const sorted = bars.map(b => b.tempo).sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  return {ok:true, source: tracks.some(t => isKit(t)) ? 'drums' : 'mix', per_bar: PER_BAR[sig], middle,
          aim: aim || {tempo: Math.round(middle), signature: '4/4', from: 'middle', song: null}, bars};
}
function driftHash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// What set_metronome_setting takes, and what each setting may be.
const CLICK_SETTINGS = {
  click_sound: (v) => CLICK_SOUNDS.includes(v),
  click_volume: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  count_in_bars: (v) => [0, 1, 2].includes(v),
  tempo_in_wav: (v) => typeof v === 'boolean',
  drift_tolerance: (v) => [0.01, 0.02, 0.03, 0.05].includes(v),
};
// What a quarter counts at, by song, when counting a tempo from a take.
const COUNTED = {'Dym': 104, 'Ptuška': 86};

const metro = {
  session: undefined,    // the rehearsal the row belongs to
  followed: undefined,   // the song it follows, lower case; '' for a take that is no song's
  tempo: null, signature: '4/4',
  run: null,             // the click running between takes: {grid}
  take: null,            // the take recording: {tempo, signature, click, said, grid, countEnd},
                         // said: from when metronome_state tells of it
  meters: {},            // each take's tempo, signature and click, by number, till it is kept
  tapUntil: 0, taps: [],
};
const clickOn = () => readCfg().metronome_on !== false;

// Clicks fall on a grid: click k is at t0 + k * period, and has index
// (index + k) mod perBar in its bar.
const gridOf = (tempo, signature, t0) =>
  ({t0, index: 0, period: 60 / tempo, perBar: PER_BAR[signature]});
const firstClick = (g, now) => Math.max(0, Math.ceil((now - g.t0) / g.period - 1e-9));
// The clicks heard in the next 1.5 s: [ms from now, index in the bar].
function clicksIn(g, now) {
  const out = [];
  for (let k = firstClick(g, now); ; k++) {
    const ms = (g.t0 + k * g.period - now) * 1000;
    if (ms > 1500) break;
    out.push([ms, (g.index + k) % g.perBar]);
  }
  return out;
}

// The row is set; the click running between takes follows from its next
// click, in the same bar unless the signature changes (it then restarts on
// 1), and stops when the tempo goes.
function metroApply(tempo, signature) {
  // A song page's click plays its own tempo, whatever the row does.
  if (metro.run && !metro.run.fixed) {
    if (tempo === null) metro.run = null;
    else {
      const g = metro.run.grid, k = firstClick(g, clock());
      metro.run.grid = {t0: g.t0 + k * g.period,
        index: signature === metro.signature ? (g.index + k) % g.perBar : 0,
        period: 60 / tempo, perBar: PER_BAR[signature]};
    }
  }
  metro.tempo = tempo;
  metro.signature = signature;
}

// Metronome.follow: each time the next take's name names another song, or
// none, the row takes the tempo and signature that go with it; the same song
// again (a keystroke in its name) leaves it, a held change included.
function metroFollow() {
  if (metro.session !== session) {
    Object.assign(metro, {session, followed: undefined, run: null, take: null});
  }
  const song = nextTake().song;
  const key = song ? song.toLowerCase() : '';
  if (metro.followed === key) return;
  metro.followed = key;
  const own = song ? songTempos.get(song) : null;
  metroApply(own ? own.tempo : null, own ? own.signature : '4/4');
}

// A song as the library has it, or null for a title it does not know yet:
// one the library plays, the repertoire lists or a page gave a tempo.
async function songRow(title) {
  const all = await libraryNow();
  const lower = title.toLowerCase();
  const played = [...all.flatMap(r => r.takes), ...(session ? session.takes : [])]
    .some(t => t.song === title);
  const listed = [...repertoire, ...(window.__TAKELESS_SONGS__ || [])]
    .some(s => s.toLowerCase() === lower);
  songIds(all);
  if (!played && !listed && !songTempos.has(title) && !knownIds.has(title)) return null;
  if (!knownIds.has(title)) knownIds.set(title, Math.max(0, ...knownIds.values()) + 1);
  return {id: knownIds.get(title), title, ...tempoOf(title)};
}

// Library.tempo_for's last take: the song's newest, on disk.
async function lastTakeOf(title) {
  const rehearsals = [...(session ? [{folder:session.folder, takes:session.takes}] : []),
                      ...(await libraryNow()).filter(r => !r.missing)];
  for (const r of rehearsals) {
    const t = [...r.takes].reverse().find(x => x.song === title);
    if (t) return {folder:r.folder, take_number:t.take_number, name:t.name};
  }
  return null;
}

async function metroState() {
  metroFollow();
  const now = clock(), song = nextTake().song;
  const take = metro.take && now >= metro.take.said ? metro.take : null;
  const own = song ? songTempos.get(song) : null;
  const out = {phase:'idle', tempo:metro.tempo, signature:metro.signature, on:clickOn(),
    case: !song ? 'free' : own ? 'song' : 'song_without', song:null, held:false, last_take:null,
    upcoming:[], count:0, since_count_in_ms:null, output_missing:window.__CLICK_MISSING__ || null};
  if (song) {
    out.song = await songRow(song);
    out.last_take = await lastTakeOf(song);
  }
  // As Metronome._held: a tempo of the row's own, for a song the library
  // has. An emptied row, and a title no song has yet, hold nothing.
  out.held = out.song !== null && out.tempo !== null
    && (out.case === 'song' ? out.tempo !== own.tempo || out.signature !== own.signature
      : out.case === 'song_without');
  if (take) {
    // The row cannot change under a take: what it shows is the take's.
    Object.assign(out, {phase:'take', tempo:take.tempo, signature:take.signature});
    if (take.click && now < take.grid.t0) {
      // The first click is not chosen yet: no time, and nothing to hear.
      out.phase = 'count';
    } else if (take.click) {
      out.since_count_in_ms = (now - take.countEnd) * 1000;
      if (now < take.countEnd) {
        out.phase = 'count';
        out.count = Math.floor((now - take.grid.t0) / take.grid.period + 1e-9) + 1;
      }
      // The switch silences the clicks of a take that has them, and the
      // count goes on.
      if (out.on) out.upcoming = clicksIn(take.grid, now);
    }
  } else if (metro.run) {
    out.phase = 'preview';
    out.upcoming = clicksIn(metro.run.grid, now);
    // A song page's ▶: the tempo heard, the row's left as it is.
    if (metro.run.fixed) Object.assign(out, metro.run.fixed);
  }
  out.per_bar = PER_BAR[out.signature];
  return out;
}

// Record: the free click stops, and the take counts in and clicks at the row's
// tempo, unless the row is empty or the switch off (a take with a tempo and
// no click keeps the tempo).
function metroStartTake(number) {
  metroFollow();
  metro.run = null;
  const {tempo, signature} = metro, click = tempo !== null && clickOn();
  const bars = readCfg().count_in_bars ?? 1;
  const t0 = clock() + (click ? (window.__COUNT_IN_LATE_MS__ || 0) / 1000 : 0);
  metro.meters[number] = {tempo, signature: tempo === null ? null : signature, click};
  metro.take = {tempo, signature, click, said: clock() + (window.__TAKE_LATE_MS__ || 0) / 1000,
    grid: click ? gridOf(tempo, signature, t0) : null,
    countEnd: click ? t0 + bars * PER_BAR[signature] * 60 / tempo : null};
}
// Stop: the click ends. What it leaves is what stop_take says of the take.
function metroStop() {
  metro.take = null;
  return {...(metro.meters[takeCounter] || NO_METER)};
}
// A song with no tempo takes a take's: the first click take of it that is
// kept (a false start thrown away gives nothing), and a take with a tempo that
// is renamed for it.
function metroGives(take) {
  if (take.song && !songTempos.has(take.song))
    songTempos.set(take.song, {tempo: take.tempo, signature: take.signature});
}

// The outputs there are: a Windows machine's with __HOST_API__, else a Mac's.
const outputDevices = () => window.__HOST_API__ ? [
  {index:1, name:'Speakers', host_api:'MME', max_input_channels:0,
   max_output_channels:2, default_samplerate:48000},
  {index:3, name:'X32 USB', host_api:'ASIO', max_input_channels:16,
   max_output_channels:16, default_samplerate:48000}] : [
  {index:0, name:'UA Monitors', host_api:'Core Audio', max_input_channels:0,
   max_output_channels:2, default_samplerate:48000},
  {index:1, name:'MacBook Speakers', host_api:'Core Audio', max_input_channels:0,
   max_output_channels:2, default_samplerate:48000}];

// Why the click cannot play through an output, by device index.
const clickReasons = () => window.__CLICK_UNAVAILABLE__
  || (window.__HOST_API__ ? {3: "Another ASIO card can't play while one records."} : {});
const withClickReason = (devices) =>
  devices.map(d => ({...d, click_unavailable: clickReasons()[d.index] ?? null}));

window.__PAD_TAP__ = () => {
  if (clock() > metro.tapUntil) return;
  metro.taps.push(clock());
  metro.tapUntil = clock() + 2;
};


// ---- MIDI ---------------------------------------------------------------
// The ports the fake system lists, and what the tracks on them are doing. A
// page can set up, before it loads:
//   window.__MIDI_PORTS__ = ['TD-17', …]  the ports the system lists (default:
//                                         an e-kit and a keyboard). Two alike
//                                         are ambiguous, as in Python.
//   window.__MIDI_GONE__  = ['TD-17']     names not plugged in: left out of the
//                                         list, and a track on one is missing.
//   window.__MIDI_BUSY__  = ['TD-17']     names another app holds: listed, and
//                                         a track on one is in_use.
//   window.__MIDI_ECHO__  = ['Keys', 'Synth']  two tracks, the second getting
//                                         the first's notes: Synth says
//                                         echo: 'Keys', as Python's does.
//   window.__MIDI_PLAYED__ = ['Launchkey Mini MK3 MIDI Port']  ports somebody
//                                         plays, as the kit does, whichever
//                                         track has them. A check opens the
//                                         other ports of a picked port's
//                                         device too, and counts a played one
//                                         among them (P7).
// and a test can change them while it runs, as it can the others.
// A track that takes notes is one on Both or MIDI (rules.records_notes);
// one with no mode records audio.
const takesNotes = (t) => Boolean(t) && (t.mode === 'both' || t.mode === 'midi');
const takesSound = (t) => !t || t.mode !== 'midi';
const portNameOf = (t) => {
  const p = t && t.midi_port;
  const name = typeof p === 'string' ? p : p && p.name;
  return typeof name === 'string' && name.trim() ? name : null;
};
// The MIDI system the fake is on, for the picker and Under the hood alike.
const MIDI_SYSTEM = 'Windows MIDI Services';
const midiPortNames = () => (window.__MIDI_PORTS__ || ['TD-17', 'Launchkey Mini MK3'])
  .filter(n => !(window.__MIDI_GONE__ || []).includes(n));
// What the system says of a port besides its name: the maker where it is
// known, and an id that is the same every time.
const MIDI_MAKERS = {'TD-17': 'Roland', 'Launchkey Mini MK3': 'Novation'};
// A keyboard lists its ports under its own name: "Launchkey Mini MK3 MIDI
// Port" and "Launchkey Mini MK3 DAW Port" are one device's.
const midiDeviceOf = (name) => name.replace(/\s+(MIDI|DAW)\s+Port\b.*$/, '') || name;
// A name the system lists twice gets a different id each time (`copy`, from 1).
function midiPortInfo(name, copy = 0) {
  let id = 1000 + copy * 7919;
  for (const c of name) id = (id * 31 + c.codePointAt(0)) % 1000003;
  const device = midiDeviceOf(name);
  return {name, device, ...(MIDI_MAKERS[device] ? {maker: MIDI_MAKERS[device]} : {}), id: String(id)};
}
// identity.in_order: a device's ports together, in the order the devices
// first come, and within one its control or DAW port after the others.
function midiInOrder(ports) {
  const groups = [], byDevice = new Map();
  for (const p of ports) {
    if (byDevice.has(p.device)) byDevice.get(p.device).push(p);
    else { const group = [p]; byDevice.set(p.device, group); groups.push(group); }
  }
  const control = (p) => /daw|midiin2|control|ctrl/
    .test(p.name.toLowerCase().split(p.device.toLowerCase()).join(' '));
  return groups.flatMap(g => [...g.filter(p => !control(p)), ...g.filter(control)]);
}
const isPlayed = (name) => Boolean(name) && (window.__MIDI_PLAYED__ || []).includes(name);
// How a track's port stands (midi.rig's activity states).
function midiPortState(t) {
  const name = portNameOf(t);
  if (!name) return 'none';
  const here = midiPortNames().filter(n => n === name);
  if (!here.length) return 'missing';
  if (here.length > 1) return 'ambiguous';
  return (window.__MIDI_BUSY__ || []).includes(name) ? 'in_use' : 'ok';
}
// rules.lane_after: the audio lane a track's notes follow in the player.
function laneAfter(band, audioNames, name) {
  if (audioNames.includes(name)) return name;
  const names = band.map(m => m.name);
  if (!names.includes(name)) return null;
  for (const earlier of names.slice(0, names.indexOf(name)).reverse())
    if (audioNames.includes(earlier)) return earlier;
  return null;
}
// The kit's tracks: the drums icon, whether the band says so or the track
// does, or a track called Drums.
const iconOfName = (name) => {
  const placed = (session ? session.tracks : []).find(t => t.name === name);
  return (placed && placed.icon) || withIcon({name}).icon || '';
};
const isKit = (t) => Boolean(t) && (t.icon === 'drums' || iconOfName(t.name) === 'drums' || /^drums?$/i.test(t.name));

// The fake kit plays 4/4 at 120 bpm from a quarter second in: kick on 1 and 3,
// snare on 2 and 4, hi-hat on the eighths, a crash on the first bar of four
// and a tom fill in the last. It is a pattern of bars of four, so how many
// hits there have been by any time is worked out, not stored.
const KIT_ROWS = ['Crash', 'Ride', 'Hi-hat', 'Toms', 'Snare', 'Kick'];
const KIT_FROM = 0.25, KIT_BLOCK_SEC = 8;
const KIT_BLOCK = [0, 1, 2, 3].flatMap((b) => {
  const hits = [];
  const hit = (beat, row, vel) => hits.push([b * 2 + beat * 0.5, 0.1, row, vel]);
  const fill = b === 3;
  for (let k = 0; k < 8; k++) if (!(fill && k >= 6)) hit(k / 2, 2, k % 2 ? 62 : 84);
  hit(0, 5, 112);
  hit(2, 5, 104);
  if (b % 2) hit(2.5, 5, 96);
  hit(1, 4, 108);
  if (fill) [90, 96, 102, 110].forEach((vel, i) => hit(3 + i / 4, 3, vel));
  else hit(3, 4, 100);
  if (b === 0) hit(0, 0, 118);
  return hits;
}).sort((a, b) => a[0] - b[0]);
// The kit's hits with a start in [from, to), seconds from the run's start,
// as [start, length, row, velocity]: windows that follow one another count
// every hit once. Looks back no more than two blocks, for a run that was not
// looked at for a long while.
function kitHits(from, to) {
  const out = [];
  const lo = Math.max(from, to - 2 * KIT_BLOCK_SEC) - KIT_FROM;
  for (let k = Math.max(0, Math.floor(lo / KIT_BLOCK_SEC)); k * KIT_BLOCK_SEC <= to - KIT_FROM; k++)
    for (const [t, d, row, vel] of KIT_BLOCK) {
      const at = KIT_FROM + k * KIT_BLOCK_SEC + t;
      if (at >= from && at < to) out.push([at, d, row, vel]);
    }
  return out;
}
// How many hits started before `to`: what kitHits(0, to) and kitPattern(to)
// hold.
function kitCount(to) {
  const x = to - KIT_FROM;
  if (x < 0) return 0;
  const k = Math.floor(x / KIT_BLOCK_SEC), r = x - k * KIT_BLOCK_SEC;
  return k * KIT_BLOCK.length + KIT_BLOCK.filter(h => h[0] < r).length;
}
// A take's worth of the kit, and a keyboard line (C minor, up and down, a
// bass note under each bar of eight), both as take_notes sends notes:
// [start, length, pitch or row, velocity], none running past `seconds`.
function kitPattern(seconds) {
  const out = [];
  for (let k = 0; KIT_FROM + k * KIT_BLOCK_SEC < seconds; k++)
    for (const [t, d, row, vel] of KIT_BLOCK) {
      const at = KIT_FROM + k * KIT_BLOCK_SEC + t;
      if (at < seconds) out.push([at, Math.min(d, seconds - at), row, vel]);
    }
  return out;
}
function keysPattern(seconds) {
  const line = [60, 63, 67, 70, 72, 70, 67, 63], held = [0.4, 0.4, 0.9, 0.4];
  const out = [];
  for (let i = 0; 0.5 + i * 0.5 < seconds; i++) {
    const t = 0.5 + i * 0.5, up = Math.floor(i / 8) % 2 ? 5 : 0;
    if (i % 8 === 0) out.push([t, Math.min(3.6, seconds - t), 48 + up, 80]);
    out.push([t, Math.min(held[i % 4], seconds - t), line[i % 8] + up, 70 + (i * 7) % 40]);
  }
  return out;
}
// A take's notes read back, as api.take_notes answers: whole octaves, C to B,
// for what is not drums.
function notesOfFile(name, seconds) {
  if (isKit({name})) return {name, drums: true, rows: [...KIT_ROWS], notes: kitPattern(seconds)};
  const notes = keysPattern(seconds);
  const pitches = notes.map(n => n[2]);
  return {name, drums: false,
    low: pitches.length ? Math.floor(Math.min(...pitches) / 12) * 12 : 60,
    high: pitches.length ? Math.floor(Math.max(...pitches) / 12) * 12 + 11 : 71, notes};
}

// What is being counted: a check of the tracks on the setup screen, or, once
// a rehearsal is on, its take. Each is {since, ended, read}: when it began (the
// clock's seconds), how long it ran if it has stopped, and how far each
// track's loudest note has been read. A take also has `heard`: the tracks
// whose port was there at any look since it began, which are the ones that
// keep a .mid (a port pulled mid-take keeps the notes it was writing).
let midiCheck = null;
let midiTake = null;
// The tracks whose ports are open now, and the run that counts their notes.
function midiTracks() {
  return (session ? session.tracks : midiCheck ? midiCheck.tracks : []).filter(takesNotes);
}
function midiRun() { return session ? midiTake : midiCheck; }
// api.midi_activity: `read` is whether this call takes the loudest note, as
// Python's does (the next call starts from nothing). Only a kit plays; a
// keyboard is quiet.
function midiActivity(read) {
  const tracks = midiTracks(), run = midiRun();
  const elapsed = run ? (run.ended ?? clock() - run.since) : 0;
  const echo = window.__MIDI_ECHO__ || [];
  const out = {};
  for (const t of tracks) {
    const state = midiPortState(t);
    if (state === 'ok' && run && run.heard && run.ended === null) run.heard.add(t.name);
    // An echo plays what the track before it plays, when both are heard.
    const first = echo[1] === t.name && state === 'ok'
      ? tracks.find(o => o.name === echo[0] && midiPortState(o) === 'ok') : null;
    const source = first || t;
    const plays = state === 'ok' && run && (isKit(source) || isPlayed(portNameOf(source)));
    let vel = 0;
    if (plays && run.ended === null) {
      const since = run.read[t.name] ?? 0;
      vel = Math.max(0, ...kitHits(since, elapsed).map(h => h[3])) / 127;
      if (read) run.read[t.name] = elapsed;
    }
    out[t.name] = {vel, notes: plays ? kitCount(elapsed) : 0, connected: state === 'ok', state,
      ...(source !== t ? {echo: source.name} : {})};
  }
  return out;
}

// What a take of these tracks leaves besides its audio: a .mid for each track
// that takes notes and whose port was there, and the rest as missing, placed
// by rules.lane_after over the band, each with its place in it (rules.place_in).
function notesOfTake(band, audio, saved) {
  const audioNames = audio.map(t => t.name);
  const noted = band.filter(takesNotes);
  const where = (t) => ({name: t.name, port: portNameOf(t) || '', after: laneAfter(band, audioNames, t.name),
                         place: band.indexOf(t)});
  return {
    notes: noted.filter(t => saved.includes(t.name)).map(t => ({...where(t), file: `/rec/${t.name}.mid`})),
    notes_missing: noted.filter(t => !saved.includes(t.name)).map(where),
  };
}

// What a copy to the cloud folder leaves on a take, as share_take makes it.
function cloudShare(what) {
  const shared = {};
  if (what === 'mix' || what === 'both') shared.mix = cloudDir + '/mix.wav';
  if (what === 'tracks' || what === 'both') shared.tracks = cloudDir + '/tracks';
  return shared;
}

window.__MAKE_API__ = () => ({
  ping: async () => ({ok:true, message:'mock'}),
  // window.__STARTUP_PROBLEM__ = {name, message}, or a list of them for a
  // start that went wrong in more than one way.
  startup_problems: track('startup_problems', async () =>
    [].concat(window.__STARTUP_PROBLEM__ || [])),
  // A problem raised in the page, which Python writes to crash.log. Here it
  // is only kept, so a test can read what was sent.
  log_problem: track('log_problem', async (_where, _name, _message, _stack) => null),
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
    await held('rescan_devices');
    rescans += 1;
    if (window.__PLUGGED_IN_LATE__ && !pluggedIn && rescans >= 2) {
      pluggedIn = true;
      return {ok:true, found:['X18/XR18'], gone:[]};
    }
    return {ok:true, found:[], gone:[]};
  }),
  list_output_devices: async () => withClickReason(outputDevices()),
  set_output_device: track('set_output_device', async (idx) => {
    outputDevice = {index: idx, channels: [1, 2]};
    // What Python says when a take is open and the card refused it.
    const name = ['UA Monitors', 'MacBook Speakers'][idx] || 'That output';
    return window.__OUTPUT_FALLBACK__
      ? {ok:true, warning:'“' + name + '” will not take 44100 Hz right now, ' +
          'so the take plays through the system output.'}
      : {ok:true};
  }),
  set_output_channels: track('set_output_channels', async (channels) => {
    outputDevice = {...outputDevice, channels};
    return {ok:true};
  }),

  // The click's own output and the metronome's settings, kept in the config.
  set_click_device: track('set_click_device', async (idx) => {
    if (idx !== null && idx !== undefined) {
      const found = (await window.pywebview.api.list_output_devices()).find(d => d.index === idx);
      if (!found) return {ok:false, error:'That output is not there'};
      if (found.click_unavailable) return {ok:false, error:found.click_unavailable};
    }
    const none = idx === null || idx === undefined;
    writeCfg({...readCfg(), click_device_index: none ? null : idx, click_channels: none ? null : [1, 2]});
    return {ok:true};
  }),
  set_click_channels: track('set_click_channels', async (channels) => {
    if (!Array.isArray(channels) || !channels.length
        || !channels.every(c => Number.isInteger(c) && c >= 1))
      return {ok:false, error:'Pick outputs, counted from 1'};
    writeCfg({...readCfg(), click_channels: [...channels]});
    return {ok:true};
  }),
  set_metronome_setting: track('set_metronome_setting', async (key, value) => {
    const fits = CLICK_SETTINGS[key];
    if (!fits) return {ok:false, error:'No such setting'};
    if (!fits(value)) return {ok:false, error:`That is not a value for ${key}`};
    writeCfg({...readCfg(), [key]: value});
    return {ok:true};
  }),
  metronome_set: track('metronome_set', async (tempo, signature) => {
    const refusal = tempo === null ? signatureRefusal(signature) : tempoRefusal(tempo, signature);
    if (refusal) return {ok:false, error:refusal};
    metroFollow();
    metroApply(tempo, signature);
    return {ok:true};
  }),
  metronome_save_to_song: track('metronome_save_to_song', async () => {
    metroFollow();
    const song = nextTake().song;
    if (!song) return {ok:false, error:'This take is no song, so there is no song to save to'};
    if (metro.tempo === null) return {ok:false, error:'There is no tempo to save'};
    if (!(await songRow(song)))
      return {ok:false, error:`${song} is not in the library yet: its first take played to the click keeps the tempo`};
    songTempos.set(song, {tempo: metro.tempo, signature: metro.signature});
    return {ok:true};
  }),
  metronome_set_on: track('metronome_set_on', async (on) => {
    writeCfg({...readCfg(), metronome_on: Boolean(on)});
    return {ok:true};
  }),
  // The click between takes: from now, at the row's tempo, until Stop, Record
  // or the end of the rehearsal. With a tempo, a song page's ▶: that tempo,
  // from its first beat, and the row left as it is.
  metronome_play: track('metronome_play', async (tempo = null, signature = null) => {
    metroFollow();
    if (metro.take) return {ok:false, error:'The take has its own click'};
    if (tempo !== null) {
      const refusal = tempoRefusal(tempo, signature);
      if (refusal) return {ok:false, error:refusal};
      metro.run = {grid: gridOf(tempo, signature, clock()), fixed: {tempo, signature}};
      return {ok:true};
    }
    if (metro.tempo === null) return {ok:false, error:'No tempo to play: type or tap one'};
    if (!metro.run || metro.run.fixed) metro.run = {grid: gridOf(metro.tempo, metro.signature, clock())};
    return {ok:true};
  }),
  metronome_stop: track('metronome_stop', async () => { metro.run = null; return {ok:true}; }),
  // A bar of a sound is heard; nothing on screen changes.
  metronome_preview: track('metronome_preview', async (sound) =>
    sound === null || sound === undefined || CLICK_SOUNDS.includes(sound)
      ? {ok:true} : {ok:false, error:'No such sound'}),
  // Polled, like the levels, and so not logged in __CALLS__.
  metronome_state: async () => JSON.parse(JSON.stringify(await metroState())),
  // A tempo counted from a take's files, in quarters, whole: the Dym and
  // Ptuška takes of the repertoire have the figures below, any other take
  // the tempo it was recorded at, else 120. In 6/8 the number counts eighths.
  count_tempo: track('count_tempo', async (folder, n, signature) => {
    await held('count_tempo');
    if (window.__COUNT_ERROR__) return {ok:false, error:window.__COUNT_ERROR__};
    const takes = session && folder === session.folder ? session.takes
      : (await libraryNow()).find(r => r.folder === folder && !r.missing)?.takes;
    const take = (takes || []).find(t => t.take_number === n);
    if (!take) return {ok:false, error:'Take not found'};
    const recorded = take.tempo == null ? null : take.signature === '6/8' ? take.tempo / 2 : take.tempo;
    const quarters = COUNTED[take.song] ?? recorded ?? 120;
    const [low, high] = tempoBounds(signature);
    return {ok:true, tempo: Math.min(high, Math.max(low, Math.round(signature === '6/8' ? quarters * 2 : quarters)))};
  }),
  set_song_tempo: track('set_song_tempo', async (id, tempo, signature) => {
    songIds(await libraryNow());
    const title = titleOfId(id);
    if (title === undefined) return {ok:false, error:'Song not found'};
    if (tempo === null || tempo === undefined) songTempos.delete(title);
    else {
      const refusal = tempoRefusal(tempo, signature);
      if (refusal) return {ok:false, error:refusal};
      songTempos.set(title, {tempo, signature});
    }
    return {ok:true, id, title, ...tempoOf(title)};
  }),
  // Hits on the pads count as taps from now until a pause of two seconds
  // (window.__PAD_TAP__), and each is told once, as milliseconds ago.
  metronome_tap_listen: track('metronome_tap_listen', async () => {
    if (window.__TAP_ERROR__)
      return {ok:false, error:`The band's MIDI ports could not be opened: ${window.__TAP_ERROR__}`};
    metro.tapUntil = clock() + 2;
    return {ok:true};
  }),
  metronome_taps: async () => {
    const now = clock(), ms_ago = metro.taps.map(t => (now - t) * 1000);
    metro.taps = [];
    return {ms_ago};
  },
  // Whether the player plays the click with the take, kept for the session as
  // Python keeps it: player_state says it.
  player_set_click: track('player_set_click', async (on) => {
    playerClick = Boolean(on);
    return {ok:true};
  }),
  load_default_tracks: track('load_default_tracks', async (band) => window.__PLUGGED_IN_LATE__ ? ({
    // Like layouts.for_device: with no card there is one input to go round;
    // with the desk, every name gets its own.
    // A track on MIDI only takes no input from anybody (layouts.for_device),
    // and keeps its mode and port, as layouts.band_member does.
    tracks: (band || [{name:'Guitar'}, {name:'Vocals'}]).map((t, i, all) => {
      const midiOnly = t.mode === 'midi';
      const nth = all.slice(0, i).filter(o => o.mode !== 'midi').length;
      return {
        name: t.name, stereo: !midiOnly && !!t.stereo, ...(t.icon ? {icon: t.icon} : {}),
        ...(t.mode ? {mode: t.mode} : {}), ...(t.midi_port ? {midi_port: t.midi_port} : {}),
        channel: midiOnly ? null : pluggedIn ? nth + 1 : (nth === 0 ? 1 : null)};
    })}) : ({
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
  set_false_start: track('set_false_start', async (seconds) => {
    const n = Math.round(Number(seconds));
    if (!Number.isFinite(n)) return {ok:false, error:'Not a number of seconds'};
    const value = Math.max(5, Math.min(120, n));
    writeCfg({...readCfg(), false_start_sec: value});
    return {ok:true, false_start_sec: value};
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
    minutes_left: window.__LOW_SPACE__ ? 5 : 640, low_space: !!window.__LOW_SPACE__,
    battery_percent: window.__BATTERY__ ?? null}),

  // A check opens the ports of the tracks that take notes, and counts again
  // from nothing (api.start_monitor).
  start_monitor: track('start_monitor', async (_dev, _rate, tracks) => {
    await held('start_monitor');
    midiCheck = {tracks: (tracks || []).filter(takesNotes), since: clock(), ended: null, read: {}};
    return {ok:true};
  }),
  monitor_levels: track('monitor_levels', async () => {
    await held('monitor_levels');
    return window.__MONITOR_LEVELS__ || ({'Guitar':[0.62], 'Vocals':[0.0004]});
  }),
  monitor_health: async () => ({checking:true, problem: window.__CHECK_QUIET__ || null}),
  // The ports the system lists; a port a track holds open says how many notes
  // it has sent (midi.rig ports()).
  list_midi_ports: track('list_midi_ports', async () => {
    const counts = Object.fromEntries(Object.entries(midiActivity(false)).map(([n, a]) => [n, a.notes]));
    const held = (name) => midiTracks().filter(t => portNameOf(t) === name && midiPortState(t) === 'ok')
      .reduce((sum, t) => sum + (counts[t.name] || 0), 0);
    // A check also opens the other ports of each picked port's device, only
    // to count them (P7): a played one among them counts what is played.
    const open = midiTracks().filter(t => midiPortState(t) === 'ok').map(portNameOf);
    const beside = new Set(!session && midiCheck ? open.map(midiDeviceOf) : []);
    const run = midiRun();
    const elapsed = run ? (run.ended ?? clock() - run.since) : 0;
    const notes = (name) => open.includes(name) ? held(name)
      : isPlayed(name) && beside.has(midiDeviceOf(name)) ? kitCount(elapsed) : 0;
    return {system:MIDI_SYSTEM, error:null,
            ports: midiInOrder(midiPortNames().map((name, i, all) => ({
              ...midiPortInfo(name, all.filter(n => n === name).length > 1 ? i + 1 : 0), notes: notes(name)})))};
  }),
  midi_activity: async () => midiActivity(true),
  // The notes of a take's tracks, a kit pattern for the drums and a keyboard
  // line for the rest, as long as the take (api.take_notes). Each answer, an
  // error too, carries the band's icon for its name, as take_media's does.
  take_notes: track('take_notes', async (files) => {
    await held('take_notes');
    return (files || []).map(({name, file}) => withIcon(file
      ? notesOfFile(name, fileDurations[file] ?? (P ? P.duration : TAKE))
      : {name, error:'Notes file not found'}));
  }),

  // The band's tempo through a take, bar by bar (api.take_drift). See
  // fakeDrift; window.__DRIFT__ says otherwise: an answer, or a function of
  // the call's arguments giving one (null for the usual).
  take_drift: track('take_drift', async (tracks, notes, meter) => {
    await held('take_drift');
    const said = typeof window.__DRIFT__ === 'function' ? window.__DRIFT__(tracks, notes, meter) : window.__DRIFT__;
    return said || fakeDrift(tracks, meter);
  }),

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
  // The ports go with the check, or stay open for the rehearsal about to
  // start (keepPorts).
  stop_monitor: track('stop_monitor', async (keepPorts) => {
    if (keepPorts && midiCheck) midiCheck.ended = clock() - midiCheck.since;
    else midiCheck = null;
    return {ok:true};
  }),

  // A page can start the rehearsal with takes in it already:
  // window.__TONIGHT__ = [{name, duration_sec, starred?, markers?, cloud?}, …],
  // numbered from 1 in that order.
  start_rehearsal: track('start_rehearsal', async (name, _dev, _rate, tracksIn, _depth, setId) => {
    await held('start_rehearsal');
    const folder = '/rec/' + name;
    const tonight = (window.__TONIGHT__ || []).map((t, i) => ({take_number:i + 1, markers:[],
      tracks:[{name:'Guitar', file:`${folder}/t${i + 1}.wav`}], ...t}));
    for (const t of tonight) fileDurations[t.tracks[0].file] = t.duration_sec;
    for (const t of tonight) for (const n of t.notes || []) fileDurations[n.file] = t.duration_sec;
    // The set as it is now: the rehearsal keeps its own copy (Library.set_of).
    const byIt = sets.find(st => st.id === setId);
    // A band with MIDI in it is the band that was started with, as Python
    // places it; any other is the pair the tests have always had.
    const placed = (tracksIn || []).some(takesNotes) ? tracksIn.map(t => ({
      name:t.name, channel: t.mode === 'midi' ? null : t.channel, stereo: t.mode === 'midi' ? false : !!t.stereo,
      ...(t.icon ? {icon:t.icon} : {}), mode: t.mode || 'audio', midi_port: takesNotes(t) ? t.midi_port || null : null,
    })) : null;
    session = {name, folder, takes:asSent(tonight),
               tracks: window.__SESSION_TRACKS__ || placed || [{name:'Guitar',channel:1},{name:'Vocals',channel:2}],
               set: byIt ? {name:byIt.name, songs:[...byIt.songs]} : null};
    midiCheck = null;
    midiTake = null;
    takeCounter = tonight.length;
    nextName = null;
    return {ok:true, folder:session.folder};
  }),
  session_state: async () => {
    if (!session) return {active:false};
    const song = nextTake().song;
    const before = await goBeforeTonight(song);
    const set = await setAsSent(session.set);
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
       next_take_name:suggestName(), next_take_go:nextTake().go,
       next_take_default:suggestName(undefined, false),
       last_attempt:lastAttempt(session.takes, song, before), set,
       recording:false, cloud_queue:cq, disk_bytes:48000000 * session.takes.length}));
  },
  finish_rehearsal: track('finish_rehearsal', async () => {
    const r = {ok:true, folder:session.folder, take_count:session.takes.length};
    session = null;
    midiTake = null;
    metro.run = metro.take = null;
    return r;
  }),

  open_controller_bluetooth: async () => ({ok:true}),
  controller_state: track('controller_state', async () => ({enabled: !!window.__CONTROLLER_ENABLED__, selected: window.__CONTROLLER_SELECTED__ || null, port_open: !!window.__CONTROLLER_SELECTED__, synchronized:!!window.__CONTROLLER_SELECTED__, error:null, last_action:window.__CONTROLLER_ACTION__ || null})),
  controller_ports: track('controller_ports', async () => {
    await held('controller_ports');
    return window.__CONTROLLER_PORTS__ || {system:'Fake MIDI', inputs:[], outputs:[]};
  }),
  set_controller: track('set_controller', async (input, output) => {
    if (window.__CONTROLLER_SAVE_ERROR__) return {ok:false, error:window.__CONTROLLER_SAVE_ERROR__};
    window.__CONTROLLER_SELECTED__ = input ? {input, output:output || window.__CONTROLLER_PORTS__?.outputs[0] || {name:input.name}} : null;
    window.__CONTROLLER_ENABLED__ = !!input;
    return {ok:true, ...await window.pywebview.api.controller_state()};
  }),
  control_state: track('control_state', async () => {
    const api = window.pywebview.api;
    const state = await api.transport_state();
    if (controlPending && session?.takes.some(t => t.take_number === controlPending.take_number)) controlPending = null;
    return {...state, state: controlPending ? 'unavailable' : state.state === 'unavailable' && !session ? 'idle' : state.state,
      rehearsal_active:!!session, pending_take:controlPending, playback_open:!!P,
      revision:controlSequence, action_sequence:controlSequence,
      events:window.__CONTROL_EVENTS__ || controlEvents, ...window.__CONTROL_STATE__};
  }),
  control_catalog: async () => null,
  control_command: track('control_command', async (action, parameters) => {
    const result = await window.pywebview.api.transport_command(action, parameters);
    if (result.ok && action === 'stop_review') controlPending = result;
    if (result.ok && action === 'start') controlPending = null;
    controlEvents.push({sequence:++controlSequence, action, ok:result.ok, error:result.error, undo:result.undo});
    controlEvents = controlEvents.slice(-64);
    return result;
  }),
  transport_state: async () => window.__TRANSPORT__ || ({state: midiTake && midiTake.ended === null && !session?.takes.some(t => t.take_number === takeCounter) ? 'recording' :
    P?.playing ? 'playing' : session ? 'ready' : 'unavailable', busy:false,
    error:null, pending_take:null, take_number:takeCounter, take_name:suggestName(), take_go:nextTake().go}),
  transport_command: track('transport_command', async (action, parameters) => {
    const api = window.pywebview.api;
    if (action === 'start_rehearsal') {
      const p = parameters || {};
      return api.start_rehearsal(p.name || 'Rehearsal', p.device_index ?? 0, p.samplerate || 44100, p.tracks || [], p.bit_depth || 24, p.set_id);
    }
    if (action === 'stop_rehearsal') { await api.player_close(); return api.finish_rehearsal(); }
    if (action === 'record_stop') action = midiTake && midiTake.ended === null ? 'stop_keep' : 'start';
    if (action === 'start') {
      const name = suggestName(), go = nextTake().go;
      await api.player_pause();
      return {...await api.start_take(), take_name:name, take_go:go};
    }
    if (action === 'stop_review') return api.stop_take();
    if (action === 'stop_keep') {
      const take = await api.stop_take();
      if (!take.ok) return take;
      try {
        const kept = await api.keep_take(take.take_number, take.temp_dir,
          take.suggested_name, take.duration_sec, take.tracks, [], null, take.notes);
        if (!kept.ok) return {...kept, transport:{state:'error', error:kept.error, pending_take:take}};
        return kept;
      } catch (error) {
        return {ok:false, error:error.message, transport:{state:'error', error:error.message, pending_take:take}};
      }
    }
    return {ok:false, error:'Unknown transport action'};
  }),

  // Record takes the row's tempo, signature and switch from the metronome: it
  // is given none.
  start_take: track('start_take', async () => {
    takeCounter += 1;
    midiTake = {since: clock(), ended: null, read: {},
      heard: new Set((session ? session.tracks : []).filter(t => takesNotes(t) && midiPortState(t) === 'ok')
        .map(t => t.name))};
    metroStartTake(takeCounter);
    return {ok:true, take_number:takeCounter};
  }),
  set_next_take_name: track('set_next_take_name', async (name) => {
    if (!session) return {ok:false, error:'No rehearsal in progress'};
    nextName = (name || '').trim() || null;
    metroFollow();
    return {ok:true, next_take_name:suggestName(), next_take_go:nextTake().go};
  }),
  // api.song_choices: the songs of the rehearsal (the live one with no
  // folder), each as the next go at it, and the rest of the repertoire.
  song_choices: track('song_choices', async (folder, n) => {
    await held('song_choices');
    const takes = !folder || (session && folder === session.folder)
      ? (session ? session.takes : []) : pastRehearsal(folder).takes;
    const here = songsOf(takes).map(s => ({song:s.name, go:goAt(s.name, takes, n),
                                           also:alsoOf(s.name), last_take:Math.max(...s.take_numbers),
                                           ...tempoOf(s.name)}));
    const seen = new Set(here.map(c => c.song.toLowerCase()));
    const other = repertoire.filter(song => !seen.has(song.toLowerCase()))
      .map(song => ({song, go:1, also:alsoOf(song), ...tempoOf(song)}));
    return {here, other};
  }),
  // One input pinned at the top and one silent, unless a test plays its own.
  // Counted, so a test can wait for the page to have asked again.
  get_levels: async () => {
    window.__LEVEL_POLLS__ = (window.__LEVEL_POLLS__ || 0) + 1;
    return window.__LEVELS__ || ({'Guitar':[0.99], 'Vocals':[0.0005]});
  },
  // A band with no MIDI in it leaves the two files it always has; one with
  // MIDI leaves its audio tracks' files, and a .mid for each track that took
  // notes from a port that was there (the others are missing).
  stop_take: track('stop_take', async () => {
    await held('stop_take');
    if (midiTake && midiTake.ended === null) midiTake.ended = clock() - midiTake.since;
    const band = session ? session.tracks : [];
    const take = {ok:true, take_number:takeCounter, temp_dir:'/tmp/draft',
      duration_sec:TAKE, suggested_name:suggestName(takeCounter), default_name:suggestName(takeCounter, false),
      tracks:[{name:'Guitar', file:'/rec/g.wav'}, {name:'Vocals', file:'/rec/v.wav'}],
      ...metroStop()};
    // A page can have the draft where Python keeps it, in the rehearsal's
    // _drafts folder, its files in it: a rename of the rehearsal moves them.
    if (window.__DRAFTS_IN_REHEARSAL__ && session) {
      take.temp_dir = `${session.folder}/_drafts/take ${takeCounter}`;
      take.tracks = take.tracks.map(t => ({...t, file:`${take.temp_dir}/${t.name}.wav`}));
    }
    if (!band.some(takesNotes)) return take;
    take.tracks = band.filter(takesSound).map(t => ({name:t.name, file:`/rec/${t.name}.wav`}));
    // A port that was there at any point of the take has its notes; one gone
    // the whole take has none.
    const heard = band.filter(t => takesNotes(t)
      && (midiPortState(t) === 'ok' || (midiTake && midiTake.heard.has(t.name)))).map(t => t.name);
    return {...take, ...notesOfTake(band, take.tracks, heard)};
  }),
  keep_take: track('keep_take', async (n, dir, name, dur, tracks, markers, _cloud, notes) => {
    // A crop of the draft waiting for its Undo is over once it is kept.
    const ended = endHeld(dir, null, true);
    const take = {take_number:n, ...resolved(name, session.takes, n), duration_sec:dur, tracks,
                  ...(metro.meters[n] || NO_METER),
                  markers: (markers || []).map(m => ({...m, label_id: labelIdOf(m.label_id)}))};
    // The first click take kept of a song with no tempo gives it theirs.
    if (take.click) metroGives(take);
    // The notes handed back are kept as they are; a track that took notes and
    // has none among them is missing.
    if (notes || session.tracks.some(takesNotes))
      Object.assign(take, {notes: notes || [],
        notes_missing: notesOfTake(session.tracks, tracks, (notes || []).map(x => x.name)).notes_missing});
    session.takes.push(take);
    if (n === takeCounter) nextName = null;
    metroFollow();
    cloudQueue = {...cloudQueue, [n]: 'queued'};
    return {ok:true, take, ended};
  }),
  discard_take: track('discard_take', async (dir) => {
    const folder = session ? session.folder : null;
    const ended = endHeld(dir, null);
    return {ok:true, ended, undo: hold(() => ({kind:'draft', temp_dir:dir, folder}), {folder:dir})};
  }),
  crop_take: track('crop_take', async (folder, n, a, b) => {
    await held('crop_take');
    if (!(session && folder === session.folder)) return cropPast(folder, n, a, b);
    const take = session.takes.find(t => t.take_number === n);
    if (!take) return {ok:false, error:'Take not found'};
    [a, b] = cutAt(take, a, b, take.duration_sec);
    // The take as it was, for the crop's Undo.
    const was = JSON.parse(JSON.stringify(take));
    let dropped = 0;
    take.markers = (take.markers || [])
      .filter(m => { const keep = m.at >= a && m.at <= b; if (!keep) dropped++; return keep; })
      .map(m => ({...m, at: Math.round((m.at - a) * 100) / 100}));
    take.duration_sec = b - a;
    // A rewritten file is a different file as far as the player is
    // concerned, and the mock looks lengths up by path, so give it one.
    take.tracks = take.tracks.map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of take.tracks) fileDurations[t.file] = take.duration_sec;
    // The notes are cut with the audio.
    if (take.notes) {
      take.notes = take.notes.map(n => ({...n, file: n.file + '#' + Math.round(a * 100)}));
      for (const n of take.notes) fileDurations[n.file] = take.duration_sec;
    }
    P = null;   // Python lets go of the files before rewriting them
    const ended = endHeld(folder, [n], true);
    const undo = hold(() => {
      Object.assign(take, was);
      P = null;
      return {kind:'crop', folder, take_numbers:[n]};
    }, {folder, takes:[n], crop:true});
    // Deep copy, same as rename_take — a live handle would let the interface
    // alias the mock's own state, which the real bridge never allows.
    return JSON.parse(JSON.stringify({ok:true, take, markers_dropped:dropped, undo, ended,
      start_sec:a, end_sec:b}));
  }),
  crop_draft: track('crop_draft', async (dir, tracks, a, b, notes) => {
    await held('crop_draft');
    // The draft is the take last stopped, with the meter it was recorded at.
    const length = tracks && tracks.length ? (fileDurations[tracks[0].file] ?? TAKE) : TAKE;
    [a, b] = cutAt(metro.meters[takeCounter], a, b, length);
    const cut = (tracks || []).map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of cut) fileDurations[t.file] = b - a;
    // The notes are cut with the audio, and come back when they were sent.
    const cutNotes = (notes || []).map(n => ({...n, file: n.file + '#' + Math.round(a * 100)}));
    for (const n of cutNotes) fileDurations[n.file] = b - a;
    P = null;
    const ended = endHeld(dir, null, true);
    const undo = hold(() => {
      P = null;
      return {kind:'crop', temp_dir:dir};
    }, {folder:dir, crop:true});
    return JSON.parse(JSON.stringify(
      {ok:true, tracks:cut, ...(notes ? {notes:cutNotes} : {}), duration_sec: b - a, undo, ended,
       start_sec:a, end_sec:b}));
  }),

  take_media: track('take_media', async (tracks, _buckets, _from, _to) => tracks.map(t => {
    // A file under a folder a rename moved away (spelledNow), as Python
    // answers one that is not on disk: the take is there, its file is not.
    if (t.file.startsWith('/gone/'))
      return {name:t.name, url:null, error:'Track file not found', frames:0, samplerate:0,
              duration_sec:0, peaks:[]};
    const dur = fileDurations[t.file] ?? TAKE;
    const row = Array.from({length:300}, (_, i) => Math.abs(Math.sin(i / 9)) * 0.9);
    const {icon} = withIcon({name: t.name});
    return {name:t.name, ...(icon ? {icon} : {}), url:'about:blank', frames:48000*dur,
      samplerate:48000, duration_sec:dur,
      peaks: stereo(t.name) ? [row, row.map(v => v / 2)] : [row]};
  })),

  player_open: track('player_open', async (tracks, reuseExisting = false) => {
    await held('player_open');
    if (reuseExisting && P && JSON.stringify(P.tracks) === JSON.stringify(tracks)) return {ok:true, ...playerState()};
    const dur = tracks.length ? (fileDurations[tracks[0].file] ?? TAKE) : TAKE;
    P = {tracks, playing:false, position:0, t0:clock(), duration:dur, loop:null, muted:[], soloed:null,
         volumes:Object.fromEntries(tracks.map(t => [t.name, 1])),
         master:readCfg().master_volume ?? 1};
    const out = {ok:true, ...playerState()};
    if (window.__OUTPUT_GONE__) out.warning = 'That playback device is gone, so the take plays through the system output.';
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
  player_play: track('player_play', async () => { if (P) { P.playing = true; P.t0 = clock(); } return {ok:true, ...playerState()}; }),
  player_pause: async () => { if (P) { moveTo(position()); P.playing = false; } return {ok:true, ...playerState()}; },
  player_seek: track('player_seek', async (s) => {
    await held('player_seek');
    if (P) moveTo(s); return {ok:true, ...playerState()};
  }),
  player_set_loop: track('player_set_loop', async (a, b) => {
    await held('player_set_loop');
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

  add_take_marker: track('add_take_marker', async (folder, n, sec, note, labelId) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    const at = Math.round(sec * 100) / 100;
    if (take) {
      const kept = (take.markers || []).filter(m => Math.abs(m.at - at) > 0.01);
      take.markers = [...kept, {at, note: note || '', label_id: labelIdOf(labelId ?? -1)}]
        .sort((a, b) => a.at - b.at);
    }
    // Same reason as session_state/get_rehearsal: a live handle here would
    // let the interface alias the mock's own mutable state, which the real
    // bridge's JSON round-trip never allows.
    return JSON.parse(JSON.stringify({ok:true, markers: take ? take.markers : []}));
  }),
  update_take_marker: track('update_take_marker', async (folder, n, sec, note, labelId) => {
    const take = await markedTake(folder, n);
    if (take) for (const m of take.markers || []) {
      if (Math.abs(m.at - sec) <= 0.01) {
        if (note !== null && note !== undefined) m.note = note;
        if (labelId !== null && labelId !== undefined) m.label_id = labelIdOf(labelId);
      }
    }
    keepMarks(folder, n, take);
    return JSON.parse(JSON.stringify({ok:true, markers: take ? take.markers : []}));
  }),
  remove_take_marker: track('remove_take_marker', async (folder, n, sec) => {
    const take = await markedTake(folder, n);
    if (take) take.markers = (take.markers || []).filter(m => Math.abs(m.at - sec) > 0.01);
    keepMarks(folder, n, take);
    return JSON.parse(JSON.stringify({ok:true, markers: take ? take.markers : []}));
  }),
  list_sets: track('list_sets', async () => setsAsSent()),
  add_set: track('add_set', async (name, songs) => {
    const refusal = setNameRefusal(name);
    if (refusal) return {ok:false, error:refusal};
    sets.push({id: nextSetId++, name: name.trim().slice(0, 40).trim(), songs: setSongs(songs)});
    keepSets();
    return {ok:true, sets: await setsAsSent()};
  }),
  update_set: track('update_set', async (id, name, songs) => {
    const st = sets.find(x => x.id === id);
    if (!st) return {ok:false, error:'Set not found'};
    if (name !== null && name !== undefined) {
      const refusal = setNameRefusal(name, id);
      if (refusal) return {ok:false, error:refusal};
      st.name = name.trim().slice(0, 40).trim();
    }
    if (songs !== null && songs !== undefined) st.songs = setSongs(songs);
    keepSets();
    return {ok:true, sets: await setsAsSent()};
  }),
  delete_set: track('delete_set', async (id) => {
    if (!sets.some(x => x.id === id)) return {ok:false, error:'Set not found'};
    sets = sets.filter(x => x.id !== id);
    keepSets();
    return {ok:true, sets: await setsAsSent()};
  }),
  save_next_set: track('save_next_set', async (id) => {
    writeCfg({...readCfg(), next_set: id ?? null});
    return {ok:true};
  }),
  list_labels: track('list_labels', async () => JSON.parse(JSON.stringify(await labelsAsSent()))),
  // The same rules and the same words as Python's (store/library.py).
  add_label: track('add_label', async (name, colour) => {
    const refusal = labelRefusal(name, colour);
    if (refusal) return {ok:false, error:refusal};
    labels.push({id: nextLabelId++, name: name.trim().slice(0, 40).trim(), colour});
    return {ok:true, labels: await labelsAsSent()};
  }),
  rename_label: track('rename_label', async (id, name) => {
    const label = labels.find(l => l.id === id);
    if (!label) return {ok:false, error:'Label not found'};
    const refusal = labelRefusal(name, label.colour, id);
    if (refusal) return {ok:false, error:refusal};
    label.name = name.trim().slice(0, 40).trim();
    return {ok:true, labels: await labelsAsSent()};
  }),
  recolour_label: track('recolour_label', async (id, colour) => {
    const label = labels.find(l => l.id === id);
    if (!label) return {ok:false, error:'Label not found'};
    if (!LABEL_COLOURS.includes(colour)) return {ok:false, error:'Pick a colour from the palette'};
    label.colour = colour;
    return {ok:true, labels: await labelsAsSent()};
  }),
  move_label: track('move_label', async (id, position) => {
    const label = labels.find(l => l.id === id);
    if (!label) return {ok:false, error:'Label not found'};
    labels = labels.filter(l => l.id !== id);
    labels.splice(Math.max(0, Math.min(position, labels.length)), 0, label);
    return {ok:true, labels: await labelsAsSent()};
  }),
  delete_label: track('delete_label', async (id, marksTo) => {
    const label = labels.find(l => l.id === id);
    if (!label) return {ok:false, error:'Label not found'};
    if (labels.length === 1)
      return {ok:false, error:'The last label cannot be deleted: every mark needs one'};
    const used = (await labelsAsSent()).find(l => l.id === id).marks;
    if (used) {
      if (marksTo === null || marksTo === undefined)
        return {ok:false, error:`Say which label the marks of ${label.name} get`};
      if (marksTo === id || !labels.some(l => l.id === marksTo))
        return {ok:false, error:'Their marks need another label to go to'};
      movedMarks[id] = marksTo;
      for (const t of session ? session.takes : [])
        for (const m of t.markers || []) if (m.label_id === id) m.label_id = marksTo;
    }
    labels = labels.filter(l => l.id !== id);
    return {ok:true, labels: await labelsAsSent()};
  }),

  rename_take: track('rename_take', async (folder, n, name) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) {
      Object.assign(take, resolved(name, session.takes, n));
      // A take with a tempo, named for a song with none, gives it the tempo.
      if (take.tempo != null) metroGives(take);
    }
    // Deep copy, same as session_state/get_rehearsal — a live handle would
    // alias the mock's own state, which the real bridge's JSON round-trip
    // never allows.
    return JSON.parse(JSON.stringify({ok:true, take}));
  }),
  set_take_star: track('set_take_star', async (folder, n, on) => {
    const live = session && folder === session.folder
      ? session.takes.find(t => t.take_number === n) : null;
    if (live) live.starred = Boolean(on);
    else if (on) stars.add(`${folder}#${n}`);
    else stars.delete(`${folder}#${n}`);
    const take = live || pastRehearsal(folder).takes.find(t => t.take_number === n);
    if (!take) return {ok:false, error:'Take not found'};
    // A copy, as everywhere here: the real bridge's JSON round-trip never
    // hands out the mock's own state.
    return JSON.parse(JSON.stringify({ok:true, take}));
  }),
  // The folder moves with the name, as Python moves it: the rehearsal is
  // said under the new folder from now on, its takes, drafts and what waits
  // for an Undo of it with it (spelledNow).
  rename_rehearsal: track('rename_rehearsal', async (folder, name) => {
    const live = session && folder === session.folder;
    if (live) session.name = name;
    else pastNames.set(folder, name);
    formerFolders.add(renamedTo.get(folder) ?? folder);
    renamedTo.set(folder, '/rec/' + name);
    formerFolders.delete('/rec/' + name);
    const takes = live ? session.takes
      : ((await libraryNow()).find(r => r.folder === folder)?.takes ?? []);
    return JSON.parse(JSON.stringify({ok:true, folder, name, takes}));
  }),

  // A copy, as the real bridge answers: a live handle would let the list on
  // screen change under the interface when the fake changes it.
  list_drafts: async () => JSON.parse(JSON.stringify(drafts)),
  recover_draft: track('recover_draft', async (dir) => {
    await held('recover_draft');
    // A crop of the draft waiting for its Undo is over, as when it is kept.
    const ended = endHeld(dir, null, true);
    // window.__RECOVER_FAILS__: true fails every take, a take's dir that one only.
    const fails = window.__RECOVER_FAILS__;
    if (fails === true || fails === dir)
      return {ok:false, error:'Could not recover the take: its folder is read-only', ended};
    drafts = drafts.filter(d => d.dir !== dir);
    return {ok:true, ended, take:{take_number:1, song:'Recovered', go:1, name:'Recovered 1', duration_sec:5, tracks:[], markers:[], ...NO_METER}};
  }),
  discard_draft: track('discard_draft', async (dir) => {
    const at = drafts.findIndex(d => d.dir === dir);
    if (at < 0) return {ok:false, error:'It is not there any more'};
    const ended = endHeld(dir, null);
    const [draft] = drafts.splice(at, 1);
    return {ok:true, ended, undo: hold(() => {
      drafts.splice(Math.min(at, drafts.length), 0, draft);
      return {kind:'draft', temp_dir:dir, folder:draft.rehearsal_folder};
    }, {folder:dir})};
  }),

  list_rehearsals: track('list_rehearsals', async () => ([
    {folder:'/rec/old', set_name: playedBy('/rec/old')?.name ?? null, name:'Tuesday jam', created_at:'2026-09-10T19:00:00',
     take_count:9, total_duration_sec:2520, disk_bytes:1200000000, in_cloud:3,
     songs:[{name:'Pałyn', takes:3}, {name:'Viasna', takes:2}, {name:'Ahoń', takes:1},
            {name:'Sonca', takes:1}, {name:'Dym', takes:1}, {name:'Ptuška', takes:1}],
     runs:[{song:'Pałyn', takes:[{duration_sec:300, starred:false}, {duration_sec:280, starred:false},
                                 {duration_sec:290, starred:true}]},
           {song:'Viasna', takes:[{duration_sec:260, starred:false}, {duration_sec:250, starred:false}]},
           {song:'Ahoń', takes:[{duration_sec:330, starred:false}]},
           {song:'Sonca', takes:[{duration_sec:240, starred:false}]},
           {song:'Dym', takes:[{duration_sec:270, starred:false}]},
           {song:'Ptuška', takes:[{duration_sec:300, starred:false}]}]},
    {folder:'/rec/quiet', name:'Wednesday jam', created_at:'2026-09-03T19:00:00',
     take_count:2, total_duration_sec:600, disk_bytes:340000000, songs:[],
     runs:runsOf(pastRehearsal('/rec/quiet').takes)},
    {folder:'/rec/older', name:'First rehearsal', created_at:'2026-08-25T19:00:00',
     take_count:2, total_duration_sec:470, disk_bytes:160000000, songs:[{name:'Daroha', takes:2}],
     runs:runsOf(pastRehearsal('/rec/older').takes)},
    ...(missingRehearsal ? [missingRehearsal] : [])].filter(r => !deletedRehearsals.has(r.folder))
    .map(r => ({...r, name: pastNames.get(r.folder) ?? r.name})))),
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
    await held('get_rehearsal');
    if (window.__REHEARSAL_UNREADABLE__)
      return {ok:false, error:'Could not read the rehearsal: session.json is damaged'};
    // First rehearsal has the songs a page added, as the library has them.
    const r = folder === '/rec/older' ? withExtraSongs(pastRehearsal(folder)) : pastRehearsal(folder);
    r.name = pastNames.get(folder) ?? r.name;
    r.takes = r.takes.filter(t => !deleted.has(`${folder}#${t.take_number}`));
    for (const t of r.takes) fileDurations[t.tracks[0].file] = t.duration_sec;
    return JSON.parse(JSON.stringify({ok:true, ...r, songs:songsOf(r.takes),
                                      set: await setAsSent(playedBy(folder))}));
  }),
  // The setup screen's last time (api.last_time): Tuesday jam song by song,
  // Daroha from the rehearsal before it, and the others in history's order.
  // A page with window.__NO_HISTORY__ has none of it.
  last_time: track('last_time', async () => {
    if (window.__NO_HISTORY__) return {last:null, not_played:[], earlier:[], count:0};
    const last = pastRehearsal('/rec/old');
    const older = pastRehearsal('/rec/older');
    for (const r of [last, older])
      for (const t of r.takes) fileDurations[t.tracks[0].file] = t.duration_sec;
    const inCloud = last.takes.filter(t => t.cloud && (t.cloud.mix || t.cloud.tracks)).length;
    const both = [last, older];
    const songs = songsOf(last.takes).map(s => ({...s, plays: playsOf(s.name, last,
      last.takes.filter(t => s.take_numbers.includes(t.take_number)), both)}));
    const earlier = [
      {folder:'/rec/quiet', name:'Wednesday jam', created_at:'2026-09-03T19:00:00',
       take_count:2, total_duration_sec:600, missing:false},
      {folder:'/rec/older', name:'First rehearsal', created_at:'2026-08-25T19:00:00',
       take_count:2, total_duration_sec:470, missing:false},
      ...(missingRehearsal ? [{folder:missingRehearsal.folder, name:missingRehearsal.name,
        created_at:missingRehearsal.created_at, take_count:5, total_duration_sec:1200,
        missing:true}] : [])];
    return JSON.parse(JSON.stringify({
      last: {...last, songs, runs:runsOf(last.takes), in_cloud:inCloud},
      not_played: [{name:'Daroha', folder:'/rec/older', rehearsal:'First rehearsal',
                    created_at:'2026-08-25T19:00:00', goes:2, take:older.takes[1],
                    plays: playsOf('Daroha', older, older.takes, both)}],
      earlier,
      count: earlier.length + 1}));
  }),
  // Out of the live rehearsal too, as Python takes it out of the library.
  delete_take: track('delete_take', async (folder, n) => {
    const ended = endHeld(folder, [n]);
    const key = `${folder}#${n}`;
    deleted.add(key);
    const live = session && folder === session.folder
      ? session.takes.filter(t => t.take_number === n) : [];
    if (session && live.length) session.takes = session.takes.filter(t => t.take_number !== n);
    return {ok:true, takes_left: session && folder === session.folder ? session.takes.length : 0,
      ended, undo: hold(() => {
        deleted.delete(key);
        backTonight(folder, live);
        return {kind:'take', folder, take_numbers:[n]};
      }, {folder, takes:[n]})};
  }),
  // Python takes them out of the rehearsal, the live one included.
  // A test can make it take a while (__DELETE_MS__), as moving many tracks
  // to the Trash does.
  delete_takes: track('delete_takes', async (folder, numbers) => {
    if (window.__DELETE_MS__) await new Promise(r => setTimeout(r, window.__DELETE_MS__));
    const ended = endHeld(folder, numbers);
    for (const n of numbers) deleted.add(`${folder}#${n}`);
    const live = session && folder === session.folder
      ? session.takes.filter(t => numbers.includes(t.take_number)) : [];
    if (session && folder === session.folder)
      session.takes = session.takes.filter(t => !numbers.includes(t.take_number));
    // All of them in one entry, with one Undo.
    return {ok:true, deleted:[...numbers], failed:[], ended, undo: numbers.length ? hold(() => {
      for (const n of numbers) deleted.delete(`${folder}#${n}`);
      backTonight(folder, live);
      return {kind:'takes', folder, take_numbers:[...numbers]};
    }, {folder, takes:[...numbers]}) : null};
  }),
  // Python's answers to the notice: Undo puts the removal back; its end
  // sends it on to the Trash. A token no longer waiting is gone already,
  // or back where it was when its Undo put it back (api.py _too_late): each
  // with its flag, which the interface words in the system's words.
  undo_trash: track('undo_trash', async (token) => {
    const putBack = window.__UNDOABLE__[token];
    if (!putBack) {
      return backAgain.has(token)
        ? {ok:false, back:true, error:'It is back where it was.'}
        : {ok:false, gone:true, error:'It has already gone to the Trash.'};
    }
    forgetHeld(token);
    backAgain.add(token);
    return {ok:true, ...putBack()};
  }),
  end_trash: track('end_trash', async (token) => {
    forgetHeld(token);
    return {ok:true};
  }),
  // History's Songs view (api.list_songs, api.get_song), from library().
  // The list is read when it is asked for; a test can hold the answer on its
  // way back (held), to have it arrive after one asked for later.
  list_songs: track('list_songs', async () => {
    const all = await libraryNow();
    const ids = songIds(all);
    const bySong = new Map();
    let notNamed = null;
    for (const r of all) for (const t of r.takes) {
      if (!t.song) {
        notNamed = notNamed || {takes:0, rehearsals:new Set(), last_played:r.created_at};
        notNamed.takes++; notNamed.rehearsals.add(r.folder);
        continue;
      }
      const s = bySong.get(t.song) || {id:ids.get(t.song), title:t.song, goes:0,
        rehearsals:new Set(), first_played:r.created_at, last_played:r.created_at, starred:0,
        also:alsoOf(t.song), ...tempoOf(t.song)};
      s.goes++; s.rehearsals.add(r.folder); s.starred += t.starred ? 1 : 0;
      if (r.created_at < s.first_played) s.first_played = r.created_at;
      if (r.created_at > s.last_played) s.last_played = r.created_at;
      bySong.set(t.song, s);
    }
    const songs = [...bySong.values()].map(s => ({...s, rehearsals:s.rehearsals.size}))
      .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    const answer = JSON.parse(JSON.stringify({songs,
      not_named: notNamed && {...notNamed, rehearsals:notNamed.rehearsals.size}}));
    await held('list_songs');
    return answer;
  }),
  get_song: track('get_song', async (id) => {
    const all = await libraryNow();
    const title = id === null ? null : [...songIds(all)].find(([, i]) => i === id)?.[0];
    if (title === undefined) return {ok:false, error:'Song not found'};
    const goes = [];
    for (const r of all) for (const t of r.takes)
      if ((t.song || null) === title) {
        fileDurations[t.tracks[0].file] = t.duration_sec;
        goes.push({folder:r.folder, rehearsal:r.name, created_at:r.created_at,
                   missing:r.missing, take:t});
      }
    await held('get_song');
    return JSON.parse(JSON.stringify({ok:true, id, title, also:title ? alsoOf(title) : [],
                                      plays:songPlays(goes), goes, ...tempoOf(title)}));
  }),
  // A song renamed, or merged into another (api.rename_song,
  // api.merge_songs), and an old name forgotten (api.forget_song_name) or put
  // back, as Python answers them. The files following are a done entry at
  // once.
  rename_song: track('rename_song', async (id, title) => {
    await held('rename_song');
    const all = await libraryNow();
    songIds(all);
    const from = titleOfId(id);
    const t = String(title || '').trim();
    const refuse = (error, into = null) => ({ok:false, error, into});
    if (from === undefined) return refuse('Song not found');
    if (!t) return refuse('A song needs a title');
    if (/^Take \d+$/.test(t)) return refuse(`${t} is what a take with no song is called`);
    const other = [...knownIds.keys()].find(s => s !== from && s.toLowerCase() === t.toLowerCase());
    if (other) return refuse(`There is already a song called ${other}`, {id:knownIds.get(other), title:other});
    const old = oldNames.get(t.toLowerCase());
    if (old && old.song !== from) return refuse(`${t} is ${old.song} now`, {id:knownIds.get(old.song), title:old.song});
    if (t === from) return {ok:true, title:t, goes:0};
    let goes = 0;
    for (const r of all) for (const take of r.takes) if (take.song === from) {
      retitled.set(`${r.folder}#${take.take_number}`, {song:t, go:take.go});
      goes++;
    }
    for (const take of session ? session.takes : []) if (take.song === from)
      Object.assign(take, {song:t, name:`${t} ${take.go}`});
    if (t.toLowerCase() !== from.toLowerCase()) {
      oldNames.delete(t.toLowerCase());
      oldNames.set(from.toLowerCase(), {name:from, song:t});
    }
    for (const v of oldNames.values()) if (v.song === from) v.song = t;
    knownIds.set(t, knownIds.get(from));
    knownIds.delete(from);
    if (songTempos.has(from)) { songTempos.set(t, songTempos.get(from)); songTempos.delete(from); }
    repertoire = repertoire.map(s => (s === from ? t : s));
    namesDone(`Renaming ${from} to ${t}`, goes);
    return {ok:true, title:t, goes};
  }),
  merge_songs: track('merge_songs', async (fromId, intoId, dryRun) => {
    await held('merge_songs');
    const all = await libraryNow();
    songIds(all);
    const from = titleOfId(fromId), into = titleOfId(intoId);
    if (from === undefined || into === undefined) return {ok:false, error:'Song not found'};
    if (from === into) return {ok:false, error:'A song cannot be merged into itself'};
    // Numbered after the target's highest go, the oldest rehearsal first.
    let last = 0;
    const moving = [];
    for (const r of [...all].reverse())
      for (const t of [...r.takes].sort((a, b) => a.take_number - b.take_number)) {
        if (t.song === into) last = Math.max(last, t.go);
        if (t.song === from) moving.push({r, t});
      }
    const n = moving.length;
    const counts = {ok:true, into, goes:n, rehearsals:new Set(moving.map(x => x.r.folder)).size,
                    first:n ? last + 1 : null, last:n ? last + n : null};
    if (dryRun) return counts;
    moving.forEach(({r, t}, i) =>
      retitled.set(`${r.folder}#${t.take_number}`, {song:into, go:last + 1 + i}));
    for (const v of oldNames.values()) if (v.song === from) v.song = into;
    oldNames.set(from.toLowerCase(), {name:from, song:into});
    knownIds.delete(from);
    if (songTempos.has(from) && !songTempos.has(into)) songTempos.set(into, songTempos.get(from));
    songTempos.delete(from);
    repertoire = repertoire.filter(s => s !== from);
    namesDone(`Merging ${from} into ${into}`, n);
    return counts;
  }),
  forget_song_name: track('forget_song_name', async (name) => {
    songIds(await libraryNow());
    const key = String(name || '').trim().toLowerCase();
    const old = oldNames.get(key);
    if (!old) return {ok:false, error:`No song was called ${String(name || '').trim()}`};
    oldNames.delete(key);
    return {ok:true, song_id:knownIds.get(old.song), name:old.name};
  }),
  // An old name put back (api.remember_song_name), refused as Python refuses
  // it: its song gone, the name empty, or another song's title or old name now.
  remember_song_name: track('remember_song_name', async (songId, name) => {
    songIds(await libraryNow());
    const song = titleOfId(songId);
    if (song === undefined) return {ok:false, error:'Its song is gone'};
    const spelt = String(name || '').trim();
    if (!spelt) return {ok:false, error:'A song needs a title'};
    const key = spelt.toLowerCase();
    const other = [...knownIds.keys()].find(s => s !== song && s.toLowerCase() === key);
    if (other) return {ok:false, error:`There is already a song called ${other}`};
    const old = oldNames.get(key);
    if (old && old.song !== song) return {ok:false, error:`${spelt} is ${old.song} now`};
    if (!old && key !== song.toLowerCase()) oldNames.set(key, {name:spelt, song});
    return {ok:true};
  }),
  save_history_view: track('save_history_view', async (view) => {
    if (!['rehearsals', 'songs', 'marks'].includes(view)) return {ok:false, error:'Unknown view'};
    writeCfg({...readCfg(), history_view: view});
    return {ok:true};
  }),
  // History's Marks view (api.list_marks): every mark with the label, with
  // what its row shows.
  list_marks: track('list_marks', async (labelId) => {
    if (!labels.some(l => l.id === labelId)) return {ok:false, error:'Label not found'};
    const marks = (await marksNow()).filter(x => x.m.label_id === labelId).map(({r, t, m}) => {
      if (t.tracks[0]) fileDurations[t.tracks[0].file] = t.duration_sec;
      return {folder:r.folder, rehearsal:r.name, created_at:r.created_at, missing:Boolean(r.missing),
              take_number:t.take_number, name:t.name, song:t.song ?? null,
              duration_sec:t.duration_sec, at:m.at, note:m.note || ''};
    });
    await held('list_marks');
    return JSON.parse(JSON.stringify({ok:true, marks}));
  }),
  save_marks_grouping: track('save_marks_grouping', async (grouping) => {
    if (!['rehearsal', 'song', 'list'].includes(grouping)) return {ok:false, error:'Unknown grouping'};
    writeCfg({...readCfg(), marks_grouping: grouping});
    return {ok:true};
  }),
  delete_rehearsal: track('delete_rehearsal', async (folder) => {
    const ended = endHeld(folder, null);
    deletedRehearsals.add(folder);
    return {ok:true, ended, undo: hold(() => {
      deletedRehearsals.delete(folder);
      return {kind:'rehearsal', folder};
    }, {folder})};
  }),

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
    await held('share_take');
    if (!cloudDir) return {ok:false, error:'No cloud folder chosen', needs_dir:true};
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    const shared = cloudShare(what);
    if (take) take.cloud = shared;
    // Deep copy, same as session_state/get_rehearsal — a live handle would
    // alias the mock's own state, which the real bridge's JSON round-trip
    // never allows.
    return JSON.parse(JSON.stringify({ok:true, take, cloud:shared}));
  }),
  // api.send_starred: the ★ takes with nothing in the cloud folder go as
  // What gets sent says. A tonight's copy is made at once here; an
  // older rehearsal's waits in the activity list, as Python's queue has it.
  // __UNSENDABLE__ lists take numbers whose files are gone.
  send_starred: track('send_starred', async (folder) => {
    if (!cloudDir) return {ok:false, error:'No cloud folder chosen', needs_dir:true};
    const live = session && folder === session.folder;
    const takes = live ? session.takes : pastRehearsal(folder).takes;
    const queued = [], failed = [];
    for (const t of takes) {
      if (!t.starred || t.cloud?.mix || t.cloud?.tracks) continue;
      if ((window.__UNSENDABLE__ || []).includes(t.take_number)) {
        failed.push({take_number:t.take_number, error:'The take has no files left on disk'});
        continue;
      }
      if (live) t.cloud = cloudShare(autoPublish.what);
      else {
        window.__ACTIVITY__ = [...(window.__ACTIVITY__ || []), {
          id: 900 + t.take_number, kind:'cloud', title:t.name, folder, take_number:t.take_number,
          state:'waiting', fraction:0, step:null, error:null, detail:null, retry:null, seen:false}];
      }
      queued.push(t.take_number);
    }
    return {ok:true, queued, failed};
  }),
  unshare_take: track('unshare_take', async (folder, n) => {
    await held('unshare_take');
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) take.cloud = {};
    return JSON.parse(JSON.stringify({ok:true, removed:[], trashed:true}));
  }),

  // Settings › Under the hood: the machine, the report, and the check of
  // the interface, which a page scripts through __CHECK_RESULT__ ('works',
  // 'silent', 'no_sound') and __CHECK_MS__, how long it listens. The MIDI
  // system is MIDI_SYSTEM, or with __MIDI_ERROR__ none, and why. Each of
  // these is read when the page asks, so a test can change it and open the
  // tab again: __NO_DEVICE__, no interface chosen; __NO_CRASH_LOG__, none
  // written yet; __NO_ENCODER__, no soundfile.
  under_the_hood: track('under_the_hood', async () => {
    await held('under_the_hood');
    return {
      version:'0.2.0', running_as: window.__BUILT__ ? 'built' : 'source', executable:'python.exe',
      system:'Windows 11 Pro 10.0.26200, x64',
      audio:{engine:'PortAudio V19.7.0-devel',
             systems:[{name:'MME', devices:6}, {name:'ASIO', devices:2},
                      {name:'Windows WASAPI', devices:4}],
             recording: window.__NO_DEVICE__ ? null
               : {name:'X32 USB', host_api:'ASIO', inputs:16, samplerate:48000, bit_depth:24},
             playback:'System output'},
      midi: window.__MIDI_ERROR__ ? {system:null, ports:[], error:window.__MIDI_ERROR__}
                                  : {system:MIDI_SYSTEM, ports:[], error:null},
      files:[{key:'settings', path:'C:\\Users\\alex\\.rehearsal-recorder\\config.json',
              exists:true, size:2100, modified:'2026-09-29T10:00:00'},
             {key:'history', path:'C:\\Users\\alex\\RehearsalRecordings\\library.sqlite',
              exists:true, size:98304, modified:'2026-09-29T10:00:00'},
             window.__NO_CRASH_LOG__
               ? {key:'crash_log', path:'C:\\Users\\alex\\.rehearsal-recorder\\crash.log',
                  exists:false, size:null, modified:null}
               : {key:'crash_log', path:'C:\\Users\\alex\\.rehearsal-recorder\\crash.log',
                  exists:true, size:5120, modified:'2026-09-29T10:00:00'}],
      deleting:'system', fallback_trash:'_deleted',
      libsndfile: window.__NO_ENCODER__ ? null : '1.2.2',
      server_url:'http://127.0.0.1:1234',
      releases_url:'https://github.com/voronizer/rehearsal-recorder/releases'};
  }),
  bug_report: track('bug_report', async () => ({ok:true,
    text:'РЭХА 0.2.0, run from source\nWindows 11 Pro 10.0.26200, x64\n'})),
  show_file: track('show_file', async () => ({ok:true})),
  show_rehearsal_folder: track('show_rehearsal_folder', async () => ({ok:true})),
  open_releases: track('open_releases', async (_latest) => ({ok:true})),
  // What updates.py found: __LATEST__ is the newer release a test says is
  // out, and nothing is said while checking is switched off.
  update_status: track('update_status', async () => {
    const on = readCfg().check_updates ?? true;
    return {on, latest: on ? (window.__LATEST__ || null) : null,
            download: window.__DOWNLOAD__ || null, checked: on && !!window.__CHECKED__};
  }),
  // A download as far as the test has scripted it in __DOWNLOAD__: asking
  // for one starts it at 45%, and the test moves it on.
  download_update: track('download_update', async () => {
    window.__DOWNLOAD__ = {state: 'running', version: window.__LATEST__.version, fraction: 0.45};
    return {ok: true};
  }),
  show_update: track('show_update', async () => ({ok: true})),
  set_check_updates: track('set_check_updates', async (on) => {
    writeCfg({...readCfg(), check_updates: !!on});
    return {ok:true, check_updates: !!on};
  }),
  start_interface_check: track('start_interface_check', async () => {
    await held('start_interface_check');
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
          ? "sound arrives, but every input is silent: play into them, or look at what the interface's own routing sends, and check again"
          : 'signal on inputs 1, 2, 4; the rest silent';
      } else {
        mine.rows = [first, {...first, label:'the first two channels only'}];
        mine.verdict = {cause:'no_sound', headline:'The interface opens, but sends no sound.',
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
  get_settings: async () => ({recordings_dir:recordingsNow,
    default_recordings_dir:'/Users/alex/RehearsalRecordings',
    device_index: window.__PLUGGED_IN_LATE__ ? (pluggedIn ? 1 : null)
      : recording.device_index,
    missing_device: window.__PLUGGED_IN_LATE__ && !pluggedIn
      ? {name:'X18/XR18', host_api:'Core Audio'} : null,
    samplerate: recording.samplerate,
    bit_depth: recording.bit_depth, supported_bit_depths:[16, 24],
    tracks:[], volumes:{}, master_volume: readCfg().master_volume ?? 1,
    history_view: readCfg().history_view ?? 'rehearsals',
    marks_grouping: readCfg().marks_grouping ?? 'rehearsal',
    // api._next_set: none when the set picked is gone.
    next_set: sets.some(st => st.id === readCfg().next_set) ? readCfg().next_set : null,
    output_device_index: outputDevice.index,
    output_channels: outputDevice.channels || [1, 2],
    cloud_format: cloudFormat,
    auto_publish: autoPublish.on, auto_publish_what: autoPublish.what,
    false_start_sec: readCfg().false_start_sec ?? window.__FALSE_START__ ?? 30,
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
    // Settings › Keys, as api.get_settings: anything but false is on.
    space_keys: readCfg().space_keys !== false, player_keys: readCfg().player_keys !== false,
    // The metronome's, as api.get_settings: none for the click's output until
    // one is picked, and none for one saved that is not plugged in, which is
    // named instead (window.__CLICK_MISSING__, metronome_state's
    // output_missing too, as Python has it).
    click_device_index: outputDevices().some(d => d.index === readCfg().click_device_index)
      ? readCfg().click_device_index : null,
    click_device_missing: readCfg().click_device_index != null
      && !outputDevices().some(d => d.index === readCfg().click_device_index)
      ? (window.__CLICK_MISSING__ || '') : null,
    click_channels: readCfg().click_channels ?? null,
    click_sound: readCfg().click_sound ?? 'click', click_volume: readCfg().click_volume ?? 0.7,
    count_in_bars: readCfg().count_in_bars ?? 1, tempo_in_wav: readCfg().tempo_in_wav !== false,
    metronome_on: clickOn(), drift_tolerance: readCfg().drift_tolerance ?? 0.02,
    cloud_dir: cloudDir,
    server_url:'http://127.0.0.1:1234/', config_path:'/Users/alex/.rehearsal-recorder/config.json',
    version:'0.2.0'}),
  // A folder under /nope cannot be written to. Its message carries the
  // whole path, so a long one shows what a long message does to a notice.
  // What waited for its Undo in the old folder is ended before the switch;
  // window.__KEPT__ is what could not be, which stays there.
  set_recordings_dir: async (p) => {
    if (p.startsWith('/nope')) return {ok:false, error:'Cannot write to ' + p};
    // The folder in use, however it is spelled, is no switch (api.py): its
    // Undos stay, and "same" says so.
    if (p.replace(/\/+$/, '') === recordingsNow)
      return {ok:true, recordings_dir:recordingsNow, kept:[], ended:[], same:true};
    recordingsNow = p;
    toOtherFolder();
    return {ok:true, recordings_dir:p, kept: window.__KEPT__ || [], ended: endEverything()};
  },
  choose_recordings_dir: track('choose_recordings_dir', async () => {
    recordingsNow = '/Users/alex/Dropbox/Band';
    toOtherFolder();
    return {ok:true, recordings_dir:recordingsNow, kept: window.__KEPT__ || [],
            ended: endEverything()};
  }),
  save_mix: track('save_mix', async () => ({ok:true})),
  save_master_volume: track('save_master_volume', async (v) => {
    writeCfg({...readCfg(), master_volume:v});
    return {ok:true};
  }),
  save_appearance: track('save_appearance', async (theme, scale) => {
    writeCfg({...readCfg(), theme, ui_scale:scale});
    return {ok:true};
  }),
  save_keys: track('save_keys', async (kind, on) => {
    if (!['space', 'player'].includes(kind)) return {ok:false, error:'Unknown keys'};
    writeCfg({...readCfg(), [`${kind}_keys`]: Boolean(on)});
    return {ok:true};
  }),
});
window.pywebview = { api: spelledNow(window.__MAKE_API__()) };
// A page can make a call fail the way pywebview fails one whose Python
// raised: the promise rejects with an Error carrying the exception's name.
for (const [method, message] of Object.entries(window.__FAIL__ || {})) {
  window.pywebview.api[method] = async () => {
    const e = new Error(message);
    e.name = 'UnicodeEncodeError';
    throw e;
  };
}
