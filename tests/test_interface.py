"""
The built interface in a headless browser, against a mocked Python bridge.

What matters here is not "does it look nice" but that the build is alive: the
screens render, the flow works, the interface drives Python correctly and
nothing throws. The audio itself is checked by verify_engine.py, where every
sample is visible.
"""

import os
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))
from rehearsal_recorder.mediaserver import AppServer  # noqa: E402

SHOTS = Path(__file__).resolve().parent / "screenshots"
TAKE_SECONDS = 6.0


def drag_region(page, from_ratio, to_ratio):
    """Draw a region across the timeline, the way a person does."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * from_ratio, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * to_ratio, y, steps=10)
    page.mouse.up()
    page.wait_for_timeout(250)


MOCK = """
window.__CALLS__ = [];
const track = (name, fn) => async (...args) => {
  window.__CALLS__.push({name, args});
  return fn(...args);
};

const clock = () => performance.now() / 1000;
let P = null;                 // player state, mirroring audio/player.py
let session = null;
let takeCounter = 0;
let drafts = window.__DRAFTS__ || [];
let cloudDir = null;
let cloudFormat = 'wav';
let autoPublish = window.__AUTO_PUBLISH__ || {on:false, what:'mix'};
let recording = {device_index: 0, samplerate: 44100, bit_depth: 24};
// Real playback reads each file's own length off disk; the mock has no
// disk, so a track's duration is looked up here by its own file path,
// falling back to the live session's TAKE-second default. Every path used
// for a "real" length has to be unique, or it leaks into whichever other
// take happens to reuse that dummy path.
let fileDurations = {};
let cloudQueue = {};

