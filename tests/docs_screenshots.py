"""
The pictures in the README and docs/using-it.md.

They are taken of the built interface against the interface suite's mocked
bridge (tests/test_interface.py), with a band of four on an XR18 and a song
for them to play. The suite's own waveform is one sine curve, the same on
every track: enough to check that a waveform is drawn, and nothing like what
a band sounds like.

    python tests/docs_screenshots.py

writes docs/screenshots/*.png. It checks nothing and is not part of
run_all.py. Run it after changing anything the pictures show, and look at
them before committing.
"""

import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_interface import MOCK, PROJECT, UI_DIST, drag_region  # noqa: E402

from rehearsal_recorder.mediaserver import AppServer  # noqa: E402

OUT = PROJECT / "docs" / "screenshots"
VIEWPORT = {"width": 1180, "height": 820}

# Runs after MOCK, in the same page: MOCK's top-level `let`s — session,
# recording, cloudDir and the rest — are shared by every script on the page,
# so they are set here directly, and the calls that decide what is on screen
# are replaced on the bridge MOCK made.
BAND = r"""
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
const PARTS = [{name: 'Drums', channel: 1}, {name: 'Bass', channel: 2},
               {name: 'Guitar', channel: 3}, {name: 'Vocals', channel: 4}];

// ---- The takes ---------------------------------------------------------
// seed makes each take a little different; end is where the song stopped,
// a take that broke down stopping early.
const KIND = {};
function takeOf(n, name, length, end, markers) {
  const tracks = PARTS.map(p => ({name: p.name, file: `/rec/tue/${n}/${p.name}.wav`}));
  for (const tr of tracks) {
    KIND[tr.file] = {part: tr.name, seed: n, end};
    fileDurations[tr.file] = length;
  }
  return {take_number: n, name, duration_sec: length, tracks, markers};
}
const SECTION = name => {
  let at = START;
  for (const [kind, bars] of FORM) { if (kind === name) return at; at += bars * BAR; }
};
const EARLIER = [
  takeOf(1, 'Polyn', 58, 51, [{at: 50, note: 'lost the count', kind: 'issue'}]),
  takeOf(2, 'Polyn 2', Math.round(SONG_END + 4), SONG_END, [
    {at: 50.5, note: 'chorus came in early', kind: 'issue'},
    {at: 112, note: 'bridge — try it slower', kind: 'redo'},
    {at: 131, note: 'this one is the take', kind: 'good'}]),
  takeOf(3, 'Vesna', 141, 137, []),
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

api.start_rehearsal = async (name) => {
  session = {name, folder: `C:\\Users\\alex\\RehearsalRecordings\\${name} - 2026-09-22 19-00`,
             tracks: PARTS,
             takes: JSON.parse(JSON.stringify(EARLIER))};
  takeCounter = EARLIER.length;
  return {ok: true, folder: session.folder};
};
api.stop_take = async () => {
  const draft = takeOf(takeCounter, 'draft', 151, 147, []);
  return {ok: true, take_number: takeCounter, temp_dir: '/rec/tue/_drafts',
          duration_sec: 151, suggested_name: suggestName(takeCounter), tracks: draft.tracks};
};
api.take_media = async (tracks, buckets, from, to) => tracks.map(t => {
  const dur = fileDurations[t.file] ?? 6;
  const a = from ?? 0, b = to ?? dur;
  return {name: t.name, url: 'about:blank', frames: 48000 * dur, samplerate: 48000,
          duration_sec: dur, peaks: [peaksOf(t.file, buckets || 900, a, b)]};
});

api.list_rehearsals = async () => [
  {folder: '/rec/tue', name: 'Tuesday jam', created_at: '2026-09-22T19:00:00',
   take_count: 11, total_duration_sec: 2710, disk_bytes: 1560000000,
   songs: [{name: 'Polyn', takes: 4}, {name: 'Vesna', takes: 3},
           {name: 'Ogon', takes: 2}, {name: 'Sonce', takes: 1}]},
  {folder: '/rec/sat', name: 'New songs', created_at: '2026-09-19T15:00:00',
   take_count: 7, total_duration_sec: 1860, disk_bytes: 1070000000,
   songs: [{name: 'Dym', takes: 4}, {name: 'Ptaha', takes: 3}]},
  {folder: '/rec/tue-before', name: 'Tuesday jam', created_at: '2026-09-15T19:00:00',
   take_count: 9, total_duration_sec: 2280, disk_bytes: 1310000000,
   songs: [{name: 'Polyn', takes: 3}, {name: 'Vesna', takes: 2}, {name: 'Ogon', takes: 2},
           {name: 'Sonce', takes: 1}, {name: 'Dym', takes: 1}]},
  {folder: '/rec/soundcheck', name: 'Soundcheck', created_at: '2026-09-12T18:30:00',
   take_count: 2, total_duration_sec: 300, disk_bytes: 173000000, songs: []}];

const settings = api.get_settings;
api.get_settings = async () => ({...(await settings()),
  recordings_dir: 'C:\\Users\\alex\\RehearsalRecordings',
  default_recordings_dir: 'C:\\Users\\alex\\RehearsalRecordings',
  config_path: 'C:\\Users\\alex\\.rehearsal-recorder\\config.json',
  version: '0.7.8'});
"""

