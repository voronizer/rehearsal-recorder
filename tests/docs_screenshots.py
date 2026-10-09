"""
The pictures in the README and docs/using-it.md.

They are taken of the built interface against the faked Python side the
interface's tests use (ui/e2e/fake-bridge.js), with a band of four on an
XR18 and a song for them to play. The fake's own waveform is one sine curve,
the same on every track: enough to check that a waveform is drawn, and
nothing like what a band sounds like. Needs Playwright for Python.

The two MIDI pictures lay the drummer on Both, from the e-kit "TD-17", over
that band (KIT_ON_BOTH): the band itself, ui/e2e/band.js, stays four audio
tracks.

    python tests/docs_screenshots.py

writes docs/screenshots/*.png. It checks nothing and is not part of
run_all.py. Run it after changing anything the pictures show, and look at
them before committing.
"""

import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT / "src"))

from rehearsal_recorder.mediaserver import AppServer  # noqa: E402

UI_DIST = PROJECT / "ui" / "dist"
# The faked Python side the interface's tests run against, which the band
# below is laid over.
MOCK = (PROJECT / "ui" / "e2e" / "fake-bridge.js").read_text(encoding="utf-8")
# The pictures show Windows, paths and all, whatever machine takes them: on a
# Mac the interface would write ⌘ for Ctrl, and zoom only with ⌘ held.
MOCK = "Object.defineProperty(Navigator.prototype, 'platform', {get: () => 'Win32'});\n" + MOCK