// The Python config lives in a file and survives a reload, so keep it in its
// own storage key rather than in page memory.
const CFG = 'mock-python-config';
const readCfg = () => {
  try { return JSON.parse(localStorage.getItem(CFG)) || {theme:'dark', ui_scale:1}; }
  catch (e) { return {theme:'dark', ui_scale:1}; }
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
// Mirrors what audio/player.py measures in the mix: post-fader, silent when
// muted or when another track is soloed, and nothing at all while stopped.
function levels() {
  if (!P || !P.playing) return {};
  const t = position();
  return Object.fromEntries(Object.keys(P.volumes).map(n => {
    const silent = P.muted.includes(n) || (P.soloed && P.soloed !== n);
    const raw = Math.abs(Math.sin(t * 2.7)) * 0.9;
    return [n, silent ? 0 : Math.round(raw * P.volumes[n] * 1000) / 1000];
  }));
}
function playerState() {
  if (!P) return {open:false};
  return {open:true, ok:true, playing:P.playing, position:position(), duration:P.duration,
          loop:P.loop, muted:P.muted, soloed:P.soloed, volumes:P.volumes, levels:levels()};
}
function moveTo(t) { P.position = Math.max(0, Math.min(P.duration, t)); P.t0 = clock(); }

// Mirrors api.suggest_take_name: n is the take being named, left out it means
// the one that comes next.
function suggestName(n) {
  const number = n === undefined ? takeCounter + 1 : n;
  if (!session || session.takes.length === 0) return 'Take ' + number;
  const last = session.takes[session.takes.length - 1].name;
  const m = /^(.*?)\\s+(\\d+)$/.exec(last);
  return m ? `${m[1]} ${Number(m[2]) + 1}` : `${last} 2`;
}

window.__MAKE_API__ = () => ({
  ping: async () => ({ok:true, message:'mock'}),
  // With a host API named, this is the Windows shape: one card listed once
  // per audio system, same name every time, and not the same channel count.
  list_input_devices: async () => (window.__HOST_API__ ? [
    {index:0, name:'Universal Audio Thunderbolt', host_api: window.__HOST_API__,
     max_input_channels:8, max_output_channels:0, default_samplerate:48000},
    {index:1, name:'Universal Audio Thunderbolt', host_api:'MME',
     max_input_channels:2, max_output_channels:0, default_samplerate:48000}] : [
    {index:0, name:'Universal Audio Thunderbolt', host_api:'',
     max_input_channels:18, max_output_channels:0, default_samplerate:48000}]),
  list_output_devices: async () => ([
    {index:0, name:'UA Monitors', host_api:'', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000},
    {index:1, name:'MacBook Speakers', host_api:'', max_input_channels:0,
     max_output_channels:2, default_samplerate:48000}]),
  set_output_device: track('set_output_device', async () => ({ok:true})),
  load_default_tracks: async () => ({
    tracks:[{name:'Guitar', channel:1}, {name:'Vocals', channel:2}]}),
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
  recording_formats: track('recording_formats', async () => ({
    ok:true, formats:{'44100':[16,24], '48000':[16,24], '96000':[24]}})),
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
  monitor_levels: track('monitor_levels', async () => ({'Guitar':0.62, 'Vocals':0.004})),
  stop_monitor: track('stop_monitor', async () => ({ok:true})),

  start_rehearsal: track('start_rehearsal', async (name, dev, rate, tr, depth) => {
    session = {name, folder:'/rec/' + name, tracks:[{name:'Guitar',channel:1},{name:'Vocals',channel:2}], takes:[]};
    takeCounter = 0;
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
       tracks:session.tracks, takes:session.takes, next_take_number:takeCounter + 1,
       next_take_name:suggestName(), recording:false, cloud_queue:cq}));
  },
  finish_rehearsal: track('finish_rehearsal', async () => {
    const r = {ok:true, folder:session.folder, take_count:session.takes.length};
    session = null;
    return r;
  }),

  start_take: track('start_take', async () => { takeCounter += 1; return {ok:true, take_number:takeCounter}; }),
  get_levels: async () => ({'Guitar':0.99, 'Vocals':0.005}),
  stop_take: async () => ({ok:true, take_number:takeCounter, temp_dir:'/tmp/draft',
    duration_sec:TAKE, suggested_name:suggestName(takeCounter),
    tracks:[{name:'Guitar', file:'/rec/g.wav'}, {name:'Vocals', file:'/rec/v.wav'}]}),
  keep_take: track('keep_take', async (n, _t, name, dur, tracks, markers) => {
    const take = {take_number:n, name:name || ('Take ' + n), duration_sec:dur,
                  tracks, markers: markers || []};
    session.takes.push(take);
    cloudQueue = {...cloudQueue, [n]: 'queued'};
    return {ok:true, take};
  }),
  discard_take: track('discard_take', async () => ({ok:true})),
  crop_take: track('crop_take', async (folder, n, a, b) => {
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
    const cut = (tracks || []).map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of cut) fileDurations[t.file] = b - a;
    P = null;
    return JSON.parse(JSON.stringify(
      {ok:true, tracks:cut, duration_sec: b - a, trashed:true, location:null}));
  }),

  take_media: track('take_media', async (tracks, buckets, from, to) => tracks.map(t => {
    const dur = fileDurations[t.file] ?? TAKE;
    return {name:t.name, url:'about:blank', frames:48000*dur, samplerate:48000, duration_sec:dur,
      peaks: Array.from({length:300}, (_, i) => Math.abs(Math.sin(i / 9)) * 0.9)};
  })),

  player_open: track('player_open', async (tracks) => {
    const dur = tracks.length ? (fileDurations[tracks[0].file] ?? TAKE) : TAKE;
    P = {playing:false, position:0, t0:clock(), duration:dur, loop:null, muted:[], soloed:null,
         volumes:Object.fromEntries(tracks.map(t => [t.name, 1]))};
    const out = {ok:true, ...playerState()};
    if (window.__OUTPUT_GONE__) out.warning = 'That playback device is gone — using the system output.';
    return out;
  }),
  player_close: track('player_close', async () => { P = null; return {ok:true}; }),
  player_state: async () => playerState(),
  player_toggle: track('player_toggle', async () => {
    if (!P) return {ok:false};
    if (P.playing) { moveTo(position()); P.playing = false; }
    else { if (P.position >= P.duration) moveTo(0); P.playing = true; P.t0 = clock(); }
    return {ok:true, ...playerState()};
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
    drafts = drafts.filter(d => d.dir !== dir);
    return {ok:true, take:{take_number:1, name:'Recovered', duration_sec:5, tracks:[], markers:[]}};
  }),
  discard_draft: track('discard_draft', async (dir) => {
    drafts = drafts.filter(d => d.dir !== dir);
    return {ok:true, trashed:true};
  }),

  list_rehearsals: async () => ([
    {folder:'/rec/old', name:'Tuesday jam', created_at:'2026-09-10T19:00:00',
     take_count:9, total_duration_sec:2520, disk_bytes:1200000000,
     songs:[{name:'Polyn', takes:3}, {name:'Vesna', takes:2}, {name:'Ogon', takes:1},
            {name:'Sonce', takes:1}, {name:'Dym', takes:1}, {name:'Ptaha', takes:1}]},
    {folder:'/rec/quiet', name:'Wednesday jam', created_at:'2026-09-03T19:00:00',
     take_count:2, total_duration_sec:600, disk_bytes:340000000, songs:[]}]),
  get_rehearsal: async (folder) => {
    // Its own path, distinct from the live session's /rec/g.wav — two takes
    // sharing a dummy path would let one's mocked length leak onto the other.
    fileDurations['/rec/old/g.wav'] = 600;
    return JSON.parse(JSON.stringify({ok:true, folder, name:'Tuesday jam',
      created_at:'2026-09-10T19:00:00',
      takes:[{take_number:1, name:'Polyn', duration_sec:600, markers:[],
              tracks:[{name:'Guitar', file:'/rec/old/g.wav'}]}]}));
  },
  delete_take: track('delete_take', async () => ({ok:true, trashed:true, takes_left:0})),
  delete_rehearsal: track('delete_rehearsal', async () => ({ok:true, trashed:true})),

  set_cloud_dir: track('set_cloud_dir', async (p) => { cloudDir = p; return {ok:true, cloud_dir:p}; }),
  choose_cloud_dir: track('choose_cloud_dir', async () => {
    cloudDir = '/Users/alex/Google Drive/Band';
    return {ok:true, cloud_dir:cloudDir};
  }),
  clear_cloud_dir: track('clear_cloud_dir', async () => { cloudDir = null; return {ok:true}; }),
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

  get_settings: async () => ({recordings_dir:'/Users/alex/RehearsalRecordings',
    default_recordings_dir:'/Users/alex/RehearsalRecordings',
    device_index: recording.device_index, samplerate: recording.samplerate,
    bit_depth: recording.bit_depth, supported_bit_depths:[16, 24],
    tracks:[], volumes:{}, output_device_index:null,
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
  set_recordings_dir: async (p) => ({ok:true, recordings_dir:p}),
  choose_recordings_dir: track('choose_recordings_dir', async () => ({ok:true, recordings_dir:'/Users/alex/Dropbox/Band'})),
  save_mix: track('save_mix', async () => ({ok:true})),
  save_appearance: track('save_appearance', async (theme, scale) => {
    writeCfg({theme, ui_scale:scale});
    return {ok:true};
  }),
});
window.pywebview = { api: window.__MAKE_API__() };
""".replace("TAKE", str(TAKE_SECONDS))


UI_DIST = PROJECT / "ui" / "dist"


def main():
    # ui/dist is build output and is not in the repository, so on a fresh
    # clone it is simply missing. Without this the suite would instead fail
    # as a page of 404s and a dozen unrelated-looking assertions.
    if not (UI_DIST / "index.html").exists():
        print("The interface is not built, so there is nothing to test.")
        print("Build it first:")
        print("    cd ui && npm install && npm run build")
        print()
        print("It is build output, not something in git — see")
        print("docs/development.md.")
        return 1

    tmp = Path(tempfile.mkdtemp())
    server = AppServer(UI_DIST, tmp / "rec")
    problems = []
    SHOTS.mkdir(parents=True, exist_ok=True)

    def ok(label, cond):
        print(("  ok   " if cond else "  FAIL ") + label)
        if not cond:
            problems.append(label)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- 1. the startup race ----------
        print("\n[1] Startup when pywebviewready fires before we subscribe")
        page = browser.new_page(viewport={"width": 1180, "height": 820})
        page.add_init_script(
            MOCK
            + """
            // What pywebview actually does: the object appears at once, the
            // methods later, and the event can pass before the app mounts.
            const realApi = window.pywebview.api;
            window.pywebview = { api: {} };
            window.dispatchEvent(new Event('pywebviewready'));
            setTimeout(() => { window.pywebview.api = realApi; }, 800);
            """
        )
        page.goto(server.base_url, wait_until="domcontentloaded")
        try:
            page.wait_for_selector("text=Start rehearsal", timeout=8000)
            ok("waits for the bridge and shows the setup screen", True)
        except Exception:
            ok("waits for the bridge and shows the setup screen", False)
        page.close()

        # ---------- 2. the bridge never answers ----------
        print("\n[2] The bridge never answers")
        page = browser.new_page(viewport={"width": 1180, "height": 820})
        page.add_init_script("window.pywebview = { api: {} };")
        page.goto(server.base_url, wait_until="domcontentloaded")
        try:
            page.wait_for_selector("text=Could not reach the audio engine", timeout=20000)
            ok("an error instead of an endless spinner", True)
            ok("with a retry button", page.locator("text=Try again").count() > 0)
        except Exception:
            ok("an error instead of an endless spinner", False)
        page.close()

        # ---------- 3. unsaved takes are offered first ----------
        print("\n[3] Unsaved takes are offered on startup")
        page = browser.new_page(viewport={"width": 1180, "height": 820})
        page.add_init_script(
            """window.__DRAFTS__ = [{dir:'/rec/old/_drafts/take 1', name:'take 1',
                 tracks:['Guitar','Vocals'], duration_sec:95,
                 rehearsal_folder:'/rec/old', rehearsal_name:'Tuesday jam',
                 created_at:'2026-09-10T19:00:00'}];"""
            + MOCK
        )
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Unsaved takes found", timeout=8000)
        ok("the recovery screen comes before everything else", True)
        ok("it says which rehearsal", page.locator("text=Tuesday jam").count() > 0)
        ok("and how long the take is", page.locator("text=1:35").count() > 0)
        page.screenshot(path=str(SHOTS / "50-drafts.png"))
        page.get_by_role("button", name="Recover").click()
        page.wait_for_selector("text=Start rehearsal", timeout=8000)
        ok("after recovering it moves on",
           len(page.evaluate("() => window.__CALLS__.filter(c => c.name === 'recover_draft')")) == 1)
        page.close()

        # ---------- 4-9. the normal flow ----------
        page = browser.new_page(viewport={"width": 1180, "height": 820})
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        # The verification server is started without an Api, so /api/... is a
        # 404 here — on purpose: this run exercises the bridge fallback, and
        # the http route itself is checked in verify_engine.py against the
        # real server. Every other console error is a real failure.
        page.on("console", lambda m: problems.append(f"console.error: {m.text}")
                if m.type == "error" and "/api/" not in m.location.get("url", "")
                and "Failed to load resource" not in m.text else None)
        page.add_init_script(MOCK)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")

        def calls(name):
            return page.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')"
            )

        print("\n[4] Setup: template, signal check, disk space")
        ok("template filled the tracks in",
           page.input_value("input[aria-label='Track 1 name']") == "Guitar")
        ok("free space is always on screen",
           page.locator("text=Room for about").count() > 0)
        page.click("text=Check signal")
        page.wait_for_timeout(600)
        ok("the monitor started", len(calls("start_monitor")) == 1)
        ok("levels are polled", len(calls("monitor_levels")) > 2)
        ok("one input shows signal", page.locator("text=signal").count() > 0)
        ok("the other shows silence", page.locator("text=silent").count() > 0)
        page.screenshot(path=str(SHOTS / "51-setup.png"))
        page.click("text=Stop checking")

        # With no /api route on this server, the meters can only have been
        # fed over the bridge — which is the fallback doing its job.
        ok("polling falls back to the bridge when the server route is absent",
           len(calls("monitor_levels")) > 2)

        print("\n[5] Recording: status is visible, not only on failure")
        ok("the setup screen shows what it will record with",
           page.locator("text=44.1 kHz · 24 bit").count() == 1)
        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 1")
        started = calls("start_rehearsal")
        ok("and starts the rehearsal with exactly that",
           started and started[-1]["args"][2] == 44100
           and started[-1]["args"][4] == 24)

        # Nothing has been recorded yet, so there is nothing to protect: one
        # level up from an empty rehearsal is what the Finish button does, and
        # it goes without asking. Python takes the empty folder with it.
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Rehearsal finished")
        ok("escape leaves a rehearsal that has nothing in it yet",
           len(calls("finish_rehearsal")) == 1)
        ok("and it says plainly that nothing was saved",
           page.locator("text=Saved: 0 takes").count() == 1)
        page.click("text=New rehearsal")
        page.wait_for_selector("text=Start rehearsal")
        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 1")

        page.click("text=Record take 1")
        page.wait_for_selector("text=Recording")
        page.wait_for_timeout(2500)
        ok("the status line is shown",
           page.locator("text=Interface connected").count() > 0)
        ok("clipping is called out", page.locator("text=clipping").count() > 0)
        ok("a silent input is called out", page.locator("text=silent").count() > 0)
        page.screenshot(path=str(SHOTS / "52-recording.png"))

        print("\n[6] Review: space saves, the name carries over")
        page.click("text=Stop")
        page.wait_for_selector("#take-name")
        ok("first take gets a number", page.input_value("#take-name") == "Take 1")
        ok("the hint says what space does here",
           page.get_by_text("save take", exact=True).count() == 1)

        # Space no longer plays here, so the button is the way to listen.
        page.wait_for_selector("button[aria-label='Play']", timeout=8000)
        page.click("button[aria-label='Play']")
        page.wait_for_timeout(400)
        ok("the take can still be listened to before saving",
           len(calls("player_toggle")) == 1)
        page.click("button[aria-label='Pause']")

        # The name field is on this screen, so space typed in it is a space.
        page.fill("#take-name", "Polyn")
        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        ok("space while naming the take does not save it",
           len(calls("keep_take")) == 0)

        # The dead air at the start of a take is visible on the waveform the
        # moment you stop recording, which makes this the screen where
        # trimming is most obviously wanted. Take 1 is cropped here, and the
        # only later section that opens it again is [9c], which clicks it to
        # prove the zoom resets and does not care how long it is; takes 2
        # onward keep their full length, which the region checks in [9]
        # depend on.
        page.wait_for_selector("button[aria-label='Crop to the region']", state="hidden")
        ok("with no region there is nothing to crop to",
           page.locator("button[aria-label='Crop to the region']").count() == 0)
        drag_region(page, 0.25, 0.75)
        page.click("button[aria-label='Crop to the region']")
        page.wait_for_selector("text=Keep only")
        page.get_by_role("button", name="Crop", exact=True).click()
        page.wait_for_timeout(600)
        cut = calls("crop_draft")
        ok("a take can be trimmed before it is ever saved",
           len(cut) == 1
           and abs(cut[0]["args"][2] - TAKE_SECONDS * 0.25) < 0.4
           and abs(cut[0]["args"][3] - TAKE_SECONDS * 0.75) < 0.4)
        ok("and the take on screen is that region now",
           page.locator("span", has_text="/ 0:03").count() >= 1)

        # Everywhere else in the app space runs the screen's main action, and
        # here that action is saving the take.
        page.fill("#take-name", "Polyn")
        page.locator("#take-name").blur()
        page.keyboard.press("Space")
        page.wait_for_timeout(600)
        ok("space saves the take", len(calls("keep_take")) == 1)

        ok("a saved take says it is on its way to the cloud",
           page.locator("text=Waiting for the cloud").count() > 0)
        # The mock's queue drains on the next read, same as the real one once
        # the copy is done — the status should follow it away.
        page.wait_for_timeout(1800)
        ok("the status clears once the cloud queue drains",
           page.locator("text=Waiting for the cloud").count() == 0)

        page.wait_for_selector("text=Record take 2")
        page.click("text=Record take 2")
        page.wait_for_selector("text=Stop")
        page.click("text=Stop")
        page.wait_for_selector("#take-name")
        ok("the next take inherits the name",
           page.input_value("#take-name") == "Polyn 2")

        # Escape is the way out of a screen, and the way out of this one is
        # giving the take up — but not without asking. The take was played
        # seconds ago and cannot be played again, and a stray key is exactly
        # the accident a confirmation is for.
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Discard this take?")
        ok("escape on review asks before dropping the take",
           len(calls("discard_take")) == 0)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        ok("a second escape closes the question instead of answering it",
           page.locator("text=Discard this take?").count() == 0
           and len(calls("discard_take")) == 0)
        ok("and the take is still there to save",
           page.input_value("#take-name") == "Polyn 2")

        # Marks can be made here too, before the take is saved. There is no
        # folder for them yet, so they ride along with keep_take.
        ok("the review screen offers marking",
           page.locator("button[aria-label='Add marker']").count() == 1)
        page.click("button[aria-label='Add marker']")
        page.wait_for_selector("text=Marker at")
        page.get_by_role("button", name="Keep this").click()
        page.fill("input[aria-label='Marker note']", "this one is the take")
        page.get_by_role("button", name="Save", exact=True).click()
        page.wait_for_timeout(300)
        ok("the mark shows on the chip before saving",
           page.locator("text=this one is the take").count() == 1)
        page.click("text=Save take")
        page.wait_for_selector("text=Record take 3")
        kept = calls("keep_take")
        saved_markers = kept[-1]["args"][5] if kept and len(kept[-1]["args"]) > 5 else None
        ok("and it reaches Python when the take is saved",
           bool(saved_markers) and saved_markers[0]["note"] == "this one is the take")
        ok("with the kind it was given",
           bool(saved_markers) and saved_markers[0]["kind"] == "good")

        print("\n[7] Markers while listening back")
        # A prefix match: right after a take is saved its pill can still be
        # showing "Waiting for the cloud" appended to the label, and the take
        # is the same take either way.
        page.click("button[aria-label^='Take 2 Polyn 2']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
        ok("picking a take opens it in the player below",
           page.get_by_role("group", name="Take timeline").count() == 1)
        ok("and the pill says it is the open one",
           page.locator("button[aria-label^='Take 2 Polyn 2']")
               .get_attribute("aria-current") == "true")

        # The mark made on the review screen, before this take had a folder,
        # is here waiting — same take, same marker, one player.
        ok("a mark made before saving is on the saved take",
           page.locator("text=this one is the take").count() == 1)

        page.click("button[aria-label='Forward 10 seconds']")
        page.wait_for_timeout(200)
        page.click("button[aria-label='Add marker']")
        page.wait_for_timeout(400)
        marker_calls = calls("add_take_marker")
        ok("the marker went to Python", len(marker_calls) == 1)
        ok("at the current position", marker_calls and marker_calls[0]["args"][2] > 0)

        # The note opens by itself: the thought about what just went wrong
        # does not survive a hunt through the interface.
        ok("its note opens straight away",
           page.locator("text=Marker at").count() == 1)
        page.get_by_role("button", name="Went wrong").click()
        page.fill("input[aria-label='Marker note']", "guitar drifts here")
        page.get_by_role("button", name="Save", exact=True).click()
        page.wait_for_timeout(400)
        saved = calls("update_take_marker")
        ok("the note reached Python",
           saved and saved[-1]["args"][3] == "guitar drifts here")
        ok("and its kind with it", saved and saved[-1]["args"][4] == "issue")
        # This has to be true without ever clicking away from Take 2 and
        # back — the player's "selected" take is only an identity now, so
        # its fields (markers included) have to come from the live takes
        # array, or a saved note would stay invisible until the next reopen.
        ok("the note is on the chip",
           page.locator("text=guitar drifts here").count() > 0)

        # Landing on an existing marker opens it rather than adding a second
        # one on top — the take already has one at the very start.
        page.click("button[aria-label='To start']")
        page.wait_for_timeout(300)
        ok("on top of an existing mark the button opens it",
           page.locator("button[aria-label='Edit marker']").count() == 1)
        page.click("button[aria-label='Edit marker']")
        page.wait_for_selector("text=Marker at")
        page.get_by_role("button", name="Cancel").click()
        page.wait_for_timeout(300)

        # Somewhere else it adds, and both survive side by side.
        page.click("button[aria-label='Back 10 seconds']")
        page.click("button[aria-label='Forward 10 seconds']")
        page.wait_for_timeout(200)
        ok("two markers now live on this take",
           page.locator("button[aria-label^='Remove marker at']").count() == 2)
        ok("and each can be opened",
           page.locator("button[aria-label^='Edit marker at']").count() == 2)
        page.screenshot(path=str(SHOTS / "53-markers.png"))

        print("\n[7b] When the chosen output is not there any more")
        # A saved device index goes stale the moment the interface is
        # unplugged. The take must still play, and say where it is coming out.
        page.click("button[aria-label^='Take 1 Polyn']")      # away
        page.wait_for_timeout(200)
        page.evaluate("() => { window.__OUTPUT_GONE__ = true }")
        page.click("button[aria-label^='Take 2 Polyn 2']")    # and back
        page.wait_for_selector("text=using the system output", timeout=8000)
        ok("it says where the sound went", True)
        ok("and the take still opened",
           page.locator("button[aria-label='Mute Guitar']").count() == 1)
        page.evaluate("() => { window.__OUTPUT_GONE__ = false }")

        print("\n[7c] Escape closes a dialog first, the take second")
        # A delete confirmation has no input to focus — the case the
        # tag-only guard in useEscape missed. Radix closes the dialog on
        # Escape without stopping the event from reaching the window
        # listener, so that listener must not also give up the take
        # underneath a dialog that is still open.
        page.click("button[aria-label='Delete take Polyn 2']")
        page.wait_for_selector("text=go to the Trash")
        # Radix's own auto-focus actually lands on Cancel here, which
        # useSpacebar's separate "don't fight a focused button" rule already
        # excludes — clicking the description (nothing focusable there) is
        # what moves focus to the dialog content itself, a DIV, which is the
        # case a tag-only guard cannot see and the one that matters for the
        # other two hooks too.
        page.click("text=go to the Trash")

        # A trusted keypress would also activate whatever has focus (e.g. a
        # button, natively, on release) and confound the check, so this
        # dispatches the keydown itself — exactly what the window listener
        # sees — to isolate the guard from that native behaviour.
        toggles_before = len(calls("player_toggle"))
        page.evaluate(
            "() => window.dispatchEvent(new KeyboardEvent("
            "'keydown', {code:'Space', bubbles:true, cancelable:true}))"
        )
        page.wait_for_timeout(200)
        ok("space does not toggle playback behind an open dialog",
           len(calls("player_toggle")) == toggles_before)

        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        ok("escape dismisses the confirmation instead of confirming it",
           page.locator("text=go to the Trash").count() == 0)
        ok("nothing was actually deleted", len(calls("delete_take")) == 0)
        ok("and leaves the open take's player alone",
           page.get_by_role("group", name="Take timeline").count() == 1)

        # With no dialog left to claim it, the same key now gives the take up.
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        ok("and with nothing else open, escape closes the take",
           page.get_by_role("group", name="Take timeline").count() == 0)

        page.click("button[aria-label^='Take 2 Polyn 2']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)

        print("\n[8] Renaming")
        page.click("button[aria-label='Rename take Polyn 2']")
        page.wait_for_selector("text=Rename take")
        page.fill("input:below(:text('The folder on disk is renamed too'))", "Polyn (best)")
        page.click("button:has-text('Rename')")
        page.wait_for_timeout(400)
        ok("the take was renamed", calls("rename_take")[-1]["args"][2] == "Polyn (best)")
        page.click("button[aria-label='Rename rehearsal']")
        page.wait_for_selector("text=Rename rehearsal")
        page.fill("input:below(:text('The folder keeps its date'))", "Tuesday jam")
        page.click("button:has-text('Rename')")
        page.wait_for_timeout(400)
        ok("the rehearsal was renamed",
           calls("rename_rehearsal")[-1]["args"][1] == "Tuesday jam")

        # Renaming reopens the player from zero (a new `tracks` identity
        # tears down and re-runs the open effect) — this only proves the
        # take stays selected and on screen through that, not that playback
        # or the A-B region survive it. They don't; see docs/using-it.md.
        ok("renaming leaves a player on screen",
           page.locator("button[aria-label='Repeat']").count() == 1)

        print("\n[9] Repeat, mix and history")
        page.click("button[aria-label='Repeat']")
        page.wait_for_timeout(300)
        loop = calls("player_set_loop")
        ok("repeat covers the whole take",
           loop and loop[-1]["args"] == [0, TAKE_SECONDS])

        # The region is drawn across the tracks, not clicked together out of
        # two buttons. A press that does not travel is still a seek, which is
        # what makes one surface able to serve both.
        surface = page.get_by_role("group", name="Take timeline")
        box = surface.bounding_box()
        lane = page.locator("canvas").first.locator("xpath=..").bounding_box()
        ok("the timeline surface sits exactly over the lanes",
           abs(lane["x"] - box["x"]) < 1.5 and abs(lane["width"] - box["width"]) < 1.5)
        mid_y = box["y"] + box["height"] / 2

        def drag(from_ratio, to_ratio):
            page.mouse.move(box["x"] + box["width"] * from_ratio, mid_y)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] * to_ratio, mid_y, steps=10)
            page.mouse.up()
            page.wait_for_timeout(200)

        drag(0.25, 0.75)
        loop = calls("player_set_loop")
        ok("dragging across the tracks sets the loop region",
           loop and abs(loop[-1]["args"][0] - TAKE_SECONDS * 0.25) < 0.4
           and abs(loop[-1]["args"][1] - TAKE_SECONDS * 0.75) < 0.4)
        # The times live on the band itself, checked in [9c]; the transport
        # only offers to clear it.
        page.get_by_role("button", name="Clear the loop region").click()
        page.wait_for_timeout(250)
        ok("clearing it takes the offer to clear with it",
           page.get_by_role("button", name="Clear the loop region").count() == 0)
        ok("and tells Python there is no region left",
           calls("player_set_loop")[-1]["args"] == [None, None]
           or calls("player_set_loop")[-1]["args"] == [0, TAKE_SECONDS])

        drag(0.75, 0.25)
        loop_back = calls("player_set_loop")
        ok("dragging the other way gives the same region",
           abs(loop_back[-1]["args"][0] - loop[-1]["args"][0]) < 0.4
           and abs(loop_back[-1]["args"][1] - loop[-1]["args"][1]) < 0.4)

        seeks_before = len(calls("player_seek"))
        page.mouse.move(box["x"] + box["width"] * 0.5, mid_y)
        page.mouse.down()
        page.mouse.up()
        page.wait_for_timeout(200)
        ok("a press that does not travel seeks instead",
           len(calls("player_seek")) == seeks_before + 1
           and len(calls("player_set_loop")) == len(loop_back))

        # An edge moves on its own: grabbing B must not drag A along with it.
        # The grab target lives in the ruler band, not down the whole lane
        # height, so taking hold of an edge means pressing up there.
        drag(0.25, 0.75)
        started = calls("player_set_loop")[-1]["args"]
        edge_y = box["y"] + 12
        page.mouse.move(box["x"] + box["width"] * 0.75, edge_y)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.5, edge_y, steps=8)
        page.mouse.up()
        page.wait_for_timeout(200)
        moved = calls("player_set_loop")[-1]["args"]
        ok("dragging an edge moves that edge",
           abs(moved[1] - TAKE_SECONDS * 0.5) < 0.4)
        ok("and leaves the other one where it was",
           abs(moved[0] - TAKE_SECONDS * 0.25) < 0.05)

        # The clock is chosen from a ladder and from how much room a tick has,
        # so a six-second take across this width gets one-second steps. The
        # other end of that ladder is checked on the long take in history.
        ok("the ruler's clock fits the take",
           "0:05" in page.get_by_role("group", name="Timeline clock").inner_text())

        # The meter is measured in the mix rather than derived from the
        # picture, so it says nothing until something is playing — and what it
        # says is what came out, after the fader and the mute.
        meter = page.get_by_role("meter", name="Guitar level")
        page.click("button[aria-label='Play']")
        page.wait_for_timeout(700)
        ok("the meter follows the take while it plays",
           int(meter.get_attribute("aria-valuenow")) > 0)
        # Taken here, playing, because the level lives inside the fader: a
        # paused player shows an empty one and says nothing about it.
        page.screenshot(path=str(SHOTS / "54-player.png"))
        page.click("button[aria-label='Mute Guitar']")
        page.wait_for_timeout(400)
        ok("and reads nothing at all on a muted track",
           meter.get_attribute("aria-valuenow") == "0")
        page.click("button[aria-label='Mute Guitar']")
        page.wait_for_timeout(300)
        page.click("button[aria-label='Pause']")
        page.wait_for_timeout(400)
        ok("and goes quiet again when the take stops",
           meter.get_attribute("aria-valuenow") == "0")

        page.click("button[aria-label='Mute Guitar']")
        page.click("button[aria-label='Solo Vocals']")
        page.wait_for_timeout(300)
        ok("mute reached Python", calls("player_set_muted")[-1]["args"] == ["Guitar", True])
        ok("solo reached Python", calls("player_set_solo")[-1]["args"] == ["Vocals"])

        print("\n[9c] Zooming the timeline")
        # Fifteen seconds of a nine-minute take is twenty pixels wide: the
        # gesture built last release is at its worst exactly where it is
        # needed most.
        box = page.get_by_role("group", name="Take timeline").bounding_box()
        mid_y = box["y"] + box["height"] / 2
        clock = page.get_by_role("group", name="Timeline clock")
        whole_take_clock = clock.inner_text()

        def seek_at(ratio):
            """Where a click at this fraction of the width lands, in seconds."""
            page.mouse.move(box["x"] + box["width"] * ratio, mid_y)
            page.mouse.down()
            page.mouse.up()
            page.wait_for_timeout(250)
            return calls("player_seek")[-1]["args"][0]

        def wheel_at(ratio, dx, dy):
            page.mouse.move(box["x"] + box["width"] * ratio, mid_y)
            page.mouse.wheel(dx, dy)
            page.wait_for_timeout(400)

        def clock_labels():
            """The times written on the ruler, in seconds."""
            out = []
            for text in clock.locator("span.tnum").all_inner_texts():
                minutes, seconds = text.strip().split(":")
                out.append(int(minutes) * 60 + int(seconds))
            return out

        whole_take_labels = clock_labels()
        before = seek_at(0.3)
        wheel_at(0.3, 0, -500)
        # A ruler with nothing left on it also reads differently from the whole
        # take's, so "the text changed" is not enough: a tick ladder that
        # starts above the shortest zoom window empties the ruler instead of
        # rescaling it, and it flickers between one label and none as the
        # window is panned. This asks the zoomed ruler for a clock, and asks
        # that the clock belongs to the part of the take being shown.
        zoomed = clock_labels()
        ok("the wheel zooms in", zoomed != whole_take_labels)
        ok("and the timeline says what part of the take is on screen",
           page.locator("text=Whole take").count() == 1)
        # Where a click at each end of the surface lands is the window itself,
        # which is what the ruler has to be labelling.
        window_from, window_to = seek_at(0.02), seek_at(0.98)
        ok("and the zoomed ruler still has a time on it, inside the window",
           zoomed != [] and window_from - 0.1 <= zoomed[0] <= window_to + 0.1)
        # Anchored, not centred: the second under the pointer stays under the
        # pointer, which is the difference between aiming and hunting.
        ok("the second under the pointer stays under it",
           abs(seek_at(0.3) - before) < 0.2)

        mid_before = seek_at(0.6)
        wheel_at(0.6, 200, 0)
        ok("scrolling sideways moves along the take", seek_at(0.6) > mid_before)

        # Shift and the wheel is the same gesture on a mouse, but not the same
        # event: Chromium leaves the value in deltaY, while WebKit and Firefox
        # move it to deltaX and leave deltaY at zero. This app runs on WebKit
        # on macOS, and headless Chromium cannot produce that shape, so the
        # event is dispatched as WebKit sends it.
        shifted_before = seek_at(0.6)
        page.get_by_role("group", name="Take timeline").evaluate(
            "el => el.dispatchEvent(new WheelEvent('wheel', {shiftKey: true, "
            "deltaX: 200, deltaY: 0, bubbles: true, cancelable: true}))"
        )
        page.wait_for_timeout(400)
        ok("and so does shift with the wheel, whichever axis carries it",
           seek_at(0.6) > shifted_before)

        page.click("text=Whole take")
        page.wait_for_timeout(400)
        ok("and Whole take gives the whole take back",
           page.locator("text=Whole take").count() == 0
           and clock.inner_text() == whole_take_clock)

        # A marker off the side of the window is not drawn at all: without
        # that it would be pinned to the edge, pointing at the wrong second.
        all_markers = page.locator("[data-marker-at]").evaluate_all(
            "els => els.map(e => Number(e.dataset.markerAt))")
        ok("markers are on the timeline to start with", len(all_markers) > 1)
        wheel_at(0.98, 0, -900)   # the last seconds of the take
        # Past this the wheel simply stops answering, and without a word
        # saying so that reads as the zoom having broken.
        ok("the closest window says it is the closest",
           page.locator("text=closest").count() == 1)
        wheel_at(0.5, 300, 0)     # and right up against the end itself
        drawn = page.locator("[data-marker-at]").evaluate_all(
            "els => els.map(e => Number(e.dataset.markerAt))")
        # An empty list satisfies "all of them are late in the take", so that
        # on its own would pass against a timeline that drew nothing at all:
        # the mark at the end of the take has to still be on it, and the one
        # at the start has to be gone.
        ok("and only the ones inside the window are drawn",
           drawn and all(at >= TAKE_SECONDS / 2 for at in drawn)
           and len(drawn) < len(all_markers))
        page.screenshot(path=str(SHOTS / "56-zoom.png"))

        # A region's duration chip is only about the region — it must not go
        # on labelling a stretch of the take the region has nothing to do
        # with once the window has moved away from it. A chip pinned to the
        # edge of the wrong part of the take is worse than no chip.
        page.click("text=Whole take")
        page.wait_for_timeout(400)
        drag_region(page, 0.05, 0.2)
        ok("the region's read-out shows while the window overlaps it",
           page.locator("[data-region-span]").count() == 1)
        wheel_at(0.98, 0, -900)   # the far end, nowhere near the region
        ok("and it is gone once the window has nothing to do with the region",
           page.locator("[data-region-span]").count() == 0)

        page.click("button[aria-label^='Take 1 Polyn']")
        page.wait_for_timeout(700)
        ok("and picking another take starts from the whole of it",
           page.locator("text=Whole take").count() == 0)
        page.click("button[aria-label^='Take 2 Polyn (best)']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)

        print("\n[9d] The waveform sharpens to what is on screen")
        # Stretching the same 900 bars over two seconds shows no more than it
        # did over nine minutes, so the peaks are fetched again for the window.
        # Not on every wheel tick, though: that would be a burst of calls into
        # Python for a picture nobody has finished aiming yet.
        ranged_before = len([c for c in calls("take_media")
                             if len(c["args"]) > 2 and c["args"][2] is not None])
        page.mouse.move(box["x"] + box["width"] * 0.5, mid_y)
        for _ in range(6):
            page.mouse.wheel(0, -120)
        page.wait_for_timeout(900)
        ranged = [c for c in calls("take_media")
                  if len(c["args"]) > 2 and c["args"][2] is not None]
        fresh = len(ranged) - ranged_before
        ok("the peaks are fetched again for the part on screen", fresh >= 1)
        ok("once the wheel settles, not once per notch", fresh <= 3)
        ok("and for the window that is actually showing",
           abs(ranged[-1]["args"][2] - ranged[-1]["args"][3]) > 0
           and ranged[-1]["args"][3] > ranged[-1]["args"][2])
        page.click("text=Whole take")
        page.wait_for_timeout(700)

        print("\n[9e] Cropping a take to the region")
        # The region drove one thing until now. Trimming the take to it is the
        # other, and it is what makes a nine-minute take that holds three
        # minutes of music into a three-minute take.
        # A region that is the whole take has nothing to remove, so the button
        # is there but will not do anything.
        drag_region(page, 0.0, 1.0)
        ok("a region covering the whole take offers no crop",
           page.get_by_role("button", name="Crop to the region").is_disabled())
        # The button's own title cannot say so — a disabled button takes no
        # pointer events, so it is never hovered.
        ok("and the reason is on screen rather than in a tooltip",
           page.locator("text=that is the whole take").count() == 1)

        # A slip of the mouse is the opposite mistake, and the advice for one
        # is no use at all for the other.
        drag_region(page, 0.40, 0.45)
        ok("a region too short to keep offers no crop either",
           page.get_by_role("button", name="Crop to the region").is_disabled())
        ok("and gets the opposite advice",
           page.locator("text=at least a second to crop").count() == 1)

        drag_region(page, 0.25, 0.75)
        crop = page.get_by_role("button", name="Crop to the region")
        ok("a region offers to trim the take to itself", crop.count() == 1)
        crop.click()
        page.wait_for_selector("text=Keep only")
        asked = page.locator("[role=dialog]").inner_text()
        ok("the question names the part being kept", "Keep only 0:01" in asked)
        ok("and says where what it removes is going",
           "Trash" in asked or "_deleted" in asked)
        page.get_by_role("button", name="Crop", exact=True).click()
        page.wait_for_timeout(700)
        cropped = calls("crop_take")
        ok("cropping reached Python with the region",
           len(cropped) == 1
           and abs(cropped[0]["args"][2] - TAKE_SECONDS * 0.25) < 0.4
           and abs(cropped[0]["args"][3] - TAKE_SECONDS * 0.75) < 0.4)
        ok("the take is the region now — three seconds, not six",
           page.locator("span", has_text="/ 0:03").count() >= 1)
        ok("and the region is cleared, because the take is that region",
           page.get_by_role("button", name="Clear the loop region").count() == 0)

        # A crop can succeed while the sweep of the pre-crop original still
        # fails — a full disk, a permissions problem — and that must not
        # vanish silently: the take as it was recorded is sitting somewhere
        # outside the Trash, and this message is the only thing that says
        # where. Wraps the real handler rather than replacing session logic,
        # and puts it back afterwards so no later section inherits it. The
        # answer is held back until this section lets it go, which is also the
        # only way to see the screen a person is looking at while eight long
        # tracks are rewritten — a second Crop then is not a no-op: Python
        # re-reads the now shorter take and cuts it again.
        page.evaluate(
            """() => {
                window.__REAL_CROP_TAKE__ = window.pywebview.api.crop_take;
                window.__RELEASE_CROP__ = null;
                window.pywebview.api.crop_take = async (...args) => {
                    await new Promise(go => { window.__RELEASE_CROP__ = go; });
                    const res = await window.__REAL_CROP_TAKE__(...args);
                    return {...res, error: 'Could not remove it: no space left on device',
                            location: '/rec/Tuesday jam/_deleted/take 2 (original)'};
                };
            }"""
        )
        drag_region(page, 0.2, 0.8)
        page.get_by_role("button", name="Crop to the region").click()
        page.wait_for_selector("text=Keep only")
        page.get_by_role("button", name="Crop", exact=True).click()
        page.wait_for_timeout(400)
        ok("a crop already running does not offer to run again",
           page.get_by_role("button", name="Crop to the region").is_disabled())
        page.evaluate("() => window.__RELEASE_CROP__()")
        page.wait_for_timeout(700)
        ok("a crop that could not sweep its original still says so",
           page.get_by_text("could not be moved out of the way").count() > 0)
        ok("and names where the original actually is",
           page.get_by_text("/rec/Tuesday jam/_deleted/take 2 (original)").count() > 0)
        ok("but the crop itself still went through",
           page.locator("button[aria-label='Crop to the region']").count() == 0)
        page.evaluate(
            "() => { window.pywebview.api.crop_take = window.__REAL_CROP_TAKE__; }"
        )

        print("\n[10] Sharing a take to the cloud")
        page.click("button[aria-label='Copy Polyn (best) to the cloud']")
        page.wait_for_selector("text=No cloud folder chosen yet")
        ok("it says there is nowhere to copy to yet",
           page.get_by_role("button", name="The mix", exact=True).is_disabled())
        page.click("text=Choose")
        page.wait_for_timeout(300)
        ok("the folder picker was called", len(calls("choose_cloud_dir")) == 1)
        page.get_by_role("button", name="Both", exact=True).click()
        page.wait_for_timeout(400)
        share = calls("share_take")
        ok("the take went up", len(share) == 1 and share[0]["args"][2] == "both")
        ok("and the row shows it is there",
           page.locator("button[aria-label='Cloud copies of Polyn (best)']").count() == 1)
        page.screenshot(path=str(SHOTS / "55-cloud.png"))

        page.click("button[aria-label='Cloud copies of Polyn (best)']")
        page.wait_for_selector("text=already there")
        page.click("text=Remove from the cloud")
        page.wait_for_timeout(400)
        ok("removing it again reached Python", len(calls("unshare_take")) == 1)
        ok("and the row goes back to plain",
           page.locator("button[aria-label='Copy Polyn (best) to the cloud']").count() == 1)

        print("\n[11] Finishing and history")
        # On the rehearsal screen the ladder is the open take, then the
        # rehearsal itself — and by now the rehearsal has takes in it, so that
        # rung is a decision and asks.
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        ok("escape closes the open take first",
           page.get_by_role("group", name="Take timeline").count() == 0)
        finishes = len(calls("finish_rehearsal"))
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Finish this rehearsal?")
        ok("and then asks before ending a rehearsal with takes in it",
           len(calls("finish_rehearsal")) == finishes)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        ok("a second escape closes the question instead of answering it",
           page.locator("text=Finish this rehearsal?").count() == 0
           and len(calls("finish_rehearsal")) == finishes)

        page.click("text=Finish")
        page.wait_for_selector("text=Rehearsal finished")
        page.click("text=History")
        page.wait_for_selector("text=Tuesday jam")

        page.click("text=Tuesday jam")
        page.click("button[aria-label='Take 1 Polyn']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
        ok("a ten-minute take gets a clock in minutes",
           "2:00" in page.get_by_role("group", name="Timeline clock").inner_text())
        # Escape peels one layer at a time: first the open take, then the
        # rehearsal it was in.
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        ok("escape closes the open take",
           page.get_by_role("group", name="Take timeline").count() == 0
           and page.locator("button[aria-label='Take 1 Polyn']").count() == 1)
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Wednesday jam")
        ok("and escape again leaves the rehearsal",
           page.locator("button[aria-label='Take 1 Polyn']").count() == 0)

        # Months later a rehearsal is recognised by what was played in it, so
        # the row carries the songs, not just a count of takes. A long list is
        # cut off: the row has to be readable at a glance.
        named = page.locator("button", has_text="Tuesday jam").first
        quiet = page.locator("button", has_text="Wednesday jam").first
        ok("the row says what was rehearsed, and cuts a long list short",
           "Polyn ×3 · Vesna ×2 · Ogon · Sonce · and 2 more" in named.inner_text())
        ok("and how long it ran, and what it costs on disk",
           "10 Sep 2026, 19:00 · 42 min · 1.2 GB" in named.inner_text())
        # Takes the app named itself are not songs, and there is nothing
        # truthful to put on that line — so the line is not there.
        ok("a rehearsal where nothing was named gets no song line",
           len(quiet.inner_text().strip().splitlines()) == 3)
        page.screenshot(path=str(SHOTS / "56-history.png"))

        page.click("button[aria-label='Delete rehearsal Tuesday jam']")
        page.wait_for_selector("text=goes to the Trash")
        # The space is the reason people delete a rehearsal at all, so the
        # confirmation says how much of it is coming back.
        ok("the confirmation says what is being freed",
           page.get_by_text("9 takes, 1.2 GB").count() == 1)
        page.click("text=Cancel")
        page.wait_for_timeout(200)
        ok("cancel deletes nothing", len(calls("delete_rehearsal")) == 0)
        page.click("button[aria-label='Delete rehearsal Tuesday jam']")
        page.wait_for_selector("text=goes to the Trash")
        page.locator("button", has_text="Delete").last.click()
        page.wait_for_timeout(400)
        ok("confirming deletes", len(calls("delete_rehearsal")) == 1)

        print("\n[12] Settings: output, folders, appearance")
        page.click("button[aria-label='Back']")
        page.wait_for_selector("text=Start rehearsal")
        page.click("button[aria-label='Settings']")
        page.wait_for_selector("text=Recording")

        # A screen with a way back has one on the keyboard too.
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Start rehearsal")
        ok("escape leaves settings", page.locator("#input-device").count() == 0)
        page.click("button[aria-label='Settings']")
        page.wait_for_selector("text=Recording")

        print("\n[12a] Settings is grouped, not one long column")
        ok("it opens on Audio", page.locator("#input-device").count() == 1)
        ok("and folders are not on that page",
           page.locator("#recordings-dir").count() == 0)
        ok("every group is reachable",
           all(page.get_by_role("button", name=name, exact=True).count() >= 1
               for name in ("Audio", "Folders", "Appearance", "Under the hood")))

        # The version belongs next to the settings path: both are what somebody
        # quotes when something has gone wrong.
        page.get_by_role("button", name="Under the hood", exact=True).first.click()
        page.wait_for_timeout(200)
        ok("the version it is running is on screen",
           page.locator("dd", has_text="0.2.0").count() == 1)
        page.get_by_role("button", name="Audio", exact=True).first.click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "58-settings-audio.png"))

        page.get_by_role("button", name="Folders", exact=True).first.click()
        page.wait_for_selector("#recordings-dir")
        ok("folders has the folders", page.locator("#cloud-dir").count() == 1)
        ok("and the audio settings are out of the way",
           page.locator("#input-device").count() == 0)
        page.screenshot(path=str(SHOTS / "59-settings-folders.png"))

        ok("the folder is shown",
           "RehearsalRecordings" in page.input_value("#recordings-dir"))
        page.click("button[aria-label='Choose recordings folder']")
        page.wait_for_timeout(300)
        ok("the native picker was called", len(calls("choose_recordings_dir")) == 1)
        ok("the cloud folder is in settings too",
           "Google Drive" in page.input_value("#cloud-dir"))

        print("\n[12b] Recording settings live here now")
        page.get_by_role("button", name="Audio", exact=True).first.click()
        page.wait_for_selector("#input-device")
        ok("the interface is chosen here",
           page.locator("#input-device").count() == 1)
        # One card, one entry: the note about duplicates would be noise here,
        # and a note that is always on is a note nobody reads.
        ok("and nothing is said about duplicates when there are none",
           page.locator(
               "text=they do not all offer the same number of inputs"
           ).count() == 0)
        ok("the rates the card can do are offered",
           page.locator("button[aria-label='44.1 kHz']").count() == 1
           and page.locator("button[aria-label='96 kHz']").count() == 1)
        page.click("button[aria-label='48 kHz']")
        page.wait_for_timeout(400)
        fmt = calls("set_recording_format")
        ok("changing the rate saves straight away",
           fmt and fmt[-1]["args"][1] == 48000)
        ok("and keeps the depth", fmt and fmt[-1]["args"][2] == 24)

        # This card does 96 kHz only at 24 bit, so 16 must stop being offered.
        page.click("button[aria-label='96 kHz']")
        page.wait_for_timeout(400)
        ok("a rate the card only does at 24 bit disables 16",
           page.locator("button[aria-label='16 bit']").is_disabled())
        page.click("button[aria-label='44.1 kHz']")
        page.wait_for_timeout(300)

        print("\n[12c] What cloud copies are written as")
        page.get_by_role("button", name="Folders", exact=True).first.click()
        page.wait_for_selector("#cloud-dir")
        ok("the three formats are offered",
           page.locator("button[aria-label='Lossless (FLAC)']").count() == 1)
        page.click("button[aria-label='Lossless (FLAC)']")
        page.wait_for_timeout(400)
        chosen = calls("set_cloud_format")
        ok("the choice reaches Python", chosen and chosen[-1]["args"][0] == "flac")
        page.click("text=Send saved takes automatically")
        page.wait_for_timeout(300)
        switched = calls("set_auto_publish")
        ok("the automatic switch reaches Python",
           bool(switched) and switched[-1]["args"][0] is True)
        page.click("text=The original tracks")
        page.wait_for_timeout(300)
        chosen_what = calls("set_auto_publish")
        ok("what to publish reaches Python",
           chosen_what and chosen_what[-1]["args"][1] == "tracks")
        page.screenshot(path=str(SHOTS / "56-settings.png"))
        page.get_by_role("button", name="Appearance", exact=True).first.click()
        page.wait_for_selector("text=Scale")
        page.click("text=Light")
        page.wait_for_timeout(300)
        ok("the light theme applied",
           not page.evaluate("() => document.documentElement.classList.contains('dark')"))
        page.click("button[aria-label='Scale 130 percent']")
        page.wait_for_timeout(300)
        ok("the scale applied",
           page.evaluate("() => getComputedStyle(document.documentElement).fontSize") == "20.8px")
        ok("appearance was saved", len(calls("save_appearance")) >= 2)
        page.screenshot(path=str(SHOTS / "55-settings-light.png"))
        page.close()

        # ---------- 11. appearance survives a restart ----------
        print("\n[12d] On a machine with no Trash the wording changes")
        # Windows without send2trash: deleting moves things to a _deleted
        # folder. Promising "the Trash" there would be a plain lie.
        win = browser.new_page(viewport={"width": 1180, "height": 820})
        win.add_init_script(
            """window.__TRASH_KIND__ = 'folder';
               window.__NO_ENCODER__ = true;
               window.__HOST_API__ = 'Windows WASAPI';
               window.__PATH_WARNING__ = "This folder's path is already 214 characters.";
               // No cloud folder here, and automatic publishing on anyway:
               // the state a config left behind by an older version can be in.
               window.__AUTO_PUBLISH__ = {on:true, what:'mix'};"""
            + MOCK
        )
        win.goto(server.base_url, wait_until="networkidle")
        win.wait_for_selector("text=Start rehearsal")
        win.click("text=History")
        win.wait_for_selector("text=Tuesday jam")
        win.click("button[aria-label='Delete rehearsal Tuesday jam']")
        win.wait_for_selector("text=_deleted folder")
        ok("it names the folder instead of the Trash", True)
        ok("and does not mention a Trash at all",
           win.locator("text=goes to the Trash").count() == 0)
        ok("while still promising nothing is destroyed",
           win.locator("text=Nothing is destroyed").count() == 1)
        win.get_by_role("button", name="Cancel").click()

        win.click("button[aria-label='Back']")
        win.wait_for_selector("text=Start rehearsal")
        win.click("button[aria-label='Settings']")
        win.wait_for_selector("#input-device")
        ok("the audio system is shown next to the card",
           win.locator("text=Windows WASAPI").count() > 0)
        # Somebody who knows their desk has sixteen inputs and is offered
        # eight has no way to guess that the other rows with the same name
        # are the same desk seen through another system.
        ok("and a card listed twice says why one entry may look smaller",
           win.locator(
               "text=they do not all offer the same number of inputs"
           ).count() == 1)

        win.get_by_role("button", name="Folders", exact=True).first.click()
        win.wait_for_selector("#recordings-dir")
        ok("the long-path warning is shown",
           win.locator("text=214 characters").count() == 1)

        # Nothing here offers to publish automatically while there is nowhere
        # to publish to — every take would only collect "No cloud folder
        # chosen". The three choices turn the setting on as well, so greying
        # out the checkbox alone leaves the way in wide open.
        ok("publishing automatically is not on offer without a cloud folder",
           win.locator("#auto-publish").is_disabled())
        ok("and neither is choosing what it would send",
           all(win.get_by_role("button", name=label, exact=True).is_disabled()
               for label in ("The mix", "The original tracks", "Both")))
        win.get_by_role("button", name="Compressed (MP3)").click()
        win.wait_for_timeout(300)
        ok("and compression says why it cannot work here",
           win.locator("text=soundfile package is missing").count() == 1)
        win.screenshot(path=str(SHOTS / "57-windows-shaped.png"))
        win.close()

        print("\n[13] Appearance is applied before Python answers")
        ctx = browser.new_context(viewport={"width": 1180, "height": 820})
        warm = ctx.new_page()
        warm.add_init_script(MOCK)
        warm.goto(server.base_url, wait_until="networkidle")
        warm.wait_for_selector("text=Start rehearsal")
        warm.click("button[aria-label='Settings']")
        warm.get_by_role("button", name="Appearance", exact=True).first.click()
        warm.wait_for_selector("text=Scale")
        warm.click("text=Light")
        warm.wait_for_timeout(300)

        page2 = ctx.new_page()
        page2.add_init_script(
            MOCK
            + """
            const real = window.pywebview.api.get_settings;
            window.pywebview.api.get_settings = async () => {
              await new Promise(r => setTimeout(r, 600));
              return real();
            };
            """
        )
        page2.goto(server.base_url, wait_until="domcontentloaded")
        early = page2.evaluate(
            "() => document.documentElement.classList.contains('dark')"
        )
        ok("light theme is up before Python answers", not early)
        page2.wait_for_selector("text=Start rehearsal", timeout=10000)
        late = page2.evaluate(
            "() => document.documentElement.classList.contains('dark')"
        )
        ok("and nothing resets afterwards", late == early)

        browser.close()

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("Interface: screens render, the flow works, no console errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