# An unsaved take waiting at startup: set before MOCK, which reads it once.
DRAFTS = """window.__DRAFTS__ = [{dir:'/rec/tue/_drafts/take 5', name:'take 5',
  tracks:['Drums','Bass','Guitar','Vocals'], duration_sec:214,
  rehearsal_folder:'/rec/tue', rehearsal_name:'Tuesday jam',
  created_at:'2026-09-22T19:00:00'}];"""


# How tall the window is for each picture: tall enough for all four tracks
# where there is a player, and no taller than the screen needs elsewhere,
# so a picture is not half empty.
HEIGHT = {"unsaved-takes": 420, "setup": 720, "settings": 760, "rehearsal": 770,
          "recording": 720, "review": 1235, "player": 1235, "zoom": 1235,
          "history": 520}


def shoot(page, name):
    OUT.mkdir(parents=True, exist_ok=True)
    page.set_viewport_size({"width": VIEWPORT["width"], "height": HEIGHT[name]})
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / f"{name}.png"))
    print(f"  {name}.png")


def zoom_to(page, ratio, seconds):
    """Wheel in over `ratio` of the timeline until at most `seconds` show."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    page.mouse.move(box["x"] + box["width"] * ratio, box["y"] + box["height"] / 2)
    clock = page.get_by_role("group", name="Timeline clock")
    for _ in range(30):
        times = []
        for text in clock.locator("span.tnum").all_inner_texts():
            minutes, secs = text.strip().split(":")
            times.append(int(minutes) * 60 + int(secs))
        if len(times) > 1 and (times[-1] - times[0]) * len(times) / (len(times) - 1) <= seconds:
            return
        # Ctrl and the wheel zoom: the wheel on its own scrolls the page.
        page.keyboard.down("Control")
        page.mouse.wheel(0, -120)
        page.keyboard.up("Control")
        page.wait_for_timeout(250)


def main():
    if not (UI_DIST / "index.html").exists():
        print("The interface is not built: cd ui && npm run build")
        return 1
    server = AppServer(UI_DIST, Path(tempfile.mkdtemp()) / "rec")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(DRAFTS + MOCK + BAND)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Unsaved takes found")
        shoot(page, "unsaved-takes")
        page.close()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(MOCK + BAND)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.fill("#rehearsal-name", "Tuesday jam")
        page.click("text=Check signal")
        page.wait_for_timeout(1500)
        shoot(page, "setup")
        page.click("text=Stop checking")

        page.get_by_role("button", name="Settings").click()
        page.wait_for_selector("text=Playback output")
        page.wait_for_timeout(500)
        shoot(page, "settings")
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Start rehearsal")
        # The setup screen starts again from the date when it comes back.
        page.fill("#rehearsal-name", "Tuesday jam")

        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 4")
        page.wait_for_timeout(500)
        shoot(page, "rehearsal")

        page.click("text=Record take 4")
        page.wait_for_selector("text=Stop")
        page.wait_for_timeout(3200)
        shoot(page, "recording")

        page.click("text=Stop")
        page.wait_for_selector("#take-name")
        page.wait_for_timeout(1200)
        shoot(page, "review")
        page.get_by_role("button", name="Save take").click()
        page.wait_for_selector("text=Record take 5")

        page.click("button[aria-label^='Take 2 Polyn 2']")
        page.wait_for_selector("[aria-label='Take timeline']")
        page.wait_for_timeout(800)
        song = page.evaluate(
            "() => ({length: window.__SONG__.length(2), bridge: window.__SONG__.bridge,"
            " bar: window.__SONG__.bar})")
        length, bridge = song["length"], song["bridge"]
        chorus = bridge + 8 * song["bar"]
        drag_region(page, bridge / length, chorus / length)
        page.get_by_role("button", name="Repeat").click()
        page.click("button[aria-label='Play']")
        page.wait_for_timeout(1500)
        shoot(page, "player")

        page.click("button[aria-label='Pause']")
        page.get_by_role("button", name="Clear").click()
        page.get_by_role("button", name="Repeat").click()
        zoom_to(page, chorus / length, 12)
        # A press that does not travel seeks: into the window, so what has
        # been played is drawn as played.
        box = page.get_by_role("group", name="Take timeline").bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.66, box["y"] + box["height"] / 2)
        page.wait_for_timeout(600)
        shoot(page, "zoom")
        page.close()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(MOCK + BAND)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.click("text=History")
        page.wait_for_selector("text=New songs")
        page.wait_for_timeout(400)
        shoot(page, "history")
        page.close()

        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