def drag_region(page, from_ratio, to_ratio):
    """Draw a region across the timeline, the way a person does."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * from_ratio, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * to_ratio, y, steps=10)
    page.mouse.up()
    page.wait_for_timeout(250)

OUT = PROJECT / "docs" / "screenshots"
VIEWPORT = {"width": 1180, "height": 820}

# Runs after MOCK, in the same page: MOCK's top-level `let`s — session,
# recording, cloudDir and the rest — are shared by every script on the page,
# so they are set here directly, and the calls that decide what is on screen
# are replaced on the bridge MOCK made.
BAND = (PROJECT / "ui" / "e2e" / "band.js").read_text(encoding="utf-8")

# Settings › Marks and History's Marks view count every mark in the
# library, in how many rehearsals and the newest; the fake counts tonight's
# too. So the counts are the band's: the marks on its rehearsals.
COUNTED = """
const labelsOf = api.list_labels;
api.list_labels = async () => {
  const marks = Object.keys(PAST).flatMap(f =>
    pastTakes(f).flatMap(t => t.markers.map(m => ({...m, folder: f, created_at: PAST[f][1]}))));
  return (await labelsOf()).map(l => {
    const mine = marks.filter(m => m.label_id === l.id);
    const days = mine.map(m => m.created_at).sort();
    return {...l, marks: mine.length, rehearsals: new Set(mine.map(m => m.folder)).size,
            last_marked: days.length ? days[days.length - 1] : null};
  });
};
"""

# The band's last rehearsal was played by its set, so History has the card
# of what was played and what was not: Dym and Ptuška were not.
PLAYED_BY = """window.__PLAYED_BY__ = {'/rec/tue': {name: 'Gig on the 25th',
  songs: ['Pałyn', 'Viasna', 'Ahoń', 'Sonca', 'Dym', 'Ptuška']}};"""

# An unsaved take waiting at startup: set before MOCK, which reads it once.
DRAFTS = """window.__DRAFTS__ = [{dir:'/rec/tue/_drafts/take 6', name:'take 6',
  tracks:['Drums','Bass','Guitar','Vocals'], duration_sec:214,
  rehearsal_folder:'/rec/tue', rehearsal_name:'Tuesday jam',
  created_at:'2026-09-22T19:00:00'}];"""


# The drummer on Both, from the e-kit "TD-17", laid over the band for the two
# MIDI pictures only. It runs after BAND, in the same page, so it sets what
# band.js made: the setup screen's tracks, and the notes of take 2 (Pałyn 2),
# the take the player opens. The fake's own kit plays one pattern whatever the
# song; here the kit plays this one, as the drums on the waveform do: kick and
# snare on the beats, hi-hat on the eighths, the ride in the choruses, toms in
# the bridge and a crash on the one of every part. Notes are as take_notes
# sends them: [start, length, row, velocity], the row counted from Crash.
KIT_ON_BOTH = """
{
  api.load_default_tracks = async () => ({tracks: PARTS.map(p => ({...p, stereo: false,
    ...(p.name === 'Drums' ? {mode: 'both', midi_port: {name: 'TD-17'}} : {})}))});

  const ROW = {crash: 0, ride: 1, hat: 2, toms: 3, snare: 4, kick: 5};
  const kitPlays = (end) => {
    const notes = [];
    const hit = (t, row, velocity) => {
      if (t >= end) return;
      const vel = Math.round(Math.min(127, velocity * (0.88 + 0.12 * hash(t * 7))));
      notes.push([t, Math.min(0.1, end - t), ROW[row], vel]);
    };
    for (let c = 0; c < 4; c++) hit(START - (4 - c) * BEAT, 'snare', 70);
    let at = START;
    for (const [kind, bars] of FORM) {
      for (let b = 0; b < bars * 4; b++) {
        const t = at + b * BEAT, even = b % 2 === 0;
        if (kind === 'bridge') {
          hit(t, 'toms', even ? 112 : 88);
        } else {
          hit(t, even ? 'kick' : 'snare', 108);
          const wash = kind === 'chorus' || kind === 'outro';
          hit(t, wash ? 'ride' : 'hat', 84);
          hit(t + BEAT / 2, wash ? 'ride' : 'hat', 62);
        }
        if (b === 0) hit(t, 'crash', 120);
      }
      at += bars * 4 * BEAT;
    }
    return notes.sort((a, b) => a[0] - b[0]);
  };

  const take = EARLIER[1], file = '/rec/tue/2/Drums.mid';
  take.notes = [{name: 'Drums', port: 'TD-17', after: 'Drums', file}];
  take.notes_missing = [];
  fileDurations[file] = take.duration_sec;
  api.take_notes = async (files) => (files || []).map(({name, file}) => withIcon(file
    ? {name, drums: true, rows: [...KIT_ROWS], notes: kitPlays(SONG_END)}
    : {name, error: 'Notes file not found'}));
}
"""


# How tall the window is for each picture: tall enough for all four tracks
# where there is a player, and no taller than the screen needs elsewhere,
# so a picture is not half empty.
HEIGHT = {"unsaved-takes": 420, "setup": 910, "settings": 760, "marks": 420, "sets": 720,
          "rehearsal": 770,
          "recording": 720, "review": 1040, "player": 1040, "zoom": 1040,
          "history": 820, "history-songs": 940, "history-marks": 820,
          "midi-card": 910, "midi-player": 1140}


def shoot(page, name, clip=None):
    """`clip`, if given, says what to cut out once the window is its height."""
    OUT.mkdir(parents=True, exist_ok=True)
    page.set_viewport_size({"width": VIEWPORT["width"], "height": HEIGHT[name]})
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / f"{name}.png"), clip=clip(page) if clip else None)
    print(f"  {name}.png")


def around(locators, margin=6):
    """What to cut out: the rectangle that holds all of these, with a margin."""
    def clip(page):
        boxes = [loc.bounding_box() for loc in locators]
        left = min(b["x"] for b in boxes) - margin
        top = min(b["y"] for b in boxes) - margin
        right = max(b["x"] + b["width"] for b in boxes) + margin
        bottom = max(b["y"] + b["height"] for b in boxes) + margin
        return {"x": left, "y": top, "width": right - left, "height": bottom - top}
    return clip


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


def scroll_to(page, start):
    """Move along a zoomed timeline until its window starts about `start` seconds in."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    for _ in range(6):
        # "1:55 – 2:07", beside Whole take.
        text = page.get_by_text(re.compile(r"^\d+:\d\d\s*[\u2013\u2014-]\s*\d+:\d\d$")).first.inner_text()
        a_min, a_sec, b_min, b_sec = map(int, re.findall(r"\d+", text))
        a, b = a_min * 60 + a_sec, b_min * 60 + b_sec
        if abs(a - start) < 1:
            return
        # A sideways wheel moves by its share of the window.
        page.mouse.wheel((start - a) / (b - a) * box["width"], 0)
        page.wait_for_timeout(250)


