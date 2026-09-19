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
let autoPublish = {on:false, what:'mix'};
let recording = {device_index: 0, samplerate: 44100, bit_depth: 24};

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
function playerState() {
  if (!P) return {open:false};
  return {open:true, ok:true, playing:P.playing, position:position(), duration:P.duration,
          loop:P.loop, muted:P.muted, soloed:P.soloed, volumes:P.volumes};
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
  list_input_devices: async () => ([
    {index:0, name:'Universal Audio Thunderbolt', host_api: window.__HOST_API__ || '',
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
  session_state: async () => session
    ? {active:true, name:session.name, folder:session.folder, tracks:session.tracks,
       takes:session.takes, next_take_number:takeCounter + 1, next_take_name:suggestName(),
       recording:false}
    : {active:false},
  finish_rehearsal: async () => {
    const r = {ok:true, folder:session.folder, take_count:session.takes.length};
    session = null;
    return r;
  },

  start_take: track('start_take', async () => { takeCounter += 1; return {ok:true, take_number:takeCounter}; }),
  get_levels: async () => ({'Guitar':0.99, 'Vocals':0.005}),
  stop_take: async () => ({ok:true, take_number:takeCounter, temp_dir:'/tmp/draft',
    duration_sec:TAKE, suggested_name:suggestName(takeCounter),
    tracks:[{name:'Guitar', file:'/rec/g.wav'}, {name:'Vocals', file:'/rec/v.wav'}]}),
  keep_take: track('keep_take', async (n, _t, name, dur, tracks, markers) => {
    const take = {take_number:n, name:name || ('Take ' + n), duration_sec:dur,
                  tracks, markers: markers || []};
    session.takes.push(take);
    return {ok:true, take};
  }),
  discard_take: track('discard_take', async () => ({ok:true})),

  take_media: async (tracks) => tracks.map(t => ({
    name:t.name, url:'about:blank', frames:48000*TAKE, samplerate:48000, duration_sec:TAKE,
    peaks: Array.from({length:300}, (_, i) => Math.abs(Math.sin(i / 9)) * 0.9)})),

  player_open: track('player_open', async (tracks) => {
    P = {playing:false, position:0, t0:clock(), duration:TAKE, loop:null, muted:[], soloed:null,
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
    return {ok:true, markers: take ? take.markers : []};
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
    return {ok:true, take};
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
     take_count:2, total_duration_sec:12}]),
  get_rehearsal: async (folder) => ({ok:true, folder, name:'Tuesday jam',
    created_at:'2026-09-10T19:00:00',
    takes:[{take_number:1, name:'Polyn', duration_sec:TAKE, markers:[],
            tracks:[{name:'Guitar', file:'/rec/g.wav'}]}]}),
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
    return {ok:true, take, cloud:shared};
  }),
  unshare_take: track('unshare_take', async (folder, n) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (take) take.cloud = {};
    return {ok:true, removed:[], trashed:true};
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
    server_url:'http://127.0.0.1:1234/', config_path:'/Users/alex/.rehearsal-recorder/config.json'}),
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

        # Everywhere else in the app space runs the screen's main action, and
        # here that action is saving the take.
        page.fill("#take-name", "Polyn")
        page.locator("#take-name").blur()
        page.keyboard.press("Space")
        page.wait_for_timeout(600)
        ok("space saves the take", len(calls("keep_take")) == 1)

        page.wait_for_selector("text=Record take 2")
        page.click("text=Record take 2")
        page.wait_for_selector("text=Stop")
        page.click("text=Stop")
        page.wait_for_selector("#take-name")
        ok("the next take inherits the name",
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
        page.click("text=Polyn 2")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)

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
        page.evaluate("() => { window.__OUTPUT_GONE__ = true }")
        page.click("text=Polyn 2")   # close
        page.wait_for_timeout(200)
        page.click("text=Polyn 2")   # and open again
        page.wait_for_selector("text=using the system output", timeout=8000)
        ok("it says where the sound went", True)
        ok("and the take still opened",
           page.locator("button[aria-label='Mute Guitar']").count() == 1)
        page.evaluate("() => { window.__OUTPUT_GONE__ = false }")

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

        ok("renaming does not close the player",
           page.locator("button[aria-label='Repeat']").count() == 1)

        print("\n[9] Repeat, mix and history")
        page.click("button[aria-label='Repeat']")
        page.wait_for_timeout(300)
        loop = calls("player_set_loop")
        ok("repeat covers the whole take",
           loop and loop[-1]["args"] == [0, TAKE_SECONDS])
        page.click("button[aria-label='Mute Guitar']")
        page.click("button[aria-label='Solo Vocals']")
        page.wait_for_timeout(300)
        ok("mute reached Python", calls("player_set_muted")[-1]["args"] == ["Guitar", True])
        ok("solo reached Python", calls("player_set_solo")[-1]["args"] == ["Vocals"])
        page.screenshot(path=str(SHOTS / "54-player.png"))

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
        page.click("text=Finish")
        page.wait_for_selector("text=Rehearsal finished")
        page.click("text=History")
        page.wait_for_selector("text=Tuesday jam")
        page.click("button[aria-label='Delete rehearsal Tuesday jam']")
        page.wait_for_selector("text=goes to the Trash")
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

        print("\n[12a] Settings is grouped, not one long column")
        ok("it opens on Audio", page.locator("#input-device").count() == 1)
        ok("and folders are not on that page",
           page.locator("#recordings-dir").count() == 0)
        ok("every group is reachable",
           all(page.get_by_role("button", name=name, exact=True).count() >= 1
               for name in ("Audio", "Folders", "Appearance", "Under the hood")))
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
               window.__PATH_WARNING__ = "This folder's path is already 214 characters.";"""
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

        win.get_by_role("button", name="Folders", exact=True).first.click()
        win.wait_for_selector("#recordings-dir")
        ok("the long-path warning is shown",
           win.locator("text=214 characters").count() == 1)
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