def main():
    if not (UI_DIST / "index.html").exists():
        print("The interface is not built: cd ui && npm run build")
        return 1
    server = AppServer(UI_DIST, Path(tempfile.mkdtemp()) / "rec")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(DRAFTS + MOCK + BAND + COUNTED)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Unsaved takes found")
        shoot(page, "unsaved-takes")
        page.close()

        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(MOCK + BAND + COUNTED)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.fill("#rehearsal-name", "Tuesday jam")
        # The rehearsal is played by the band's set, beside Start.
        page.click("[data-set-picker]")
        page.get_by_role("menuitemradio", name="Gig on the 25th").click()
        page.click("text=Check signal")
        page.wait_for_timeout(1500)
        shoot(page, "setup")
        page.click("text=Stop checking")

        page.get_by_role("button", name="Settings").click()
        page.wait_for_selector("text=Playback output")
        page.wait_for_timeout(500)
        shoot(page, "settings")
        page.get_by_role("button", name="Marks", exact=True).first.click()
        page.wait_for_selector("text=What a moment in a take can be marked with")
        page.wait_for_timeout(400)
        shoot(page, "marks")
        page.get_by_role("button", name="Sets", exact=True).first.click()
        page.wait_for_selector("[data-set-detail]")
        page.wait_for_timeout(400)
        shoot(page, "sets")
        page.keyboard.press("Escape")
        page.wait_for_selector("text=Start rehearsal")
        # The setup screen starts again from the date when it comes back.
        page.fill("#rehearsal-name", "Tuesday jam")

        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 6")
        page.wait_for_timeout(500)
        shoot(page, "rehearsal")

        page.click("text=Record take 6")
        page.wait_for_selector("text=Stop")
        page.wait_for_timeout(3200)
        shoot(page, "recording")

        page.click("text=Stop")
        page.wait_for_selector("[data-take-summary]")
        page.wait_for_timeout(1200)
        shoot(page, "review")
        page.get_by_role("button", name="Save take").click()
        page.wait_for_selector("text=Record take 7")

        page.click("button[aria-label^='Take 2 Pałyn 2']")
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
        page.add_init_script(PLAYED_BY + MOCK + BAND + COUNTED)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.click("text=History")
        page.wait_for_selector("text=New songs")
        page.wait_for_timeout(400)
        shoot(page, "history")
        page.get_by_role("button", name="Songs", exact=True).click()
        page.click('[data-song="Pałyn"]')
        page.wait_for_selector('[data-rung][aria-expanded="true"]')
        page.wait_for_timeout(400)
        shoot(page, "history-songs")
        page.get_by_role("button", name="Marks", exact=True).click()
        page.locator("button[data-label]", has=page.locator("[data-name]", has_text="Went wrong")).click()
        page.wait_for_selector('section[aria-label="Went wrong"] [data-mark]')
        page.wait_for_timeout(400)
        shoot(page, "history-marks")
        page.close()

        # The drummer on Both: the setup screen's card while the kit is
        # checked, and the player with the kit's notes under its audio.
        page = browser.new_page(viewport=VIEWPORT)
        page.add_init_script(MOCK + BAND + COUNTED + KIT_ON_BOTH)
        page.goto(server.base_url, wait_until="networkidle")
        page.wait_for_selector("text=Start rehearsal")
        page.fill("#rehearsal-name", "Tuesday jam")
        page.click("text=Check signal")
        page.wait_for_selector("text=✓ notes")
        page.wait_for_timeout(600)
        cards = page.locator("[data-track-card]")
        shoot(page, "midi-card", around([cards.nth(0), cards.nth(1)]))
        page.click("text=Stop checking")

        page.click("[data-set-picker]")
        page.get_by_role("menuitemradio", name="Gig on the 25th").click()
        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 6")
        page.click("button[aria-label^='Take 2 Pałyn 2']")
        page.wait_for_selector("[aria-label='Take timeline']")
        page.wait_for_selector("[data-notes-lane='Drums']")
        page.wait_for_timeout(800)
        # Zoomed to where the bridge ends and the last chorus comes in, so
        # each hit shows, and the part played is drawn as played.
        zoom_to(page, chorus / length, 12)
        scroll_to(page, chorus - 3.5)
        box = page.get_by_role("group", name="Take timeline").bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.66, box["y"] + box["height"] / 2)
        page.wait_for_timeout(600)
        shoot(page, "midi-player")
        page.close()

        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
