"""
The built interface in a headless browser, against a mocked Python bridge.

What matters here is not "does it look nice" but that the build is alive: the
screens render, the flow works, the interface drives Python correctly and
nothing throws. The audio itself is checked by verify_engine.py, where every
sample is visible.
"""

import json
import os
import re
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


def escape_closes(page, text):
    """Press Escape and wait for that dialog to actually be gone.

    Radix fades a dialog out, so one that has already been closed stays in
    the DOM for as long as the animation runs. A check that sleeps a couple
    of hundred milliseconds first is therefore a check on how loaded the
    machine is: it passed on every developer's Mac and failed on the runner,
    which is how [7c] flaked on 0.5.0 and how the key list failed the 0.7.0
    build. Waiting for the thing itself cannot be tuned wrong.

    What each caller is really watching for — an Escape that went further
    than the dialog — needs no waiting at all: it opens its own dialog, or
    calls into Python, on the same keydown. By the time this returns, that
    would already have happened.
    """
    page.keyboard.press("Escape")
    page.wait_for_selector(f"text={text}", state="detached")


# The mocked Python bridge. It lives in ui/e2e/fake-bridge.js, where the
# TypeScript suites load it too; this one reads the same file while its
# sections are moved over to them. Its takes are TAKE seconds long, which is
# TAKE_SECONDS here.
MOCK = (PROJECT / "ui" / "e2e" / "fake-bridge.js").read_text(encoding="utf-8")


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

    def key_on(page, selector):
        """The key shown on a button, or None when it shows none."""
        found = page.locator(f"{selector} :is(kbd, [data-key])")
        return found.first.inner_text().strip() if found.count() else None

    def text_of(found):
        """What an element says, or None when it is not on the page — so a
        check fails rather than waiting half a minute and ending the run."""
        return found.first.inner_text().strip() if found.count() else None

    def attr_of(found, name):
        """The same for one of its attributes."""
        return found.first.get_attribute(name) if found.count() else None

    with sync_playwright() as p:
        browser = p.chromium.launch()

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
        # The one screen that says the app's name says it with the logo; the
        # working screens after it carry neither.
        ok("the setup screen's header has the logo beside the app's name",
           page.evaluate("""() => {
             const h = document.querySelector('header h1');
             const img = h && h.querySelector('img[src$="favicon.svg"]');
             return !!img && img.complete && img.naturalWidth > 0
               && h.textContent.trim() === 'Rehearsal Recorder';
           }"""))
        ok("template filled the tracks in",
           page.input_value("input[aria-label='Track 1 name']") == "Guitar")
        ok("free space is always on screen",
           page.locator("text=Room for").count() > 0)
        # The mock's disk lasts for weeks: past two days the estimate is
        # "many hours", which "about" does not go in front of.
        ok("and a disk that lasts for days says many hours, without an about",
           page.get_by_text("Room for many hours of recording", exact=True).count() == 1)
        page.click("text=Check signal")
        page.wait_for_timeout(600)
        ok("the monitor started", len(calls("start_monitor")) == 1)
        ok("levels are polled", len(calls("monitor_levels")) > 2)
        ok("one input shows signal", page.locator("text=signal").count() > 0)
        ok("the other shows silence", page.locator("text=silent").count() > 0)
        # In dB, like the recording screen and the desk: −4 dBFS is most of
        # the bar. On a straight scale it was three fifths of it, and −18,
        # where a band sets its gain, an eighth.
        guitar_reach = """() => {
          const m = document.querySelector("[data-meter='Guitar']");
          const bar = m && m.firstElementChild;
          return m && bar
            ? bar.getBoundingClientRect().width / m.getBoundingClientRect().width
            : 0;
        }"""
        reach = page.evaluate(guitar_reach)
        ok("the check's bar is drawn in dB: -4 dBFS fills nine tenths of it",
           0.88 < reach < 0.97)
        page.screenshot(path=str(SHOTS / "51-setup.png"))
        # A quiet input is not a dead one: with the gain set for the loudest
        # hit, whole passages sit around −48 dBFS.
        page.evaluate("() => { window.__MONITOR_LEVELS__ = "
                      "{'Guitar':[0.62], 'Vocals':[0.004]}; }")
        try:
            page.wait_for_function(
                "() => !document.body.innerText.includes('silent')", timeout=6000)
        except Exception:
            pass
        ok("an input playing quietly, at -48 dBFS, counts as signal",
           page.locator("text=silent").count() == 0)
        # A meter rises at once and falls back at a steady rate, as on the
        # desk. Dropping to each poll's level made a voice blink: in dB the
        # quiet between two syllables is half the bar.
        page.evaluate("() => { window.__MONITOR_LEVELS__ = "
                      "{'Guitar':[0.0004], 'Vocals':[0.004]}; }")
        polls = len(calls("monitor_levels"))
        try:
            page.wait_for_function(
                "() => window.__CALLS__.filter(c => c.name === 'monitor_levels')"
                f".length >= {polls + 2}", timeout=6000)
        except Exception:
            pass
        ok("the check's bar falls back, rather than dropping the moment the sound does",
           page.evaluate(guitar_reach) > 0.3)
        try:
            page.wait_for_function(f"() => ({guitar_reach})() < 0.05", timeout=8000)
        except Exception:
            pass
        ok("and is at the bottom within a few seconds",
           page.evaluate(guitar_reach) < 0.05)
        page.evaluate("() => { window.__MONITOR_LEVELS__ = null; }")
        ok("Start rehearsal carries its key",
           key_on(page, "button:has-text('Start rehearsal')") == "Space")
        page.click("text=Stop checking")

        # With no /api route on this server, the meters can only have been
        # fed over the bridge — which is the fallback doing its job.
        ok("polling falls back to the bridge when the server route is absent",
           len(calls("monitor_levels")) > 2)

        print("\n[5] Recording: status is visible, not only on failure")
        ok("the setup screen shows what it will record with",
           page.locator("text=44.1 kHz · 24 bit").count() == 1)
        # Clicked last, the check's button still has focus, as a clicked
        # button does in Chromium — the browser the app runs in on Windows.
        # Space used to press it again: the check started, not the rehearsal.
        ok("the check's button keeps focus after the mouse clicked it",
           "Check signal" in page.evaluate("document.activeElement.textContent"))
        monitors = len(calls("start_monitor"))
        page.keyboard.press("Space")
        try:
            page.wait_for_selector("text=Record take 1", timeout=4000)
        except Exception:
            pass
        ok("Space after clicking Check signal starts the rehearsal",
           len(calls("start_rehearsal")) == 1)
        ok("and does not start the check again",
           len(calls("start_monitor")) == monitors)
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
        ok("New rehearsal carries its key",
           key_on(page, "button:has-text('New rehearsal')") == "Space")
        page.click("text=New rehearsal")
        page.wait_for_selector("text=Start rehearsal")
        page.click("text=Start rehearsal")
        page.wait_for_selector("text=Record take 1")

        page.click("text=Record take 1")
        page.wait_for_selector("text=Recording")
        page.wait_for_timeout(2500)
        # Silent is said once an input has been quiet for a moment; wait for
        # that rather than trust the wait above on a runner that runs slow.
        try:
            page.wait_for_selector(
                "main [role=group][aria-label='Vocals'][data-silent]", timeout=6000)
        except Exception:
            pass
        ok("the status line is shown",
           page.locator("text=Interface connected").count() > 0)
        ok("and an estimate under two days keeps its about",
           page.get_by_text("Interface connected · room for about 10 h 40 min more",
                            exact=True).count() == 1)
        # The mock holds Guitar at the top the whole time: that is one clip
        # that has not ended, not one for every poll.
        ok("clipping is called out in one line, big enough to read from the kit",
           (text_of(page.get_by_role("status", name="Take status")) or "")
           == "Guitar clipped in the last minute")
        ok("and on the track that did it",
           attr_of(page.get_by_role("group", name="Guitar"), "data-clipped")
           is not None)
        ok("a silent input is called out",
           "silent" in (text_of(page.get_by_role("group", name="Vocals")) or ""))
        ok("the clock counts minutes, not hours nobody has played yet",
           re.fullmatch(r"0:0\d", (text_of(page.get_by_role("timer")) or ""))
           is not None)
        ok("a first take has nothing to be measured against",
           page.locator("text=last time").count() == 0)
        page.screenshot(path=str(SHOTS / "52-recording.png"))
        ok("Stop carries its key", key_on(page, "button:has-text('Stop')") == "Space")
        ok("and the autosave note stays, without it",
           page.get_by_text("autosaved every 30 s", exact=True).count() == 1)

        print("\n[6] Review: space saves, the name carries over")
        page.click("text=Stop")
        page.wait_for_selector("#take-name")
        ok("first take gets a number", page.input_value("#take-name") == "Take 1")
        # The keys are on the buttons they press, not in a line underneath.
        ok("Save take carries its key", key_on(page, "button:has-text('Save take')") == "Space")
        ok("and Discard the one that asks to throw it away",
           key_on(page, "button:has-text('Discard')") == "Esc")
        ok("the line under the buttons is gone",
           page.get_by_text("save take", exact=True).count() == 0)
        ok("with no cloud folder it says the take stays on this computer",
           page.locator("text=Stays on this computer").count() == 1
           and page.locator("#send-to-cloud").count() == 0)

        # Space no longer plays here, so the button is the way to listen.
        page.wait_for_selector("button[aria-label='Play']", timeout=8000)
        page.click("button[aria-label='Play']")
        page.wait_for_timeout(400)
        ok("the take can still be listened to before saving",
           len(calls("player_toggle")) == 1)
        page.click("button[aria-label='Pause']")

        # The transport stays as it was: a key drawn on each small button
        # was clutter however it was drawn. They are listed behind "?".
        ok("the transport draws no keys on its buttons",
           page.locator("[role='toolbar'][aria-label='Transport'] :is(kbd, [data-key])").count() == 0
           and page.locator("[role='toolbar'][aria-label='Transport']").count() == 1)
        # Repeat is part of how the take plays, so it sits with the playing,
        # by the time; Mark goes to the far end of the row.
        row = page.get_by_role("toolbar", name="Transport")
        repeat_at = row.get_by_role("button", name="Repeat").bounding_box()
        mark_at = row.locator(
            "button[aria-label='Add marker'], button[aria-label='Edit marker']").first.bounding_box()
        time_at = row.locator("span.tnum").first.bounding_box()
        ok("Repeat is beside the time, and Mark after it at the end of the row",
           bool(repeat_at and mark_at and time_at)
           and time_at["x"] < repeat_at["x"] < mark_at["x"])
        page.keyboard.press("?")
        page.wait_for_selector("text=Keys in the player")
        listed = page.get_by_role("dialog").inner_text()
        ok("? lists the player's keys",
           all(k in listed for k in ("Home", "To the start", "Mark", "Repeat", "10 seconds")))
        # The wheel is not a key, but it is the other thing nobody finds
        # without being told: on its own it scrolls, with Ctrl it zooms.
        ok("and the wheel: Ctrl to zoom, Shift to move along the take",
           "Ctrl + wheel" in listed and "Zoom in / out" in listed
           and "Shift + wheel" in listed)
        ok("without Space here, where Space saves the take",
           "Play / pause" not in listed)
        escape_closes(page, "Keys in the player")
        ok("and Escape closes the list, not the take",
           page.locator("text=Keys in the player").count() == 0
           and page.locator("text=Discard this take?").count() == 0)

        # The check above passes for the wrong reason as easily as the right
        # one. Radix closes the dialog on Escape without stopping the keydown,
        # so the app's own Escape runs too and decides whether to act by
        # looking at what has focus — which by then may be the dialog, or may
        # be the button that opened it, depending on when React got round to
        # unmounting. It held here and lost on CI, where Escape closed the
        # list and asked to throw the take away in the same press.
        #
        # Blurring first puts the losing side on screen every time: a dialog
        # open, focus outside it, Escape pressed. Whatever the app does with
        # Escape then, it cannot be reading focus to decide.
        page.keyboard.press("?")
        page.wait_for_selector("text=Keys in the player")
        page.evaluate("document.activeElement && document.activeElement.blur()")
        escape_closes(page, "Keys in the player")
        ok("with the list open and focus anywhere else, Escape is still the list's",
           page.locator("text=Keys in the player").count() == 0
           and page.locator("text=Discard this take?").count() == 0)

        # On a Mac the zoom is Cmd and the wheel, and the list says so, the
        # way the Mac's own menus write it.
        mac = browser.new_page(viewport={"width": 1180, "height": 820})
        mac.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        mac.add_init_script(
            "Object.defineProperty(navigator, 'platform', {get: () => 'MacIntel'});"
            + MOCK)
        mac.goto(server.base_url, wait_until="networkidle")
        mac.wait_for_selector("text=Start rehearsal")
        mac.click("text=Start rehearsal")
        mac.wait_for_selector("text=Record take 1")
        mac.click("text=Record take 1")
        mac.wait_for_selector("button:has-text('Stop')")
        mac.click("button:has-text('Stop')")
        mac.wait_for_selector("#take-name")
        mac.evaluate("document.activeElement && document.activeElement.blur()")
        mac.keyboard.press("?")
        mac.wait_for_selector("text=Keys in the player")
        on_mac = mac.get_by_role("dialog").inner_text()
        ok("on a Mac the list says Cmd for the zoom, not Ctrl",
           "⌘ + wheel" in on_mac and "Ctrl + wheel" not in on_mac)
        mac.close()

        page.keyboard.press("r")
        page.wait_for_timeout(150)
        ok("R turns repeat on",
           page.get_attribute("button[aria-label='Repeat']", "aria-pressed") == "true")
        page.keyboard.press("r")
        page.wait_for_timeout(150)
        ok("and off again",
           page.get_attribute("button[aria-label='Repeat']", "aria-pressed") == "false")

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
        # here that action is saving the take. Escape takes the name field's
        # keys back first — only that: this screen's Escape asks to throw the
        # take away, and a name just typed is no reason to be asked that.
        page.fill("#take-name", "Polyn")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        ok("Escape in the name field leaves it",
           page.evaluate("document.activeElement.id") != "take-name")
        ok("and does not ask to discard the take",
           page.locator("text=Discard this take?").count() == 0)
        ok("keeping what was typed", page.input_value("#take-name") == "Polyn")
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
        escape_closes(page, "Discard this take?")
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

        page.click("button[aria-label='Player keys']")
        page.wait_for_selector("text=Keys in the player")
        ok("the ? button lists Space here, where it plays",
           "Play / pause" in page.get_by_role("dialog").inner_text())
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        ok("and not on Record take",
           key_on(page, "button:has-text('Record take')") is None)
        ok("nor Escape on Finish — here it closes the take",
           key_on(page, "button:has-text('Finish')") is None)

        page.click("button[aria-label='Forward 10 seconds']")
        page.wait_for_timeout(200)
        page.keyboard.press("m")
        page.wait_for_timeout(400)
        marker_calls = calls("add_take_marker")
        ok("M drops a marker, and it went to Python", len(marker_calls) == 1)
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
        ok("a take that is not in the cloud says nothing about the cloud",
           "cloud" not in (text_of(page.get_by_role("dialog")) or "cloud"))

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

        escape_closes(page, "go to the Trash")
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
        ok("after which Space is back on Record take",
           key_on(page, "button:has-text('Record take')") == "Space")
        ok("and Escape is on Finish",
           key_on(page, "button:has-text('Finish')") == "Esc")

        # Played from its row, a take has Space until Escape puts it away.
        page.click("[aria-label='Rehearsal overview'] button[aria-label='Play Polyn 2']")
        page.wait_for_selector("button[aria-label='Pause Polyn 2']")
        ok("a take plays from its row, the overview still on screen",
           page.get_by_role("group", name="Take timeline").count() == 0)
        ok("and Space is its, not Record's",
           key_on(page, "button:has-text('Record take')") is None)
        page.keyboard.press("Escape")
        page.wait_for_selector("button[aria-label='Play Polyn 2']")
        ok("Escape puts it away, and gives Space back to Record",
           key_on(page, "button:has-text('Record take')") == "Space")

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
        # Clear and Crop are about the region, so they are on it. In the
        # transport they were far from the stretch they act on, two more
        # buttons in a row of them. Clear is a cross beside the region's
        # times, the way a tag is closed: a button that said Clear under
        # them read as clearing that part of the take. Beside it, the same
        # small kind of button loops the region, so the hand that drew it
        # need not go up to Repeat.
        transport = page.get_by_role("toolbar", name="Transport")
        ok("Clear and Crop are not in the transport",
           transport.get_by_role("button", name="Clear the loop region").count() == 0
           and transport.get_by_role("button", name="Crop to the region").count() == 0)
        chip_box = page.locator("[data-region-span]").bounding_box()
        clear = page.get_by_role("button", name="Clear the loop region")
        clear_box = clear.bounding_box()
        loop_here = page.get_by_role("button", name="Loop the region")
        loop_box = loop_here.bounding_box() if loop_here.count() else None
        crop_box = page.get_by_role("button", name="Crop to the region").bounding_box()

        def beside_the_times(b):
            return (b["x"] >= chip_box["x"] + chip_box["width"] - 1
                    and abs((b["y"] + b["height"] / 2)
                            - (chip_box["y"] + chip_box["height"] / 2)) < 4)
        ok("Clear is a cross beside the region's times",
           bool(chip_box and clear_box) and beside_the_times(clear_box)
           and (clear.inner_text() or "").strip() == "")
        ok("with a loop beside it, next to the times too",
           bool(loop_box) and beside_the_times(loop_box)
           and loop_box["x"] < clear_box["x"])
        ok("and Crop under the times",
           bool(crop_box) and crop_box["y"] >= chip_box["y"] + chip_box["height"] - 1
           and abs(crop_box["x"] - chip_box["x"]) < 2)
        # Whatever the tests before left Repeat at, a press turns it over and
        # a second puts it back.
        repeat = transport.get_by_role("button", name="Repeat")
        was = repeat.get_attribute("aria-pressed")
        turned = "false" if was == "true" else "true"
        if loop_box:
            loop_here.click()
            page.wait_for_timeout(250)
        ok("the loop beside the times is Repeat, a hand's width from the region",
           repeat.get_attribute("aria-pressed") == turned
           and loop_here.count() == 1 and loop_here.get_attribute("aria-pressed") == turned)
        if loop_box:
            loop_here.click()
            page.wait_for_timeout(250)
        ok("and a second press puts it back",
           bool(loop_box) and repeat.get_attribute("aria-pressed") == was)
        seeks = len(calls("player_seek"))
        page.get_by_role("button", name="Clear the loop region").click()
        page.wait_for_timeout(250)
        ok("clearing it takes the offer to clear with it",
           page.get_by_role("button", name="Clear the loop region").count() == 0)
        # They sit on the tracks, where a press starts a region and a click
        # seeks. A press on them must be theirs alone.
        ok("and pressing it neither moves the playhead nor starts a region",
           len(calls("player_seek")) == seeks
           and page.locator("[data-region-span]").count() == 0)

        drag(0.9, 0.99)
        surface_box = page.get_by_role("group", name="Take timeline").bounding_box()
        crop_box = page.get_by_role("button", name="Crop to the region").bounding_box()
        clear_box = page.get_by_role("button", name="Clear the loop region").bounding_box()
        ok("near the right edge they stay on the timeline rather than off its end",
           bool(crop_box and clear_box)
           and crop_box["x"] + crop_box["width"] <= surface_box["x"] + surface_box["width"]
           and clear_box["x"] + clear_box["width"] <= surface_box["x"] + surface_box["width"])
        page.get_by_role("button", name="Clear the loop region").click()
        page.wait_for_timeout(250)
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

        # Solo was clicked last and keeps focus. Space is the player's, not a
        # second press of whatever the mouse happened to touch.
        toggles = len(calls("player_toggle"))
        solos = len(calls("player_set_solo"))
        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        ok("Space after clicking a button plays, instead of pressing it again",
           len(calls("player_toggle")) == toggles + 1
           and len(calls("player_set_solo")) == solos)
        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        ok("and pauses again", len(calls("player_toggle")) == toggles + 2)
        # Reached with Tab, a button is what Space is aimed at: that is how a
        # keyboard presses one.
        page.focus("button[aria-label='Mute Guitar']")
        page.keyboard.press("Tab")
        ok("Tab moves on to the next button",
           page.evaluate("document.activeElement.getAttribute('aria-label')")
           == "Solo Guitar")
        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        ok("and Space presses a button reached with the keyboard",
           calls("player_set_solo")[-1]["args"] == ["Guitar"]
           and len(calls("player_toggle")) == toggles + 2)
        page.click("button[aria-label='Solo Vocals']")
        page.wait_for_timeout(300)

        print("\n[9b] One volume for the whole take")
        master = page.get_by_role("slider", name="Master volume", exact=True)
        ok("under the tracks is a master for the whole take, at full to begin with",
           master.input_value() == "1")
        ok("below the last of them",
           master.bounding_box()["y"]
           > page.get_by_role("slider", name="Vocals volume").bounding_box()["y"])
        mixes = len(calls("save_mix"))
        spot = master.bounding_box()
        page.mouse.click(spot["x"] + spot["width"] * 0.3,
                         spot["y"] + spot["height"] / 2)
        page.wait_for_timeout(300)
        turned = calls("player_set_master")
        ok("turned down, it reaches Python",
           turned and turned[-1]["args"][0] < 0.5)
        kept = calls("save_master_volume")
        ok("and is kept for the next take without being asked",
           kept and kept[-1]["args"][0] == turned[-1]["args"][0])
        ok("while the balance the cloud mix is made from is left alone",
           len(calls("save_mix")) == mixes)
        # A fader is an input, and every key used to go dead once one had
        # been touched.
        page.keyboard.press("Space")
        page.wait_for_timeout(600)
        ok("Space right after it still plays",
           len(calls("player_toggle")) == toggles + 3)
        master_meter = page.get_by_role("meter", name="Master level")
        ok("and the master's meter shows the whole mix as it plays",
           int(master_meter.get_attribute("aria-valuenow")) > 0)
        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        ok("and rests when it stops",
           master_meter.get_attribute("aria-valuenow") == "0")
        master_level = master.input_value()

        # The same for every other key of the player: a fader dragged with
        # the mouse keeps none of them.
        page.mouse.click(spot["x"] + spot["width"] * 0.3,
                         spot["y"] + spot["height"] / 2)
        seeks = len(calls("player_seek"))
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(300)
        ok("the arrows scrub after the fader was dragged",
           len(calls("player_seek")) == seeks + 1
           and master.input_value() == master_level)
        page.mouse.click(spot["x"] + spot["width"] * 0.3,
                         spot["y"] + spot["height"] / 2)
        seeks = len(calls("player_seek"))
        page.keyboard.press("Home")
        page.wait_for_timeout(300)
        ok("and Home goes to the start",
           len(calls("player_seek")) == seeks + 1
           and master.input_value() == master_level)
        # Reached with the keyboard, the fader is what the arrows are aimed at.
        page.focus("input[aria-label='Vocals volume']")
        page.keyboard.press("Tab")
        seeks = len(calls("player_seek"))
        tabbed = page.evaluate("document.activeElement.getAttribute('aria-label')")
        if tabbed == "Master volume":
            page.keyboard.press("ArrowLeft")
            page.wait_for_timeout(300)
        ok("a fader reached with Tab keeps its arrows",
           tabbed == "Master volume" and len(calls("player_seek")) == seeks
           and float(master.input_value()) < float(master_level))
        page.keyboard.press("ArrowRight")
        page.evaluate("document.activeElement.blur()")

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

        def wheel_at(ratio, dx, dy, holding=None):
            page.mouse.move(box["x"] + box["width"] * ratio, mid_y)
            if holding:
                page.keyboard.down(holding)
            page.mouse.wheel(dx, dy)
            if holding:
                page.keyboard.up(holding)
            page.wait_for_timeout(400)

        def zoom_at(ratio, dy):
            wheel_at(ratio, 0, dy, holding="Control")

        def clock_labels():
            """The times written on the ruler, in seconds."""
            out = []
            for text in clock.locator("span.tnum").all_inner_texts():
                minutes, seconds = text.strip().split(":")
                out.append(int(minutes) * 60 + int(seconds))
            return out

        whole_take_labels = clock_labels()
        # The wheel on its own is the page's: it scrolls the tracks, over the
        # waveforms as over the names beside them. It used to zoom, and a
        # page with the tracks below the fold could not be scrolled from the
        # middle of it.
        wheel_at(0.3, 0, -500)
        ok("the wheel on its own does not zoom",
           clock_labels() == whole_take_labels
           and page.locator("text=Whole take").count() == 0)
        left = page.get_by_role("group", name="Take timeline").evaluate(
            "el => el.dispatchEvent(new WheelEvent('wheel', {deltaY: 120, "
            "bubbles: true, cancelable: true}))")
        ok("it is left to the page, to scroll", left is True)
        before = seek_at(0.3)
        zoom_at(0.3, -500)
        # A ruler with nothing left on it also reads differently from the whole
        # take's, so "the text changed" is not enough: a tick ladder that
        # starts above the shortest zoom window empties the ruler instead of
        # rescaling it, and it flickers between one label and none as the
        # window is panned. This asks the zoomed ruler for a clock, and asks
        # that the clock belongs to the part of the take being shown.
        zoomed = clock_labels()
        ok("Ctrl and the wheel zoom in", zoomed != whole_take_labels)
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

        # On a Mac the hand goes to Cmd, not Ctrl. Dispatched from the page:
        # headless Chromium sends no wheel with Meta held.
        page.get_by_role("group", name="Take timeline").evaluate(
            """(el, [x, y]) => el.dispatchEvent(new WheelEvent('wheel', {
                 metaKey: true, deltaY: -500, clientX: x, clientY: y,
                 bubbles: true, cancelable: true}))""",
            [box["x"] + box["width"] * 0.5, mid_y])
        page.wait_for_timeout(400)
        ok("and on a Mac, Cmd and the wheel zoom in too",
           page.locator("text=Whole take").count() == 1)
        page.click("text=Whole take")
        page.wait_for_timeout(400)

        # Zoomed in, only two times in a corner said which part of the take
        # was on screen. A map of the whole take above the ruler, with a frame
        # for the part on screen, says it at a glance, and goes elsewhere by
        # dragging the frame or clicking the map. It is there zoomed out too,
        # with nothing framed: a row that came and went with the zoom moved
        # every track down the moment the wheel was turned, and a frame round
        # all of it was only a thick blue edge.
        take_map = page.get_by_role("scrollbar", name="Part of the take on screen")

        def view_now():
            """Where the window starts and how long it is, in seconds, from
            where clicks near its two ends land."""
            t02, t98 = seek_at(0.02), seek_at(0.98)
            length = (t98 - t02) / 0.96
            return t02 - 0.02 * length, length

        def box_of(locator):
            """Its box, or None at once: bounding_box() waits for an element
            that is not there, and the check after it should fail instead."""
            return locator.bounding_box() if locator.count() else None

        def frame_on_map():
            strip = box_of(take_map)
            frame = box_of(take_map.locator("[data-view-frame]"))
            if not strip or not frame:
                return None, None, strip, frame
            return ((frame["x"] - strip["x"]) / strip["width"],
                    (frame["x"] + frame["width"] - strip["x"]) / strip["width"],
                    strip, frame)

        ok("the map is there with the whole take on screen, and nothing on it framed",
           take_map.count() == 1
           and take_map.locator("[data-view-frame]").count() == 0)
        ok("and no Whole take while the whole take is what is on screen",
           page.get_by_role("button", name="Whole take").count() == 0)
        lanes_top = box_of(page.get_by_role("group", name="Take timeline"))
        zoom_at(0.5, -500)
        still_top = box_of(page.get_by_role("group", name="Take timeline"))
        ok("zooming in moves nothing down the page",
           bool(lanes_top and still_top) and abs(lanes_top["y"] - still_top["y"]) < 1)

        start, length = view_now()
        a, b, strip, frame = frame_on_map()
        ok("its frame is the part on screen",
           a is not None and abs(a - start / TAKE_SECONDS) < 0.02
           and abs(b - (start + length) / TAKE_SECONDS) < 0.02)
        if frame:
            cx, cy = frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] / 2
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx - strip["width"] * 0.2, cy, steps=8)
            page.mouse.up()
            page.wait_for_timeout(300)
        moved, still = view_now()
        ok("dragging the frame moves along the take as far as it was dragged",
           abs((start - moved) - 0.2 * TAKE_SECONDS) < 0.3 and abs(still - length) < 0.2)
        if strip:
            page.mouse.click(strip["x"] + strip["width"] * 0.9, strip["y"] + strip["height"] / 2)
            page.wait_for_timeout(300)
        jumped, _ = view_now()
        expected = min(TAKE_SECONDS - length, max(0.0, 0.9 * TAKE_SECONDS - length / 2))
        ok("a click on the map away from the frame brings that part on screen",
           abs(jumped - expected) < 0.3)
        whole = page.get_by_role("button", name="Whole take")
        wb, mb = box_of(whole), box_of(take_map)
        ok("Whole take is beside the map, where the eye already is",
           bool(wb and mb) and wb["x"] + wb["width"] <= mb["x"]
           and abs((wb["y"] + wb["height"] / 2) - (mb["y"] + mb["height"] / 2)) < 8)
        whole.click()
        page.wait_for_timeout(400)
        ok("and gives the whole take back, with the frame gone from the map",
           take_map.count() == 1
           and take_map.locator("[data-view-frame]").count() == 0)

        # Clear and Crop go with the region's times: zoomed to another part of
        # the take there is nothing for them to sit under. The map still
        # shows where the region is.
        drag_region(page, 0.55, 0.72)
        zoom_at(0.05, -900)
        ok("zoomed away from the region, Clear and Crop go with its times",
           page.get_by_role("button", name="Clear the loop region").count() == 0
           and page.locator("[data-region-span]").count() == 0)
        ok("while the map still shows where it is",
           take_map.locator("[data-map-region]").count() == 1)
        page.get_by_role("button", name="Whole take").click()
        page.wait_for_timeout(400)
        ok("and they come back with it",
           page.get_by_role("button", name="Clear the loop region").count() == 1)
        page.get_by_role("button", name="Clear the loop region").click()
        page.wait_for_timeout(300)

        # A marker off the side of the window is not drawn at all: without
        # that it would be pinned to the edge, pointing at the wrong second.
        all_markers = page.locator("[data-marker-at]").evaluate_all(
            "els => els.map(e => Number(e.dataset.markerAt))")
        ok("markers are on the timeline to start with", len(all_markers) > 1)
        zoom_at(0.98, -900)   # the last seconds of the take
        # Past this the wheel simply stops answering, and without a word
        # saying so that reads as the zoom having broken.
        ok("the closest window says it is the closest",
           page.locator("text=closest").count() == 1)
        # Said on the map: beside Whole take, "0:04 – 0:06 · closest" did not
        # fit its column and broke over two lines.
        shown = page.locator("[data-view-range]")
        line = shown.bounding_box() if shown.count() else None
        ok("and the times on screen stay on one line beside Whole take",
           bool(line) and line["height"] < 20
           and "closest" not in (shown.inner_text() or ""))
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
        zoom_at(0.98, -900)   # the far end, nowhere near the region
        ok("and it is gone once the window has nothing to do with the region",
           page.locator("[data-region-span]").count() == 0)

        page.click("button[aria-label^='Take 1 Polyn']")
        page.wait_for_timeout(700)
        ok("and picking another take starts from the whole of it",
           page.locator("text=Whole take").count() == 0)
        page.click("button[aria-label^='Take 2 Polyn (best)']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
        page.wait_for_timeout(300)
        ok("another take opens at the volume the last one was left at",
           master.input_value() == master_level and master_level != "1")

        print("\n[9d] The waveform sharpens to what is on screen")
        # Stretching the same 900 bars over two seconds shows no more than it
        # did over nine minutes, so the peaks are fetched again for the window.
        # Not on every wheel tick, though: that would be a burst of calls into
        # Python for a picture nobody has finished aiming yet.
        ranged_before = len([c for c in calls("take_media")
                             if len(c["args"]) > 2 and c["args"][2] is not None])
        # Six notches 16 ms apart, sent from inside the page, the way a wheel
        # sends them. Six page.mouse.wheel() calls are six round trips from
        # the test to the browser, and on a busy runner those came further
        # apart than the settle time, so each notch settled on its own and
        # was fetched: that failed the macOS build of 0.7.13, while the same
        # commit passed beside it.
        page.evaluate("""([x, y]) => new Promise((done) => {
          const el = document.querySelector("[aria-label='Take timeline']");
          let left = 6;
          const notch = () => {
            el.dispatchEvent(new WheelEvent('wheel', {deltaY: -120, clientX: x,
              clientY: y, ctrlKey: true, bubbles: true, cancelable: true}));
            if (--left > 0) setTimeout(notch, 16); else done();
          };
          notch();
        })""", [box["x"] + box["width"] * 0.5, mid_y])
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
        swept = page.locator(
            "section[aria-label='Notifications'] [data-notice='warning']",
            has_text="could not be moved out of the way")
        ok("and it is a warning, since the crop went through",
           swept.count() == 1
           and page.locator(".text-destructive",
                            has_text="could not be moved out of the way").count() == 0)
        swept.get_by_role("button", name="Close notice").click()
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
        ok("the dialog lets go as soon as the copy is queued",
           page.get_by_role("dialog").count() == 0)
        share = calls("share_take")
        ok("the take went up", len(share) == 1 and share[0]["args"][2] == "both")
        ok("and the row shows it is there",
           page.locator("button[aria-label='Cloud copies of Polyn (best)']").count() == 1)
        page.screenshot(path=str(SHOTS / "55-cloud.png"))

        # Deleting a take takes its copy out of the cloud folder too, which
        # is the band's: somebody else may be listening to it. So it says so.
        page.click("button[aria-label='Delete take Polyn (best)']")
        page.wait_for_selector("text=go to the Trash")
        ok("deleting a take that is in the cloud says its copy goes too",
           "Its copy in the cloud folder goes too."
           in (text_of(page.get_by_role("dialog")) or ""))
        page.get_by_role("button", name="Cancel").click()
        page.wait_for_timeout(200)

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
        # And it is still there a moment later. Waiting for the question to
        # appear says nothing about whether it stayed: a dialog opened by the
        # same keydown that is still on its way through the page can be
        # dismissed by that keydown, which looks like a flicker and leaves
        # the screen where it was. The wait above would catch it mid-flicker
        # and call it an answer.
        page.wait_for_timeout(300)
        ok("and then asks before ending a rehearsal with takes in it",
           page.locator("text=Finish this rehearsal?").count() == 1
           and len(calls("finish_rehearsal")) == finishes)

        # Answering it without the mouse. The question opens on the answer
        # that changes nothing, so getting to the other one is the whole of
        # what this checks — and it is the app's own doing, not the browser's.
        # This browser moves focus between buttons on Tab; the window the app
        # runs in on a Mac does so only if macOS "keyboard navigation" is
        # switched on, which by default it is not, and there Tab took focus
        # out of the page entirely. A check on Tab alone would therefore pass
        # here whatever the app did, which is why the arrows — which no
        # browser does on its own — carry the weight.
        def focused_on(page):
            return page.evaluate(
                "() => (document.activeElement?.innerText || '').trim()")

        ok("the question opens on the answer that changes nothing",
           focused_on(page) == "Keep going")
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(80)
        ok("an arrow key moves to the other answer", focused_on(page) == "Finish")
        page.keyboard.press("ArrowLeft")
        page.wait_for_timeout(80)
        ok("and back again", focused_on(page) == "Keep going")

        # Tab is taken over rather than left to whatever the browser does with
        # it, which is the half this browser cannot show by behaving well.
        # Watched from the capture phase, and on window, because that is
        # where the app takes the key: it stops the event there so that
        # nothing downstream moves focus a second time, which leaves a
        # listener anywhere further along with nothing to see. Listeners on
        # one target still run in turn, so this one sees the event after the
        # app has had it.
        page.evaluate(
            "() => { window.__TAB_TAKEN__ = null;"
            " window.addEventListener('keydown', (e) => {"
            "   if (e.key === 'Tab') window.__TAB_TAKEN__ = e.defaultPrevented;"
            " }, true); }"
        )
        page.keyboard.press("Tab")
        page.wait_for_timeout(80)
        ok("Tab is the app's to answer with, not the browser's",
           page.evaluate("() => window.__TAB_TAKEN__") is True
           and focused_on(page) == "Finish")

        escape_closes(page, "Finish this rehearsal?")
        ok("escape closes the question without finishing anything",
           len(calls("finish_rehearsal")) == finishes)

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
        ok("and that the copies of its takes in the cloud go with it",
           "So do the copies of 3 of them in the cloud folder."
           in (text_of(page.get_by_role("dialog")) or ""))
        page.click("text=Cancel")
        page.wait_for_timeout(200)
        ok("cancel deletes nothing", len(calls("delete_rehearsal")) == 0)
        page.click("button[aria-label='Delete rehearsal Tuesday jam']")
        page.wait_for_selector("text=goes to the Trash")
        page.locator("button", has_text="Delete").last.click()
        page.wait_for_timeout(400)
        ok("confirming deletes", len(calls("delete_rehearsal")) == 1)

        print("\n[11a] Setup does not guess a driver when several are offered")
        # A Windows-shaped list (several drivers) with nothing resolved: a
        # legacy choice dropped on upgrade, or an unplugged card. Guessing
        # devs[0] here would usually land on an MME entry nobody chose.
        nodev = browser.new_page(viewport={"width": 1180, "height": 820})
        nodev.add_init_script(
            """window.__HOST_API__ = 'Windows WASAPI';
               window.__NO_DEVICE__ = true;"""
            + MOCK
        )
        nodev.goto(server.base_url, wait_until="networkidle")
        nodev.wait_for_selector("text=Start rehearsal")
        ok("nothing resolved and several drivers: no interface chosen",
           nodev.locator("text=No interface chosen").count() == 1)
        ok("and starting is blocked",
           nodev.get_by_role("button", name="Start rehearsal").is_disabled())
        nodev.close()

        print("\n[12] Settings: output, folders, appearance")
        page.click("button[aria-label='Back']")
        page.wait_for_selector("text=Start rehearsal")
        page.click("button[aria-label='Settings']")
        page.wait_for_selector("text=Recording")

        # A screen with a way back has one on the keyboard too.
        ok("the back button says so", key_on(page, "button[aria-label='Back']") == "Esc")
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
        try:
            page.wait_for_selector("[aria-label='About this copy']", timeout=4000)
        except Exception:
            pass
        ok("the version it is running is on screen",
           page.locator("[aria-label='About this copy']").get_by_text("0.2.0", exact=True).count() == 1)
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
        # One audio system: choosing it would be a question with one answer.
        ok("there is no driver to choose on a Mac",
           page.locator("#input-device-driver").count() == 0
           and page.locator("#output-device-driver").count() == 0)
        ok("and nothing is said about drivers",
           page.locator("text=Each driver can offer").count() == 0)
        # Shown only where there was a choice, the outputs were a setting
        # nobody knew existed. With the system output there is nothing to
        # pick, and it says what to pick instead.
        ok("the outputs are there with the system output chosen",
           page.locator("#output-channels").count() == 1)
        ok("greyed out, at 1–2",
           page.locator("#output-channels").is_disabled()
           and "1–2" in page.inner_text("#output-channels"))
        ok("saying how to choose others",
           page.locator("text=choose the interface itself").count() == 1)
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

        print("\n[12b cont.] A card that will not say what it takes says so")
        # The list fell back to the usual three in silence, so a card that
        # answered nothing looked exactly like one that answered "all of
        # them" — which is how an XR18, with no 96 kHz at all and only the
        # rate its own mixer is set to, came to have every one of them on
        # screen as though it had said so itself.
        mute = browser.new_page(viewport={"width": 1180, "height": 820})
        mute.add_init_script("window.__FORMATS_REFUSED__ = true;" + MOCK)
        mute.goto(server.base_url, wait_until="networkidle")
        mute.wait_for_selector("text=Start rehearsal")
        mute.click("button[aria-label='Settings']")
        mute.get_by_role("button", name="Audio", exact=True).first.click()
        mute.wait_for_selector("#input-device")
        note = mute.get_by_role("status").filter(has_text="did not say")
        ok("the screen says the card would not answer", note.count() == 1)
        said = note.first.inner_text()
        ok("without making the person read the driver's error code",
           "-9999" not in said and "PaErrorCode" not in said)
        ok("and does not pass the three off as the card's own answer",
           "rather than its own" in said)
        ok("the rates are still there to choose from",
           mute.locator("button[aria-label='44.1 kHz']").count() == 1)
        mute.close()

        print("\n[12b cont. 2] Tracks left on another card's inputs")
        # The template keeps its input numbers, and changing the interface in
        # Settings does not touch them. On a narrower card the selector simply
        # went blank: nothing said anything until the signal check came back
        # with paInvalidChannelCount, a number about a card for a mistake
        # about a template.
        moved = browser.new_page(viewport={"width": 1180, "height": 820})
        moved.add_init_script(
            "window.__TRACKS_FROM_A_BIGGER_CARD__ = true;" + MOCK)
        moved.goto(server.base_url, wait_until="networkidle")
        moved.wait_for_selector("input[aria-label='Track 1 name']")
        stray = moved.get_by_role("status").filter(has_text="no input")
        ok("the screen names the track left behind", stray.count() == 1)
        told = stray.first.inner_text()
        ok("and says which one it is", "Vocals" in told)
        ok("and that the card is the reason", "Little USB box" in told
           and "2" in told)
        ok("without blaming the one that still fits", "Guitar" not in told)
        ok("and asks for the one thing that would work", "Pick one" in told)
        ok("its own input box says it is waiting for one, not nothing",
           moved.locator("[aria-label='Track 2 input']").inner_text()
           == "No input")
        ok("and the rehearsal cannot start while it waits",
           moved.locator("button:has-text('Start rehearsal')").is_disabled())

        # More tracks than the card has inputs is the other shape of not
        # fitting, and the only one where renumbering cannot help: told to
        # pick again, there is nothing to pick.
        for _ in range(3):
            moved.click("text=Add track")
        moved.wait_for_timeout(200)
        crowded = moved.get_by_role("status").filter(has_text="not enough")
        ok("five tracks on a two-input card say they will not fit",
           crowded.count() == 1)
        ok("and do not ask for an arrangement that does not exist",
           "Pick one" not in crowded.first.inner_text())
        moved.close()

        print("\n[4b] A track in stereo takes the input after its own")
        # A keyboard has two outputs. Turning stereo on claims the next input,
        # and where that one is already somebody's the track has to be left
        # waiting rather than quietly recording the same signal twice.
        pair = browser.new_page(viewport={"width": 1180, "height": 900})
        pair.add_init_script(MOCK)
        pair.goto(server.base_url, wait_until="networkidle")
        pair.wait_for_selector("input[aria-label='Track 1 name']")
        ok("a track starts in mono",
           pair.locator("[aria-label='Track 1 input']").inner_text() == "Input 1")

        pair.click("button[aria-label='Track 1 in stereo']")
        pair.wait_for_timeout(200)
        ok("turning stereo on where the next input is taken leaves it waiting",
           pair.locator("[aria-label='Track 1 input']").inner_text() == "No input")
        note = pair.get_by_role("status").filter(has_text="no input")
        ok("and the screen says whose input it is waiting for",
           note.count() == 1 and "Guitar" in note.first.inner_text())
        ok("the rehearsal will not start meanwhile",
           pair.locator("button:has-text('Start rehearsal')").is_disabled())

        # Input 3 is free: the pair 3–4 fits, and the control says so.
        pair.click("[aria-label='Track 1 input']")
        pair.get_by_role("option", name="Inputs 3–4").click()
        pair.wait_for_timeout(200)
        ok("a pair that fits reads as a pair",
           pair.locator("[aria-label='Track 1 input']").inner_text()
           == "Inputs 3–4")
        ok("and the rehearsal can start again",
           not pair.locator("button:has-text('Start rehearsal')").is_disabled())
        estimates = pair.evaluate(
            "() => window.__CALLS__.filter(c => c.name === 'disk_estimate')")
        ok("the free space is worked out for three channels, not two tracks",
           bool(estimates) and estimates[-1]["args"][0] == 3)
        pair.close()

        print("\n[4c] An interface switched on after the app")
        # PortAudio lists the devices once, when the app starts. The desk
        # switched on afterwards is not there until somebody looks again —
        # and until then the screen says so, instead of "No interface chosen"
        # or, on a Mac, quietly taking the laptop's own microphone.
        late = browser.new_page(viewport={"width": 1180, "height": 900})
        late.add_init_script("window.__PLUGGED_IN_LATE__ = true;" + MOCK)
        late.goto(server.base_url, wait_until="networkidle")
        late.wait_for_selector("input[aria-label='Track 1 name']")

        def late_calls(name):
            return late.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')")

        box = late.locator("button[aria-label='Change the interface and quality']")
        ok("a chosen interface that is absent is said to be not connected",
           "“X18/XR18” is not connected" in box.inner_text())
        ok("and is not swapped for the laptop's microphone",
           "MacBook" not in box.inner_text())
        ok("so the rehearsal cannot start on it",
           late.locator("button:has-text('Start rehearsal')").is_disabled())

        # Edited while the desk boots, which is when people do it.
        late.fill("input[aria-label='Track 2 name']", "Bass")
        late.get_by_role("button", name="Look again").click()
        late.wait_for_selector("text=Still not there")
        ok("looking again reaches Python", len(late_calls("rescan_devices")) == 1)
        ok("and a desk still booting is said to be still missing",
           "not connected" in box.inner_text())

        late.get_by_role("button", name="Look again").click()
        late.wait_for_selector("text=18 inputs")
        ok("once it is on, the screen records with it",
           box.inner_text().startswith("X18/XR18"))
        ok("and stops offering to look for it",
           late.get_by_role("button", name="Look again").count() == 0
           and late.locator("text=Still not there").count() == 0)
        ok("a name edited meanwhile is kept",
           late.input_value("input[aria-label='Track 2 name']") == "Bass")
        placed = late_calls("load_default_tracks")
        ok("because the band on screen is what gets placed",
           bool(placed) and [t["name"] for t in placed[-1]["args"][0]]
           == ["Guitar", "Bass"])
        ok("and the tracks take the desk's inputs",
           late.locator("[aria-label='Track 2 input']").inner_text() == "Input 2")
        ok("so the rehearsal can start",
           not late.locator("button:has-text('Start rehearsal')").is_disabled())
        late.screenshot(path=str(SHOTS / "61-found-late.png"))
        late.close()

        # The same in Settings, where the desk would otherwise be picked.
        late = browser.new_page(viewport={"width": 1180, "height": 900})
        late.add_init_script("window.__PLUGGED_IN_LATE__ = true;" + MOCK)
        late.goto(server.base_url, wait_until="networkidle")
        late.click("button[aria-label='Settings']")
        late.wait_for_selector("#input-device")
        ok("Settings says the chosen interface is not connected",
           "“X18/XR18” is not connected" in late.locator("#input-device").inner_text())
        asked = len(late_calls("recording_formats"))
        listed = len(late_calls("list_input_devices"))
        late.get_by_role("button", name="Look again").click()
        late.wait_for_timeout(300)
        late.get_by_role("button", name="Look again").click()
        late.wait_for_selector("text=Found “X18/XR18”")
        ok("looking again reads the lists again",
           len(late_calls("list_input_devices")) >= listed + 2)
        ok("and the desk found is the one in force",
           late.locator("#input-device").inner_text().startswith("X18/XR18"))
        ok("and is asked which rates it takes",
           len(late_calls("recording_formats")) > asked)
        late.get_by_role("button", name="Look again").click()
        late.wait_for_selector("text=No new interfaces")
        ok("a look that finds nothing new says so, and nothing else",
           late.locator("text=Found “X18/XR18”").count() == 0)
        late.close()

        print("\n[12k] Notices: what happened goes in the corner")
        # A message that appeared in the middle of Settings pushed the whole
        # panel down a line, and a few seconds later let it jump back up.
        tell = browser.new_page(viewport={"width": 1180, "height": 820})
        tell.add_init_script(MOCK)
        tell.goto(server.base_url, wait_until="networkidle")
        tell.click("button[aria-label='Settings']")
        tell.wait_for_selector("#input-device")

        def notices(kind=None):
            sel = "section[aria-label='Notifications'] [data-notice]"
            if kind:
                sel = f"section[aria-label='Notifications'] [data-notice='{kind}']"
            return tell.locator(sel)

        def top_of(selector):
            return tell.locator(selector).bounding_box()["y"]

        before = top_of("#input-device")
        tell.get_by_role("button", name="Look again").click()
        tell.wait_for_selector("[data-notice='done']:has-text('No new interfaces')")
        during = top_of("#input-device")
        ok("a notice does not move the form it is about", during == before)
        tell.wait_for_selector("[data-notice='done']", state="detached", timeout=7000)
        ok("a done notice goes by itself", notices().count() == 0)
        ok("and the form stays where it was when it has gone",
           top_of("#input-device") == before)
        ok("the corner the notices sit in takes no clicks of its own",
           tell.locator("section[aria-label='Notifications']").evaluate(
               "e => getComputedStyle(e).pointerEvents") == "none")

        tell.get_by_role("button", name="Folders", exact=True).first.click()
        tell.wait_for_selector("#recordings-dir")
        field = top_of("#recordings-dir")
        tell.fill("#recordings-dir", "/Users/alex/Band")
        tell.keyboard.press("Tab")
        saved = tell.locator("[data-notice='done']:has-text('Folder saved')")
        saved.wait_for()
        ok("saving a folder says so without moving the field",
           top_of("#recordings-dir") == field)
        saved.hover()
        tell.wait_for_timeout(5000)
        ok("a done notice under the pointer waits to be read", saved.count() == 1)
        tell.mouse.move(20, 20)
        saved.wait_for(state="detached", timeout=7000)
        ok("and goes once the pointer leaves it", saved.count() == 0)

        long_path = "/nope/" + "x" * 200
        tell.fill("#recordings-dir", long_path)
        tell.keyboard.press("Tab")
        failed = tell.locator("[data-notice='error']")
        failed.wait_for()
        ok("a failure is a notice that says so to a screen reader",
           failed.get_attribute("role") == "alert")
        ok("a long unbroken message wraps inside its notice",
           failed.evaluate("e => e.scrollWidth <= e.clientWidth")
           and failed.bounding_box()["x"] + failed.bounding_box()["width"] <= 1180)
        tell.fill("#recordings-dir", "/nope/again")
        tell.keyboard.press("Tab")
        tell.wait_for_selector("[data-notice='error']:has-text('/nope/again')")
        ok("the same failure again is one notice, not two", notices().count() == 1)
        tell.wait_for_timeout(5000)
        ok("a failure stays until it is closed", failed.count() == 1)

        tell.fill("#recordings-dir", "/Users/alex/Band 2")
        tell.keyboard.press("Tab")
        tell.wait_for_selector("[data-notice='done']:has-text('Folder saved')")
        ok("a retry that works leaves only its success",
           notices().count() == 1 and notices("error").count() == 0)

        # The success's four seconds must not end the failure that took its
        # place a moment later.
        tell.fill("#recordings-dir", "/nope/third")
        tell.keyboard.press("Tab")
        tell.wait_for_selector("[data-notice='error']:has-text('/nope/third')")
        tell.wait_for_timeout(4500)
        ok("a failure that replaced a success outlives the success's time",
           notices("error").count() == 1)

        # Focus is on Browse after the Tab, so Escape is not typing.
        tell.keyboard.press("Escape")
        tell.wait_for_selector("text=Start rehearsal")
        ok("with a notice showing, Escape still leaves Settings in one press",
           tell.locator("#recordings-dir").count() == 0)
        ok("and the notice is still there", notices("error").count() == 1)

        def settles(js, timeout=2000):
            try:
                tell.wait_for_function(js, timeout=timeout)
                return True
            except Exception:
                return False

        # The corner is clear of a footer's buttons only in a wide window at
        # 100%. A notice that stays must never sit on Start, Stop or Save
        # take, so it goes above the footer.
        tell.set_viewport_size({"width": 960, "height": 680})
        ok("a notice that stays leaves a footer's main button clickable, "
           "in the smallest window",
           settles("""() => {
               const b = [...document.querySelectorAll('footer button')]
                 .find(x => x.textContent.includes('Start rehearsal'));
               const r = b.getBoundingClientRect();
               return b.contains(document.elementFromPoint(r.right - 4, r.top + r.height / 2));
           }"""))
        ok("because it sits above the footer",
           settles("""() => {
               const n = document.querySelector("section[aria-label='Notifications'] [data-notice]");
               const f = document.querySelector('footer');
               return n.getBoundingClientRect().bottom <= f.getBoundingClientRect().top;
           }"""))
        tell.set_viewport_size({"width": 1180, "height": 820})
        tell.get_by_role("button", name="Close notice").click()
        ok("its button closes it", notices().count() == 0)
        tell.close()

        # Changing the output while a take is open can land somewhere else.
        # Python has always said so; the screen used to read only `ok`.
        fell = browser.new_page(viewport={"width": 1180, "height": 820})
        fell.add_init_script("window.__OUTPUT_FALLBACK__ = true;" + MOCK)
        fell.goto(server.base_url, wait_until="networkidle")
        fell.click("button[aria-label='Settings']")
        fell.wait_for_selector("#output-device")
        fell.click("#output-device")
        fell.get_by_role("option", name="UA Monitors").click()
        warned = fell.locator("[data-notice='warning']")
        warned.wait_for()
        ok("a playback fallback after changing the output reaches the screen",
           "using the system output" in warned.inner_text())
        ok("as a warning, not an error",
           fell.locator("[data-notice='error']").count() == 0)
        # A second change that also falls back says so in the same place,
        # not in a second notice on top of the first.
        fell.click("#output-device")
        fell.get_by_role("option", name="MacBook Speakers").click()
        fell.wait_for_selector("[data-notice='warning']:has-text('MacBook Speakers')")
        ok("a second fallback takes the first one's place",
           fell.locator("[data-notice]").count() == 1)
        fell.close()

        print("\n[12l] History and Drafts say what failed in the corner")
        hist = browser.new_page(viewport={"width": 1180, "height": 820})
        hist.add_init_script("window.__REHEARSAL_UNREADABLE__ = true;" + MOCK)
        hist.goto(server.base_url, wait_until="networkidle")
        hist.click("text=History")
        hist.wait_for_selector("text=Tuesday jam")
        row = hist.locator("text=Tuesday jam").first
        row_top = row.bounding_box()["y"]
        row.click()
        failed = hist.locator("section[aria-label='Notifications'] [data-notice='error']")
        failed.wait_for()
        ok("a rehearsal that will not open says so as a notice",
           "session.json is damaged" in failed.inner_text()
           and failed.get_attribute("role") == "alert")
        ok("without moving the list", row.bounding_box()["y"] == row_top)

        # A dialog opened while a notice is showing keeps its own Escape.
        hist.click("button[aria-label='Rename rehearsal Tuesday jam']")
        hist.wait_for_selector("[role='dialog']")
        hist.keyboard.press("Escape")
        hist.wait_for_selector("[role='dialog']", state="detached")
        ok("Escape closes the dialog and stays in History",
           hist.locator("text=Tuesday jam").count() > 0
           and hist.locator("text=Start rehearsal").count() == 0)
        ok("and leaves the notice alone", failed.count() == 1)
        hist.close()

        lost = browser.new_page(viewport={"width": 1180, "height": 820})
        lost.add_init_script(
            """window.__RECOVER_FAILS__ = true;
               window.__DRAFTS__ = [{dir:'/rec/old/_drafts/take 1', name:'take 1',
                 tracks:['Guitar','Vocals'], duration_sec:95,
                 rehearsal_folder:'/rec/old', rehearsal_name:'Tuesday jam',
                 created_at:'2026-09-10T19:00:00'}];"""
            + MOCK
        )
        lost.goto(server.base_url, wait_until="networkidle")
        lost.wait_for_selector("text=Unsaved takes found", timeout=8000)
        lost.get_by_role("button", name="Recover").click()
        refused = lost.locator("section[aria-label='Notifications'] [data-notice='error']")
        refused.wait_for()
        ok("a take that will not recover says so as a notice",
           "read-only" in refused.inner_text())
        ok("and the take is still offered",
           lost.locator("text=Unsaved takes found").count() == 1)
        lost.close()

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

        # Turning sending off does not take the question with it. A block
        # that vanishes moves everything under it out from beneath the
        # pointer, and leaves nothing on screen to say what would be sent if
        # the box were ticked again — greyed out with its reason is what the
        # checkbox beside it already does.
        page.click("text=Send saved takes automatically")
        page.wait_for_timeout(300)
        ok("unticking leaves the question on screen",
           page.locator("text=What gets published").count() == 1)
        ok("and says why it is not in force",
           page.locator("text=Not while sending is off").count() == 1)

        # The cloud folder is the gate. Without one there are no copies, so
        # none of the questions about a copy have a subject: what it is
        # written as, whether it goes on its own, what of it goes. They are
        # not greyed out but gone, and the folder says the whole of it —
        # "Not set, nothing is copied anywhere" — with its own Browse beside
        # it. Greyed out they were a wall of dead rows with three sentences
        # explaining copies that cannot happen.
        page.click("text=Forget the cloud folder")
        page.wait_for_timeout(400)
        ok("forgetting the folder switches sending off in Python too",
           len(calls("clear_cloud_dir")) == 1)
        ok("the field says nothing is copied anywhere",
           "Not set" in page.input_value("#cloud-dir")
           or page.locator("#cloud-dir").get_attribute("placeholder").startswith("Not set"))
        ok("how a copy is written goes with it",
           page.locator("button[aria-label='Lossless (FLAC)']").count() == 0)
        ok("so does sending on its own",
           page.locator("#auto-publish").count() == 0)
        ok("and so does what would be sent",
           page.locator("button[aria-label='The mix']").count() == 0)
        ok("with no sentence left behind about copies",
           page.locator("text=Only the copies are affected").count() == 0)
        page.screenshot(path=str(SHOTS / "56-settings-no-cloud.png"))
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
               window.__AUTO_PUBLISH__ = {on:true, what:'mix'};
               // Already set to MP3 by an earlier run, on a machine that
               // cannot write one. Set rather than clicked, because with no
               // cloud folder there is nothing to write and the choice is not
               // a live one — but what it is set to still has to be answered
               // for.
               window.__CLOUD_FORMAT__ = 'mp3';"""
            + MOCK
        )
        win.goto(server.base_url, wait_until="networkidle")
        win.wait_for_selector("text=Start rehearsal")

        # `page` is closed by now, so `calls` (bound to it) cannot be reused
        # here — this page has its own window.__CALLS__.
        def win_calls(name):
            return win.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')"
            )

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
        ok("the driver is chosen first",
           win.locator("#input-device-driver").count() == 1)
        ok("starting from the one the saved card is on",
           "MME" in win.inner_text("#input-device-driver"))
        ok("and the card itself no longer repeats it",
           "(MME)" not in win.inner_text("#input-device"))
        ok("with a line on why the driver matters",
           win.locator("text=Each driver can offer").count() == 1)

        win.click("#input-device-driver")
        drivers = win.get_by_role("option").all_inner_texts()
        ok("every driver with an input is offered, once each",
           sorted(drivers) == ["ASIO", "MME", "Windows WASAPI"])
        win.get_by_role("option", name="ASIO").click()
        win.wait_for_timeout(200)
        ok("changing the driver saves nothing on its own",
           not any(c["args"][0] == 3 for c in win_calls("set_recording_format")))
        win.click("#input-device")
        ok("its devices are what is offered",
           win.get_by_role("option").all_inner_texts() == ["X32 USB · up to 16 ch"])
        win.get_by_role("option").first.click()
        win.wait_for_timeout(300)
        ok("and picking one saves it",
           win_calls("set_recording_format")[-1]["args"][0] == 3)

        ok("playback is chosen the same way",
           win.locator("#output-device-driver").count() == 1)
        ok("with nothing saved the first driver is shown",
           "MME" in win.inner_text("#output-device-driver"))
        win.click("#output-device-driver")
        ok("offering only drivers with an output",
           sorted(win.get_by_role("option").all_inner_texts()) == ["ASIO", "MME"])
        win.get_by_role("option", name="ASIO").click()
        win.click("#output-device")
        ok("the system output is still there under any driver",
           win.get_by_role("option").all_inner_texts()
           == ["System output", "X32 USB · 16 outputs"])
        win.get_by_role("option", name="X32 USB").click()
        win.wait_for_timeout(300)
        ok("and picking a card switches to it",
           win_calls("set_output_device")[-1]["args"][0] == 3)

        # A 16-output desk: which of its outputs the mix comes out of.
        win.wait_for_selector("#output-channels")
        ok("a card with more than a pair asks which outputs",
           "1–2" in win.inner_text("#output-channels"))
        win.click("#output-channels")
        offered = win.get_by_role("option").all_inner_texts()
        ok("pairs first, the way cards label them",
           offered[:3] == ["1–2", "3–4", "5–6"] and "2–3" not in offered)
        ok("and nothing about other drivers, with all sixteen offered",
           win.locator("text=This driver offers two outputs").count() == 0)
        ok("then each output on its own",
           "1 (mono)" in offered and "16 (mono)" in offered
           and len(offered) == 8 + 16)
        win.get_by_role("option", name="3–4", exact=True).click()
        win.wait_for_timeout(300)
        ok("picking a pair reaches Python",
           win_calls("set_output_channels")[-1]["args"][0] == [3, 4])
        ok("and stays shown", "3–4" in win.inner_text("#output-channels"))

        # The chosen card is on ASIO; switching to a driver that does not
        # carry it must not read as "System output" — nothing was unchosen.
        win.click("#output-device-driver")
        win.get_by_role("option", name="MME").click()
        win.wait_for_timeout(150)
        ok("a card on another driver does not masquerade as system output",
           "System output" not in win.inner_text("#output-device"))
        ok("a neutral placeholder is shown instead",
           "Pick an output" in win.inner_text("#output-device"))

        # Through MME a desk is often a stereo device. Whoever picked it there
        # saw no outputs to choose and had no reason to look under ASIO.
        win.click("#output-device")
        win.get_by_role("option", name="Speakers").click()
        win.wait_for_timeout(300)
        ok("a card with two outputs still offers them",
           win.locator("#output-channels").count() == 1
           and not win.locator("#output-channels").is_disabled())
        ok("and says another driver may show more",
           win.locator("text=This driver offers two outputs").count() == 1)

        win.get_by_role("button", name="Folders", exact=True).first.click()
        win.wait_for_selector("#recordings-dir")
        ok("the long-path warning is shown",
           win.locator("text=214 characters").count() == 1)

        # Nothing here offers to publish automatically while there is nowhere
        # to publish to — every take would only collect "No cloud folder
        # chosen" — and the config this window starts from has it switched on
        # anyway, the way one left by an older version can.
        ok("publishing automatically is not on offer without a cloud folder",
           win.locator("#auto-publish").count() == 0)
        ok("and neither is choosing what it would send",
           all(win.get_by_role("button", name=label, exact=True).count() == 0
               for label in ("The mix", "The original tracks", "Both")))
        ok("nor how a copy would be written, there being no copies",
           win.get_by_role("button", name="Compressed (MP3)").count() == 0)

        # Pick one and all of it appears — including what this machine has to
        # say about the format it was already set to.
        win.get_by_role("button", name="Choose cloud folder").click()
        win.wait_for_timeout(400)
        ok("choosing a folder brings the questions about copies with it",
           win.get_by_role("button", name="Compressed (MP3)").is_enabled()
           and win.locator("#auto-publish").count() == 1)
        ok("and compression says why it cannot work here",
           win.locator("text=soundfile package is missing").count() == 1)
        win.screenshot(path=str(SHOTS / "57-windows-shaped.png"))
        win.close()

        print("\n[12e] A tick at the very end does not push the lanes sideways")
        # 10:06 puts the 10:00 tick at 99% of the ruler. Its label used to hang
        # past the edge, and the lanes' scroll container — overflow-y: auto
        # makes overflow-x auto as well — grew a horizontal scrollbar under
        # the last track. Chromium headless hides scrollbars, so the overflow
        # itself is measured rather than looked at.
        edge = browser.new_page(viewport={"width": 1180, "height": 820})
        edge.add_init_script("window.__OLD_LENGTH_SEC__ = 606;" + MOCK)
        edge.goto(server.base_url, wait_until="networkidle")
        edge.wait_for_selector("text=Start rehearsal")
        edge.click("text=History")
        edge.wait_for_selector("text=Tuesday jam")
        edge.click("text=Tuesday jam")
        edge.locator("button[aria-label='Take 1 Polyn']").click()
        edge.wait_for_selector("[aria-label='Timeline clock'] >> text=10:00")
        sideways = edge.evaluate("""() => {
          const ruler = document.querySelector("[aria-label='Timeline clock']");
          let el = ruler.parentElement;
          while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement;
          return el.scrollWidth - el.clientWidth;
        }""")
        ok("the lanes do not scroll sideways", sideways <= 0)
        inside = edge.evaluate("""() => {
          const ruler = document.querySelector("[aria-label='Timeline clock']");
          const edge = ruler.getBoundingClientRect().right;
          return [...ruler.querySelectorAll('span')]
            .filter(s => s.textContent === '10:00')
            .every(s => s.getBoundingClientRect().right <= edge + 0.5);
        }""")
        ok("and the last label is still there, inside the ruler", inside)
        edge.close()

        print("\n[12f] An open rehearsal with no take picked shows the evening")
        # It used to be one lonely "Pick a take" under the strip. What was
        # played, how many goes each song got and every note left while
        # listening are all known already, and are what you came back for.
        eve = browser.new_page(viewport={"width": 1180, "height": 820})
        eve.add_init_script("window.__FULL_EVENING__ = true;" + MOCK)
        eve.goto(server.base_url, wait_until="networkidle")
        eve.wait_for_selector("text=Start rehearsal")
        eve.click("text=History")
        eve.wait_for_selector("text=Tuesday jam")
        eve.click("text=Tuesday jam")
        eve.wait_for_selector("[aria-label='Rehearsal overview']")
        overview = eve.locator("[aria-label='Rehearsal overview']").inner_text()
        ok("it says how long and how many",
           "11:50\nplayed" in overview and "4\ntakes" in overview
           and "2\nsongs" in overview)
        ok("and how many are in the cloud", "1 of 4\nin the cloud" in overview)
        ok("each song with its goes", "Polyn" in overview and "2 goes" in overview
           and "Vesna" in overview)
        ok("and how many notes of each kind",
           "1 keep this" in overview and "1 went wrong" in overview)
        ok("and the takes nobody named, together", "Not named" in overview)
        ok("the notes are listed", "this one is the take" in overview
           and "guitar drifts here" in overview)
        ok("a plain mark with nothing written is not a note",
           eve.locator("[aria-label='Rehearsal overview'] [data-note]").count() == 2)
        ok("no lonely 'pick a take' line", eve.locator("text=Pick a take").count() == 0)
        ok("a take already in the cloud folder says so on its row",
           eve.locator("[data-take='2'] [data-in-cloud]").count() == 1)
        # Every go on one scale: the four-minute Vesna is the longest bar.
        widths = eve.evaluate("""() => Object.fromEntries(
          [...document.querySelectorAll('[data-take]')].map(r => [r.dataset.take,
            r.querySelector('button[aria-label^="Take "]').getBoundingClientRect().width]))""")
        ok("each go is a bar drawn to its length",
           widths["4"] > widths["1"] > widths["3"])
        ok("and the others do not",
           eve.locator("[aria-label='Rehearsal overview'] [data-in-cloud]").count() == 1)
        ok("and no strip of pills repeating it",
           eve.get_by_role("group", name="Take strip").count() == 0)
        eve.screenshot(path=str(SHOTS / "60-overview.png"))

        eve.click("[aria-label='Rehearsal overview'] >> text=guitar drifts here")
        eve.wait_for_selector("[aria-label='Take timeline']")
        eve.wait_for_timeout(600)
        seeks = eve.evaluate("() => window.__CALLS__.filter(c => c.name === 'player_seek')")
        ok("a note opens its take",
           "Vesna" in eve.locator("button[aria-current='true']").inner_text())
        ok("at the spot it was left", bool(seeks) and abs(seeks[-1]["args"][0] - 40) < 0.5)
        ok("and the overview makes way for the player",
           eve.locator("[aria-label='Rehearsal overview']").count() == 0)
        ok("and the strip is back, to switch takes without going back",
           eve.get_by_role("group", name="Take strip").count() == 1)

        eve.keyboard.press("Escape")
        eve.wait_for_selector("[aria-label='Rehearsal overview']")
        eve.click("[aria-label='Rehearsal overview'] button[aria-label='Take 2 Polyn 2']")
        eve.wait_for_selector("[aria-label='Take timeline']")
        ok("a take in the overview opens it",
           "Polyn 2" in eve.locator("button[aria-current='true']").inner_text())
        eve.click("button[aria-label='Delete take Polyn 2']")
        eve.wait_for_selector("text=go to the Trash")
        ok("in History too, deleting a take that is in the cloud says its copy goes",
           "Its copy in the cloud folder goes too."
           in (text_of(eve.get_by_role("dialog")) or ""))
        escape_closes(eve, "go to the Trash")
        eve.keyboard.press("Escape")
        eve.wait_for_selector("[aria-label='Rehearsal overview']")

        # The whole row opens its take, not only the bar drawn to its length:
        # a short take's bar is a small thing to aim at, and the row lights up
        # under the mouse all the way across.
        def open_from(what, where):
            try:
                eve.mouse.click(*where())
                eve.wait_for_selector("[aria-label='Take timeline']", timeout=4000)
            except Exception:
                pass
            ok(f"a click {what} opens its take",
               "Take 3" in (text_of(eve.locator("button[aria-current='true']")) or ""))
            if eve.locator("[aria-label='Rehearsal overview']").count() == 0:
                eve.keyboard.press("Escape")
                eve.wait_for_selector("[aria-label='Rehearsal overview']")

        def centre(selector):
            box = eve.locator(selector).first.bounding_box()
            return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

        def past_the_bar():
            # Beside the actions, where a short take's row is empty.
            box = eve.evaluate("""() => {
              const row = document.querySelector("[data-take='3'] > div");
              const actions = row.lastElementChild.getBoundingClientRect();
              const r = row.getBoundingClientRect();
              return {x: actions.left - 6, y: r.top + r.height / 2};
            }""")
            return box["x"], box["y"]

        open_from("on the empty part of a row, past its bar", past_the_bar)
        open_from("on a take's length", lambda: centre(
            "[data-take='3'] > div span.tnum.shrink-0"))

        print("\n[12f2] A take plays from its row in the overview")
        def eve_calls(name):
            return eve.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')")
        opens = len(eve_calls("player_open"))
        eve.click("[aria-label='Rehearsal overview'] button[aria-label='Play Vesna']")
        eve.wait_for_selector("button[aria-label='Pause Vesna']")
        ok("Play on a row plays the take right there",
           len(eve_calls("player_open")) == opens + 1
           and eve.locator("[aria-label='Take timeline']").count() == 0)
        eve.wait_for_timeout(400)
        ok("with how far it has got beside its bar",
           "/ 4:10" in eve.locator("[data-take='4']").inner_text())
        eve.keyboard.press("Space")
        try:
            eve.wait_for_selector("button[aria-label='Play Vesna']", timeout=4000)
        except Exception:
            pass
        ok("Space pauses it, though the mouse pressed Play",
           eve.locator("button[aria-label='Play Vesna']").count() == 1)
        eve.keyboard.press("Space")
        eve.wait_for_selector("button[aria-label='Pause Vesna']")
        eve.click("[aria-label='Rehearsal overview'] button[aria-label='Take 4 Vesna']")
        eve.wait_for_selector("[aria-label='Take timeline']")
        ok("its bar opens it in the player, without opening it again",
           len(eve_calls("player_open")) == opens + 1)
        ok("and it carries on playing there",
           eve.locator("button[aria-label='Pause']").count() == 1)
        eve.keyboard.press("Escape")
        eve.wait_for_selector("[aria-label='Rehearsal overview']")
        ok("back in the overview, a take that is playing plays on",
           eve.locator("button[aria-label='Pause Vesna']").count() == 1)
        closes = len(eve_calls("player_close"))
        eve.keyboard.press("Escape")
        eve.wait_for_selector("button[aria-label='Play Vesna']")
        ok("Escape stops it and puts it away",
           len(eve_calls("player_close")) > closes
           and eve.locator("[aria-label='Rehearsal overview']").count() == 1)
        # The row's own buttons, for the take under the mouse.
        eve.hover("[data-take='1']")
        eve.click("[data-take='1'] button[aria-label='Rename take Polyn']")
        eve.wait_for_selector("text=Rename take")
        ok("a row can be renamed without opening its take",
           eve.locator("[aria-label='Take timeline']").count() == 0)
        escape_closes(eve, "Rename take")
        eve.keyboard.press("Escape")
        eve.wait_for_selector("text=Tuesday jam")
        ok("and the next Escape leaves the rehearsal",
           eve.locator("[aria-label='Rehearsal overview']").count() == 0)
        eve.close()

        print("\n[12g] A call that fails in Python says so")
        # Save take on Windows raised inside Python; the promise rejected, no
        # screen caught it, and the button just dimmed and stayed dimmed.
        bad = browser.new_page(viewport={"width": 1180, "height": 820})
        bad.add_init_script(
            "window.__FAIL__ = {keep_take: \"'charmap' codec can't encode characters\"};"
            + MOCK)
        bad.goto(server.base_url, wait_until="networkidle")
        bad.wait_for_selector("text=Start rehearsal")
        bad.click("text=Start rehearsal")
        bad.wait_for_selector("text=Record take 1")
        bad.click("text=Record take 1")
        bad.wait_for_selector("text=Stop")
        bad.click("text=Stop")
        bad.wait_for_selector("#take-name")
        bad.click("button:has-text('Save take')")
        bad.wait_for_selector("[role='alert'][aria-label='Something went wrong']")
        bar = bad.locator("[role='alert'][aria-label='Something went wrong']").inner_text()
        ok("a bar says what failed", "charmap" in bar and "UnicodeEncodeError" in bar)
        ok("and where the whole of it is written down", "crash.log" in bar)
        ok("the screen gets an answer, so Save take is not left dimmed",
           bad.locator("button:has-text('Save take')").is_enabled())
        ok("and says it could not save, in its own place",
           bad.locator("text=charmap").count() >= 2)
        bad.get_by_role("button", name="Dismiss").click()
        bad.wait_for_timeout(200)
        ok("the bar can be put away",
           bad.locator("[role='alert'][aria-label='Something went wrong']").count() == 0)
        bad.close()

        print("\n[12h] Saving a take says whether it goes to the cloud")
        sky = browser.new_page(viewport={"width": 1180, "height": 820})
        sky.add_init_script(
            "window.__CLOUD_DIR__ = '/Users/alex/Google Drive/Band';"
            "window.__AUTO_PUBLISH__ = {on:true, what:'mix'};" + MOCK)
        sky.goto(server.base_url, wait_until="networkidle")
        sky.wait_for_selector("text=Start rehearsal")
        sky.click("text=Start rehearsal")

        def record_and_review(n):
            sky.wait_for_selector(f"text=Record take {n}")
            sky.click(f"text=Record take {n}")
            sky.wait_for_selector("text=Stop")
            sky.click("text=Stop")
            sky.wait_for_selector("#send-to-cloud")

        def sent_as():
            kept = sky.evaluate(
                "() => window.__CALLS__.filter(c => c.name === 'keep_take')")
            args = kept[-1]["args"]
            return args[6] if len(args) > 6 else None

        record_and_review(1)
        ok("with sending on, the take is set to go",
           sky.is_checked("#send-to-cloud"))
        ok("and it says what goes",
           "the mix" in sky.inner_text("label[for='send-to-cloud']")
           and "WAV" in sky.inner_text("label[for='send-to-cloud']"))
        sky.uncheck("#send-to-cloud")
        # Space right after clicking the box must still save, not re-tick it.
        sky.keyboard.press("Space")
        sky.wait_for_timeout(400)
        ok("unticked, this take is kept out", sent_as() is False)

        record_and_review(2)
        ok("the next take starts from the setting again, not from the last one",
           sky.is_checked("#send-to-cloud"))
        sky.click("button:has-text('Save take')")
        sky.wait_for_timeout(400)
        ok("and left alone it simply follows the setting", sent_as() is None)
        sky.close()

        print("\n[12i] A rehearsal whose folder is gone")
        gone = browser.new_page(viewport={"width": 1180, "height": 820})
        gone.add_init_script(MOCK)
        gone.goto(server.base_url, wait_until="networkidle")
        gone.wait_for_selector("text=Start rehearsal")

        def gone_calls(name):
            return gone.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')"
            )

        gone.click("text=History")
        gone.wait_for_selector("text=Missing jam")
        row = gone.locator(".rounded-xl", has_text="Missing jam").first
        ok("the missing rehearsal carries the badge",
           row.locator("text=Not found on disk").count() == 1)
        ok("and no other row does",
           gone.locator("text=Not found on disk").count() == 1)

        info = row.locator("[aria-disabled='true']")
        ok("its info area is marked not interactive",
           info.get_attribute("aria-disabled") == "true")
        info.click()
        gone.wait_for_timeout(300)
        ok("clicking it does not try to open it",
           len(gone_calls("get_rehearsal")) == 0)

        row.get_by_role("button", name="Locate folder…").click()
        gone.wait_for_timeout(300)
        located = gone_calls("choose_rehearsal_folder")
        ok("Locate folder asks Python, with that rehearsal's folder",
           len(located) == 1 and located[0]["args"][0] == "/rec/gone")
        ok("found, it drops off the missing list",
           gone.locator("text=Not found on disk").count() == 0)

        print("\n[12i cont.] Cancelling the folder dialog does nothing")
        cancel = browser.new_page(viewport={"width": 1180, "height": 820})
        cancel.add_init_script("window.__CANCEL_LOCATE__ = true;" + MOCK)
        cancel.goto(server.base_url, wait_until="networkidle")
        cancel.wait_for_selector("text=Start rehearsal")

        def cancel_calls(name):
            return cancel.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')"
            )

        cancel.click("text=History")
        cancel.wait_for_selector("text=Missing jam")
        cancel.locator(".rounded-xl", has_text="Missing jam").first.get_by_role(
            "button", name="Locate folder…"
        ).click()
        cancel.wait_for_timeout(300)
        ok("a cancelled dialog leaves the entry as it was",
           cancel.locator("text=Not found on disk").count() == 1)

        cancel_row = cancel.locator(".rounded-xl", has_text="Missing jam").first
        cancel_row.get_by_role("button", name="Remove from history").click()
        cancel.wait_for_selector("text=Only the entry goes")
        ok("it asks before removing anything",
           len(cancel_calls("forget_rehearsal")) == 0)
        cancel.get_by_role("button", name="Remove", exact=True).click()
        cancel.wait_for_timeout(300)
        forgotten = cancel_calls("forget_rehearsal")
        ok("confirming removes just the entry, with that folder",
           len(forgotten) == 1 and forgotten[0]["args"][0] == "/rec/gone")
        ok("and it is gone from the list",
           cancel.locator("text=Missing jam").count() == 0)
        cancel.close()
        gone.close()

        print("\n[12j] A problem while starting is shown, once")
        startup = browser.new_page(viewport={"width": 1180, "height": 820})
        startup.add_init_script(
            "window.__STARTUP_PROBLEM__ = "
            "{name: 'OperationalError', "
            "message: 'Could not read the history of Tuesday jam.'};"
            + MOCK
        )
        startup.goto(server.base_url, wait_until="networkidle")
        startup.wait_for_selector(
            "[role='alert'][aria-label='Something went wrong']", timeout=8000
        )
        bar = startup.locator(
            "[role='alert'][aria-label='Something went wrong']"
        ).inner_text()
        ok("a problem from startup reaches the same bar",
           "Could not read the history" in bar and "Tuesday jam" in bar)
        ok("with the kind of problem it was", "OperationalError" in bar)
        ok("asked only once",
           len(startup.evaluate(
               "() => window.__CALLS__.filter(c => c.name === 'startup_problems')"
           )) == 1)
        startup.close()

        print("\n[12m] A card that goes away mid-take stops it, and says why")
        gone = browser.new_page(viewport={"width": 1180, "height": 820})
        gone.add_init_script(MOCK)
        gone.goto(server.base_url, wait_until="networkidle")
        gone.wait_for_selector("text=Start rehearsal")
        gone.click("text=Start rehearsal")
        gone.wait_for_selector("text=Record take 1")
        gone.click("text=Record take 1")
        gone.wait_for_selector("text=Stop")
        reason = ("Recording stopped: no sound has come from the audio "
                  "interface for 3 seconds.")
        gone.evaluate(f"() => {{ window.__IFACE_GONE__ = {reason!r}; }}")
        gone.wait_for_selector("text=Save take", timeout=8000)
        ok("the take is stopped without anyone pressing Stop",
           len(gone.evaluate(
               "() => window.__CALLS__.filter(c => c.name === 'stop_take')"
           )) == 1)
        said = gone.locator(
            "section[aria-label='Notifications'] [data-notice='warning']")
        ok("and the reason stays on screen once the take is up for review",
           said.count() == 1 and "no sound has come" in said.inner_text())
        # Plugged back in, the next take starts clean: "Recording stopped"
        # in the corner over a take that is recording would be a lie.
        gone.evaluate("() => { window.__IFACE_GONE__ = null; }")
        gone.click("text=Save take")
        gone.wait_for_selector("text=Record take 2")
        gone.click("text=Record take 2")
        gone.wait_for_selector("text=Stop")
        ok("the next take does not carry the last one's reason", said.count() == 0)
        gone.close()

        print("\n[12n] A card gone quiet during the check or playback says so")
        quiet = browser.new_page(viewport={"width": 1180, "height": 820})
        quiet.add_init_script(MOCK)
        quiet.goto(server.base_url, wait_until="networkidle")
        quiet.wait_for_selector("text=Check signal")
        quiet.click("text=Check signal")
        quiet.wait_for_selector("text=Stop checking")
        quiet.evaluate(
            "() => { window.__CHECK_QUIET__ = 'No sound from \u201cInterface\u201d "
            "for 3 seconds \u2014 it was unplugged, switched off or stopped "
            "answering. Plug it back in and press Check signal.'; }")
        quiet.wait_for_selector("text=No sound from", timeout=6000)
        ok("a card gone quiet stops the check",
           quiet.locator("button:has-text('Check signal')").count() == 1
           and len(quiet.evaluate(
               "() => window.__CALLS__.filter(c => c.name === 'stop_monitor')")) >= 1)
        ok("and says so in place, not in the corner",
           quiet.get_by_role("status").filter(has_text="No sound from").count() == 1
           and quiet.locator(
               "section[aria-label='Notifications'] [data-notice]").count() == 0)
        quiet.evaluate("() => { window.__CHECK_QUIET__ = null; }")
        quiet.click("text=Check signal")
        quiet.wait_for_selector("text=Stop checking")
        ok("checking again clears it", quiet.locator("text=No sound from").count() == 0)
        quiet.click("text=Stop checking")

        quiet.click("text=Start rehearsal")
        quiet.wait_for_selector("text=Record take 1")
        quiet.click("text=Record take 1")
        quiet.wait_for_selector("button:has-text('Stop')")
        quiet.click("button:has-text('Stop')")
        quiet.wait_for_selector("text=Save take")
        quiet.get_by_role("button", name="Play", exact=True).click()
        quiet.wait_for_selector("button[aria-label='Pause']")
        quiet.evaluate(
            "() => { window.__OUTPUT_QUIET__ = 'Playback stopped: nothing has gone "
            "out through \u201cInterface\u201d for 3 seconds \u2014 it was "
            "unplugged, switched off or stopped answering. Press play to try it "
            "again.'; }")
        quiet.wait_for_selector("text=Playback stopped", timeout=4000)
        ok("a playback card gone quiet pauses the take and says so",
           quiet.locator("button[aria-label='Play']").count() == 1)
        quiet.evaluate("() => { window.__OUTPUT_QUIET__ = null; }")
        quiet.get_by_role("button", name="Play", exact=True).click()
        quiet.wait_for_selector("button[aria-label='Pause']")
        ok("play tries the card again, and the line goes once it plays",
           quiet.locator("text=Playback stopped").count() == 0)
        quiet.close()

        print("\n[12o] Background work, from any screen")
        bg = browser.new_page(viewport={"width": 1180, "height": 820})
        bg.add_init_script("window.__ACTIVITY__ = [];" + MOCK)
        bg.goto(server.base_url, wait_until="networkidle")
        bg.wait_for_selector("text=Start rehearsal")

        def bg_calls(name):
            return bg.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')")

        def entry(**kw):
            base = {"id": 1, "kind": "cloud", "title": "\u201cPolyn\u201d \u2192 cloud",
                    "folder": "/rec/X", "take_number": 1, "state": "running",
                    "fraction": 0.64, "step": "Encoding the mix", "error": None,
                    "detail": None, "retry": None, "seen": False}
            base.update(kw)
            return base

        def set_activity(entries):
            bg.evaluate(f"() => {{ window.__ACTIVITY__ = {json.dumps(entries)}; }}")

        button = "button[aria-label^='Background work']"

        def button_says(want, timeout=4000):
            """Waits for the button's words to be `want` — a poll away, and
            with nothing running the poll is two seconds apart."""
            try:
                bg.wait_for_function(
                    "([sel, want]) => { const b = document.querySelector(sel);"
                    " return !!b && b.innerText.trim() === want }",
                    arg=[button, want], timeout=timeout)
                return True
            except Exception:
                return False

        bg.wait_for_timeout(2500)
        ok("with nothing running or finished there is no button",
           bg.locator(button).count() == 0)

        set_activity([entry()])
        bg.wait_for_selector(button, timeout=4000)
        ok("something running brings it, saying how many",
           "1 running" in bg.locator(button).get_attribute("aria-label"))
        ok("and says so in words, not only a ring",
           button_says("1 working · 64%"))
        set_activity([entry(), entry(id=9, take_number=9, state="waiting",
                                     fraction=0.0, step=None)])
        bg.wait_for_timeout(900)
        ok("and a copy that waits is said to wait, not to run",
           "1 running, 1 waiting" in bg.locator(button).get_attribute("aria-label"))
        ok("the words count both, and how far along the two are together",
           button_says("2 working · 32%"))
        set_activity([entry(id=9, take_number=9, state="waiting",
                            fraction=0.0, step=None)])
        ok("with nothing running yet, only waiting, it says waiting",
           button_says("1 waiting"))
        set_activity([entry()])
        bg.click(button)
        bg.wait_for_selector("text=Encoding the mix", timeout=2000)
        ok("its list says what is running and how far along",
           bg.locator("text=64%").count() >= 1)
        ok("opening the list marks what is in it seen",
           len(bg_calls("activity_seen")) >= 1)
        bg.screenshot(path=str(SHOTS / "62-activity.png"))

        set_activity([entry(state="done", fraction=1.0, step=None,
                            detail="MP3 of the mix")])
        bg.wait_for_selector("[data-notice='done']:has-text('is in the cloud folder')",
                             timeout=4000)
        ok("a copy that finished says so in the corner", True)
        ok("and moves to Done in the list",
           bg.locator("text=MP3 of the mix").count() >= 1)

        set_activity([entry(state="done", fraction=1.0, step=None,
                            detail="MP3 of the mix"),
                      entry(id=2, title="\u201cTake 3\u201d \u2192 cloud",
                            take_number=3, state="running")])
        bg.wait_for_timeout(1000)
        set_activity([entry(state="done", fraction=1.0, step=None,
                            detail="MP3 of the mix"),
                      entry(id=2, title="\u201cTake 3\u201d \u2192 cloud",
                            take_number=3, state="failed", fraction=0.2,
                            step=None, error="The cloud folder is gone",
                            retry="mix")])
        bg.wait_for_selector("[data-notice='error']:has-text('Could not copy')",
                             timeout=4000)
        ok("a copy that failed says so in the corner, and stays",
           "The cloud folder is gone" in bg.locator("[data-notice='error']").inner_text())
        bg.screenshot(path=str(SHOTS / "63-activity-done.png"))
        bg.wait_for_timeout(600)
        ok("what finishes while the list is open counts as seen",
           bg.evaluate("() => window.__ACTIVITY__.every(e => e.seen)"))
        bg.get_by_role("button", name="Retry").click()
        bg.wait_for_timeout(300)
        ok("Retry asks Python for that copy again",
           [c["args"] for c in bg_calls("retry_cloud")] == [[2]])
        # Refused — the rehearsal was renamed or the take deleted since:
        # the button must not simply do nothing.
        bg.evaluate("() => { window.__RETRY_REFUSED__ = 'Rehearsal not found'; }")
        bg.get_by_role("button", name="Retry").click()
        bg.wait_for_selector("[data-notice='error']:has-text('Rehearsal not found')",
                             timeout=2000)
        ok("a retry that is refused says why", True)
        bg.evaluate("() => { window.__RETRY_REFUSED__ = null; }")

        bg.get_by_role("button", name="Clear").click()
        bg.wait_for_timeout(2600)
        ok("clearing the finished ones leaves nothing, and no button",
           len(bg_calls("clear_activity")) == 1 and bg.locator(button).count() == 0)
        seen_before = len(bg_calls("activity_seen"))
        set_activity([entry(id=3, take_number=4)])
        bg.wait_for_selector(button, timeout=4000)
        ok("a later copy brings it back", bg.locator(button).count() == 1)

        # A copy that fails between two polls — a cloud folder on a drive
        # that is not plugged in fails in milliseconds — was never seen
        # running, and must still be said.
        set_activity([entry(id=4, title="\u201cTake 5\u201d \u2192 cloud",
                            take_number=5, state="failed", fraction=0.0,
                            step=None, error="Could not open the cloud folder",
                            retry="mix")])
        bg.wait_for_selector("[data-notice='error']:has-text('Take 5')", timeout=4000)
        ok("a copy that failed before it was ever seen running still says so", True)
        bg.wait_for_timeout(600)
        ok("and after Clear the list is closed: a new failure stays unseen, the dot red",
           "not yet seen" in (bg.locator(button).get_attribute("aria-label") or "")
           and len(bg_calls("activity_seen")) == seen_before)
        ok("a failure nobody has looked at says how many failed",
           button_says("1 failed"))
        bg.wait_for_timeout(400)  # the button's colour eases in
        bg.screenshot(path=str(SHOTS / "64-activity-failed.png"))
        set_activity([entry(id=5, state="done", fraction=1.0, step=None,
                            detail="MP3 of the mix")])
        ok("work that went well and was not looked at says Done",
           button_says("Done"))
        bg.wait_for_timeout(400)  # the button's colour eases in
        bg.screenshot(path=str(SHOTS / "65-activity-done-closed.png"))
        set_activity([entry(id=5, state="done", fraction=1.0, step=None,
                            detail="MP3 of the mix", seen=True)])
        ok("once looked at, it stays until Clear, but says nothing",
           button_says("") and bg.locator(button).count() == 1)
        bg.wait_for_timeout(400)  # the button's colour eases in
        bg.screenshot(path=str(SHOTS / "66-activity-quiet.png"))
        bg.close()

        # Finished has no header of its own, and it is where a copy started
        # by the last take is still running when people decide to quit.
        fin = browser.new_page(viewport={"width": 1180, "height": 820})
        fin.add_init_script("window.__ACTIVITY__ = [];" + MOCK)
        fin.goto(server.base_url, wait_until="networkidle")
        fin.wait_for_selector("text=Start rehearsal")
        fin.click("text=Start rehearsal")
        fin.wait_for_selector("text=Record take 1")
        fin.click("button:has-text('Finish')")
        fin.wait_for_selector("text=Rehearsal finished", timeout=4000)
        fin.evaluate("() => { window.__ACTIVITY__ = [" + json.dumps(entry()) + "]; }")
        fin.wait_for_selector(button, timeout=4000)
        ok("the Finished screen shows what is still being copied", True)
        fin.close()

        print("\n[12p] Long work shows its progress where it runs")
        here = browser.new_page(viewport={"width": 1180, "height": 820})
        here.add_init_script("window.__ACTIVITY__ = [];" + MOCK)
        here.goto(server.base_url, wait_until="networkidle")

        def hold(name):
            here.evaluate("""name => { window.__HOLD__ = window.__HOLD__ || {};
                window.__HOLD__[name] = new Promise(r => { window['__RELEASE_' + name] = r; }); }""",
                          name)

        def release(name):
            here.evaluate("name => { window['__RELEASE_' + name](); delete window.__HOLD__[name]; }",
                          name)

        def running(kind, fraction, **kw):
            e = {"id": 50, "kind": kind, "title": kind, "folder": None,
                 "take_number": None, "state": "running", "fraction": fraction,
                 "step": None, "error": None, "detail": None, "retry": None,
                 "seen": False}
            e.update(kw)
            here.evaluate(f"() => {{ window.__ACTIVITY__ = [{json.dumps(e)}]; }}")

        here.wait_for_selector("text=Start rehearsal")
        here.click("text=Start rehearsal")
        here.wait_for_selector("text=Record take 1")
        here.click("text=Record take 1")
        here.wait_for_selector("button:has-text('Stop')")
        hold("stop_take")
        here.click("button:has-text('Stop')")
        # Python registers the entry part-way into the call, after the poll
        # the screen asked for has already come back empty.
        here.wait_for_timeout(700)
        running("stop", 0.45, folder="/tmp/draft", take_number=1)
        here.wait_for_selector("text=Saving the take… 45%", timeout=1200)
        ok("a take being saved says how far along it is, under Stop — "
           "even when its entry arrives after the first look", True)
        release("stop_take")
        here.wait_for_selector("text=Save take")

        hold("crop_draft")
        drag_region(here, 0.25, 0.75)
        here.click("button[aria-label='Crop to the region']")
        here.wait_for_selector("text=Keep only")
        running("crop", 0.4, folder="/tmp/draft")
        here.get_by_role("button", name="Crop", exact=True).click()
        here.wait_for_selector("text=Cropping… 40%", timeout=4000)
        ok("a take under review being cropped says how far along it is", True)
        release("crop_draft")
        here.evaluate("() => { window.__ACTIVITY__ = []; }")
        here.wait_for_timeout(600)
        ok("and the line goes when it is done",
           here.locator("text=Cropping…").count() == 0)

        # Saved, and cropped again from the rehearsal screen.
        here.fill("#take-name", "Polyn")
        here.click("text=Save take")
        here.wait_for_selector("text=Record take 2")
        here.click("button[aria-label^='Take 1 Polyn']")
        here.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
        hold("crop_take")
        drag_region(here, 0.25, 0.75)
        here.click("button[aria-label='Crop to the region']")
        here.wait_for_selector("text=Keep only")
        started_as = here.evaluate(
            "() => window.__CALLS__.filter(c => c.name === 'start_rehearsal')[0].args[0]")
        running("crop", 0.4, folder="/rec/" + started_as, take_number=1)
        here.get_by_role("button", name="Crop", exact=True).click()
        here.wait_for_selector("text=Cropping… 40%", timeout=4000)
        ok("a saved take being cropped says how far along it is, by the player",
           True)
        release("crop_take")
        here.close()

        dr = browser.new_page(viewport={"width": 1180, "height": 820})
        dr.add_init_script(
            """window.__ACTIVITY__ = [];
               window.__DRAFTS__ = [{dir:'/rec/old/_drafts/take 1', name:'take 1',
                 tracks:['Guitar','Vocals'], duration_sec:95,
                 rehearsal_folder:'/rec/old', rehearsal_name:'Tuesday jam',
                 created_at:'2026-09-10T19:00:00'}];""" + MOCK)
        dr.goto(server.base_url, wait_until="networkidle")
        dr.wait_for_selector("text=Unsaved takes found", timeout=8000)
        here = dr
        hold("recover_draft")
        running("recover", 0.3, folder="/rec/old/_drafts/take 1")
        dr.get_by_role("button", name="Recover").click()
        dr.wait_for_selector("text=Recovering… 30%", timeout=4000)
        ok("a take being recovered says how far along it is, in its row", True)
        release("recover_draft")
        dr.close()

        print("\n[12q] The recording screen reads from across the room")
        # Nobody stands at the laptop while they play, so the screen is read
        # from behind the kit: one line that says what is wrong, and a tile per
        # track that lights up. A clip is remembered for a minute, because
        # nobody was looking at the moment it happened. The page's clock is
        # a fake one so that the minute can pass without waiting for it.
        def names_on(pg):
            """How each tile writes its track's name: up the tile, in one
            piece, from its bottom left corner — "Overheads" broken into
            "Overhea / ds" across a narrow tile is what this replaced."""
            return pg.evaluate("""() =>
              [...document.querySelectorAll('main [role=group]')].map(tile => {
                const el = tile.querySelector('[data-name]');
                if (!el) return {name: tile.getAttribute('aria-label'), found: false};
                const t = tile.getBoundingClientRect(), r = el.getBoundingClientRect();
                const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
                return {
                  name: tile.getAttribute('aria-label'), found: true,
                  upward: cs.writingMode === 'vertical-rl' && cs.transform !== 'none',
                  oneLine: r.width < size * 1.6,
                  whole: el.scrollHeight <= el.clientHeight + 1,
                  corner: r.left - t.left < 24 && t.bottom - r.bottom < 24,
                };
              })""")

        def names_ok(pg):
            names = names_on(pg)
            return bool(names) and all(
                n["found"] and n["upward"] and n["oneLine"] and n["whole"]
                and n["corner"] for n in names), names

        far = browser.new_page(viewport={"width": 1180, "height": 820})
        far.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        far.clock.install()
        far.add_init_script(
            "window.__LEVELS__ = {'Guitar':[0.5], 'Vocals':[0.5]};" + MOCK)
        far.goto(server.base_url, wait_until="networkidle")
        far.wait_for_selector("text=Start rehearsal")
        far.click("text=Start rehearsal")
        far.wait_for_selector("text=Record take 1")
        far.click("text=Record take 1")
        far.wait_for_selector("button:has-text('Stop')")
        far.click("button:has-text('Stop')")
        far.wait_for_selector("#take-name")
        far.fill("#take-name", "Vesna")
        far.click("text=Save take")
        far.wait_for_selector("text=Record take 2")
        far.click("text=Record take 2")
        far.wait_for_selector("button:has-text('Stop')")

        def levels(guitar, vocals):
            far.evaluate(f"() => {{ window.__LEVELS__ = "
                         f"{{'Guitar':[{guitar}], 'Vocals':[{vocals}]}}; }}")

        def said():
            return (text_of(far.get_by_role("status", name="Take status")) or "")

        def until(js, timeout=6000):
            """Waits for the page to get somewhere, not for a length of time:
            the macOS runner stretches short timers, and a poll that comes
            late must not turn three clips into two. False if it never does,
            so that the check after it fails rather than the run stopping."""
            try:
                far.wait_for_function(js, timeout=timeout)
                return True
            except Exception:
                print(f"       (waited {timeout // 1000} s and it never happened: {js})")
                return False

        def vocals_at(level):
            """Until the Vocals tile shows this level: the page has polled."""
            return until("() => document.querySelector(\"main [role=group]"
                         f"[aria-label='Vocals'] [data-side]\")?.dataset.level === '{level}'")

        def saying(text):
            return until("() => document.querySelector(\"[role=status]"
                         f"[aria-label='Take status']\")?.innerText.trim() === {json.dumps(text)}")

        def vocals_silent(yes):
            return until("() => (document.querySelector(\"main [role=group]"
                         "[aria-label='Vocals']\")?.dataset.silent !== undefined) === "
                         + ("true" if yes else "false"))

        def polled():
            """Until the page has asked for the levels twice more, so that
            what is on the tiles comes from after whatever the test did."""
            n = far.evaluate("() => window.__LEVEL_POLLS__ || 0")
            return until(f"() => (window.__LEVEL_POLLS__ || 0) >= {n + 2}")

        def timer_like(pattern):
            return until("() => /" + pattern + "/.test(document.querySelector("
                         "\"[role=timer]\")?.innerText.trim() ?? '')")

        vocals_at(50)
        saying("All 2 tracks recording")

        ok("a second go at a song is measured against the first",
           far.get_by_text("Vesna took 0:06 last time", exact=True).count() == 1)
        against = far.get_by_role("progressbar", name="Against the last go")
        ok("on a bar that fills as the band gets further into it",
           against.count() == 1 and attr_of(against, "aria-valuemax") == "6")
        ok("all fine is said too, so that no news reads as good news",
           said() == "All 2 tracks recording")

        for _ in range(3):
            levels(0.5, 0.99)
            vocals_at(99)
            levels(0.5, 0.5)
            vocals_at(50)
        vocals = far.get_by_role("group", name="Vocals")
        guitar = far.get_by_role("group", name="Guitar")
        ok("three clips are counted as three", said() == "Vocals clipped 3 times in the last minute")
        ok("the tile that clipped says so",
           attr_of(vocals, "data-clipped") is not None
           and "clipped 3×" in (text_of(vocals) or ""))
        ok("and the one that did not stays quiet about it",
           attr_of(guitar, "data-clipped") is None)
        far.screenshot(path=str(SHOTS / "53-recording-clipped.png"))

        far.clock.fast_forward(61_000)
        saying("All 2 tracks recording")
        timer_like(r"^1:0\d$")
        ok("a minute without clipping and the line is back to all fine",
           said() == "All 2 tracks recording")
        ok("and so is the tile", attr_of(vocals, "data-clipped") is None)
        ok("the clock goes on in minutes past the first",
           re.fullmatch(r"1:0\d", (text_of(far.get_by_role("timer")) or ""))
           is not None)

        # A quiet singer is not a dead input: with the gain set for the
        # loudest hit, whole passages sit around −48 dBFS.
        levels(0.5, 0.004)
        vocals_at(0)
        far.clock.fast_forward(2_000)
        polled()
        ok("a track playing quietly, at -48 dBFS, is not called silent",
           attr_of(vocals, "data-silent") is None)
        levels(0.5, 0.0005)
        vocals_silent(True)
        ok("a track gone quiet dims, with no alarm: a singer between verses is quiet",
           attr_of(vocals, "data-silent") is not None
           and said() == "All 2 tracks recording")
        levels(0.5, 0.5)
        vocals_silent(False)
        ok("and lights up again the moment it plays",
           attr_of(vocals, "data-silent") is None)

        # The fill is in dB, as on the desk. A band sets its gain for the
        # loudest hit to reach about −18 dBFS, which on a straight scale was
        # an eighth of the tile: "much lower than on the mixer".
        reach = """() => {
          const side = document.querySelector(
            "main [role=group][aria-label='Vocals'] [data-side='1']");
          const fill = side && side.querySelector('[data-fill]');
          return side && fill
            ? fill.getBoundingClientRect().height / side.getBoundingClientRect().height
            : 0;
        }"""
        levels(0.5, 0.126)
        vocals_at(13)
        until(f"() => {{ const r = ({reach})(); return r > 0.65 && r < 0.75; }}")
        ok("-18 dBFS fills about seven tenths of the tile, as it would on the desk",
           0.65 < far.evaluate(reach) < 0.75)

        # A meter rises at once and falls back at a steady rate, as on the
        # desk. Dropping to each poll's level made a voice blink: in dB the
        # quiet between two syllables is half a tile.
        levels(0.5, 0.5)
        vocals_at(50)
        until(f"() => ({reach})() > 0.85")
        levels(0.5, 0.0005)
        vocals_at(0)
        ok("a tile falls back, rather than dropping the moment the sound does",
           far.evaluate(reach) > 0.3)
        far.clock.fast_forward(3_000)
        until(f"() => ({reach})() < 0.05")
        ok("and is at the bottom within a few seconds", far.evaluate(reach) < 0.05)

        # The figure is the peak the line holds, not the last poll's: that
        # changed fourteen times a second, and what the eye kept of it was
        # the troughs between the hits.
        levels(0.5, 0.5)
        vocals_at(50)
        levels(0.5, 0.126)
        vocals_at(13)
        ok("the figure on a tile holds the latest peak",
           "-6.0 dB" in (text_of(vocals) or ""))
        far.clock.fast_forward(2_000)
        until("() => document.querySelector(\"main [role=group]"
              "[aria-label='Vocals']\")?.innerText.includes('-18.0')")
        ok("and comes down to the level once the hold is over",
           "-18.0 dB" in (text_of(vocals) or ""))

        levels(0.5, 0.99)
        vocals_at(99)
        far.evaluate("() => { window.__LOW_SPACE__ = true; }")
        saying("Running out of space")
        ok("running out of disk outranks a clip: it is what ends the take",
           said() == "Running out of space"
           and attr_of(vocals, "data-clipped") is not None)
        far.evaluate("() => { window.__LOW_SPACE__ = false; }")

        far.clock.fast_forward(3_600_000)
        timer_like(r"^1:0\d:\d\d$")
        ok("and past an hour it says the hours",
           re.fullmatch(r"1:0\d:\d\d", (text_of(far.get_by_role("timer")) or ""))
           is not None)
        # Two tracks give wide tiles, and the name is written the same way
        # there: one way to read a tile, whatever the band.
        fine, names = names_ok(far)
        ok("on a wide tile too the name runs up it from the bottom left", fine)
        if not fine:
            print("       ", names)
        far.close()

        print("\n[12q cont.] Sixteen tracks still fit in one row")
        # The XR18 has sixteen inputs and a stereo pair besides. However many
        # of them are recorded, every track is one tile of one width in one
        # row, a stereo one split down the middle — never a second row, never
        # a scrollbar.
        wide_tracks, channel = [], 1
        for name in ("Kick", "Snare", "Hi-hat", "Tom 1", "Tom 2", "Floor tom",
                     "Overheads", "Bass", "Guitar 1", "Guitar 2", "Keys",
                     "Acoustic", "Vocals", "Backing 1", "Backing 2", "Sax"):
            stereo = name in ("Overheads", "Keys")
            wide_tracks.append({"name": name, "channel": channel, "stereo": stereo})
            channel += 2 if stereo else 1
        wide_levels = {t["name"]: ([0.4, 0.0] if t["name"] == "Keys" else
                                   [0.4, 0.4] if t["stereo"] else [0.4])
                       for t in wide_tracks}
        wide = browser.new_page(viewport={"width": 1180, "height": 820})
        wide.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        wide.add_init_script(
            f"window.__SESSION_TRACKS__ = {json.dumps(wide_tracks)};"
            f"window.__LEVELS__ = {json.dumps(wide_levels)};" + MOCK)
        wide.goto(server.base_url, wait_until="networkidle")
        wide.wait_for_selector("text=Start rehearsal")
        wide.click("text=Start rehearsal")
        wide.wait_for_selector("text=Record take 1")
        wide.click("text=Record take 1")
        wide.wait_for_selector("button:has-text('Stop')")
        wide.wait_for_timeout(600)

        def row():
            return wide.evaluate("""() => {
              const tiles = [...document.querySelectorAll('main [role=group]')]
                .map(el => el.getBoundingClientRect());
              const main = document.querySelector('main');
              return {
                count: tiles.length,
                tops: [...new Set(tiles.map(r => Math.round(r.top)))],
                widths: tiles.map(r => r.width),
                right: Math.max(...tiles.map(r => r.right)),
                window: window.innerWidth,
                sideways: document.documentElement.scrollWidth > window.innerWidth,
                scrolls: main.scrollHeight > main.clientHeight + 1,
              };
            }""")

        for width, height in ((1180, 820), (1024, 640)):
            wide.set_viewport_size({"width": width, "height": height})
            wide.wait_for_timeout(300)
            r = row()
            ok(f"at {width}×{height} all sixteen tracks are in one row",
               r["count"] == 16 and len(r["tops"]) == 1)
            ok(f"at {width}×{height} a stereo tile is as wide as a mono one",
               bool(r["widths"]) and max(r["widths"]) - min(r["widths"]) < 1)
            ok(f"at {width}×{height} nothing scrolls, either way",
               r["right"] <= r["window"] and not r["sideways"] and not r["scrolls"])
            fine, names = names_ok(wide)
            ok(f"at {width}×{height} every name runs up its tile from the bottom "
               "left, whole and on one line", fine)
            if not fine:
                print("       ", [n for n in names if not all(n.values())])
            if width == 1180:
                wide.screenshot(path=str(SHOTS / "54-recording-sixteen.png"))
        keys = wide.get_by_role("group", name="Keys")
        ok("a stereo tile shows both sides, each on its own",
           attr_of(keys, "data-channels") == "2"
           and keys.locator("[data-side]").count() == 2)
        ok("so a side that has gone dead shows as dead",
           attr_of(keys.locator("[data-side='2']"), "data-level") == "0")
        wide.close()

        print("\n[12r] Under the hood says what the app runs on, and checks the interface")
        # The page someone opens when something has gone wrong: what this
        # copy is and runs on, where it keeps things, a report to paste into
        # a message, and --audio-probe for someone with no command line.
        hood_ctx = browser.new_context(viewport={"width": 1180, "height": 900},
                                       permissions=["clipboard-read", "clipboard-write"])
        hood = hood_ctx.new_page()
        hood.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        hood.add_init_script("window.__CHECK_MS__ = 900;" + MOCK)
        hood.goto(server.base_url, wait_until="networkidle")
        hood.wait_for_selector("text=Start rehearsal")
        hood.get_by_role("button", name="Settings").click()
        hood.wait_for_selector("#input-device")
        hood.get_by_role("button", name="Under the hood", exact=True).first.click()

        def hood_calls(name):
            return hood.evaluate(f"() => window.__CALLS__.filter(c => c.name === '{name}')")

        def hood_until(js, timeout=5000):
            try:
                hood.wait_for_function(js, timeout=timeout)
                return True
            except Exception:
                return False

        hood_until("() => document.querySelector(\"[aria-label='About this copy']\")")
        about = hood.locator("[aria-label='About this copy']")
        ok("it says which version this is, and that it runs from source",
           "0.2.0" in (text_of(about) or "") and "from source" in (text_of(about) or ""))
        systems = hood.get_by_role("list", name="Audio systems")
        ok("the audio systems on the machine, each with its devices",
           systems.count() == 1 and systems.get_by_role("listitem").count() == 3
           and "ASIO" in (text_of(systems) or ""))
        ok("the one the interface records through stands out",
           attr_of(systems.get_by_role("listitem").filter(has_text="ASIO"),
                   "data-in-use") is not None)
        ok("what it records with",
           "X32 USB" in (text_of(hood.locator("main")) or ""))

        hood.get_by_role("button", name="Copy details for a bug report").click()
        copied = hood_until("() => [...document.querySelectorAll('button')]"
                            ".some(b => b.innerText.includes('Copied'))")
        ok("Copy details puts the report on the clipboard, and says so",
           copied and len(hood_calls("bug_report")) == 1
           and hood.evaluate("() => navigator.clipboard.readText()")
           .startswith("Rehearsal Recorder 0.2.0"))

        hood.get_by_role("button", name="Show the crash log").click()
        hood.wait_for_timeout(200)
        shown = hood_calls("show_file")
        ok("Show opens the crash log's folder",
           len(shown) == 1 and shown[0]["args"] == ["crash_log"])
        hood.get_by_role("button", name="Releases on GitHub").click()
        hood.wait_for_timeout(200)
        ok("and the releases page opens in the browser, not in the window",
           len(hood_calls("open_releases")) == 1)

        check = hood.locator("[aria-label='Interface check']")
        hood.get_by_role("button", name="Check the interface").click()
        ok("while it listens it says so, and what to do meanwhile",
           hood_until("() => document.querySelector(\"[aria-label='Interface check']\")"
                      "?.innerText.includes('Listening to X32 USB')"))
        ok("and it can be stopped", hood.get_by_role("button", name="Stop").count() == 1)
        ok("a card that works says so",
           hood_until("() => document.querySelector(\"[aria-label='Interface check']\")"
                      "?.innerText.includes('X32 USB works')"))
        inputs = check.get_by_role("list", name="Inputs with signal")
        ok("with each input it opened, and the ones sound came in on lit",
           inputs.get_by_role("listitem").count() == 6
           and inputs.locator("[data-signal]").count() == 3)
        hood.screenshot(path=str(SHOTS / "60-under-the-hood.png"), full_page=True)

        hood.evaluate("() => { window.__CHECK_RESULT__ = 'silent'; }")
        hood.get_by_role("button", name="Check again").click()
        ok("a card that sends only silence is not called working",
           hood_until("() => document.querySelector(\"[aria-label='Interface check']\")"
                      "?.innerText.includes('X32 USB opens and sends, but every input is silent')")
           and attr_of(check, "data-state") == "silent")

        hood.evaluate("() => { window.__CHECK_RESULT__ = 'no_sound'; }")
        hood.get_by_role("button", name="Check again").click()
        ok("a card that does not work says what is wrong, and what to do",
           hood_until("() => document.querySelector(\"[aria-label='Interface check']\")"
                      "?.innerText.includes('The card opens, but sends no sound')")
           and "delivers little or nothing" in (text_of(check) or ""))
        ok("with every way it was tried",
           "The first two channels only" in (text_of(check) or ""))
        hood.screenshot(path=str(SHOTS / "61-under-the-hood-fails.png"), full_page=True)

        hood.evaluate("() => { window.__CHECK_MS__ = 60000; }")
        hood.get_by_role("button", name="Check again").click()
        hood_until("() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Stop')")
        hood.get_by_role("button", name="Stop").click()
        ok("Stop stops it, and it says it was stopped",
           hood_until("() => document.querySelector(\"[aria-label='Interface check']\")"
                      "?.innerText.includes('Stopped')")
           and len(hood_calls("stop_interface_check")) == 1)
        hood_ctx.close()

        print("\n[12r] An open dropdown keeps its keys")
        # A dropdown's list is not a dialog, and the screen's keys used to
        # reach through it: Space picking an input started the rehearsal,
        # and Escape closing a list left Settings along with it.
        drop = browser.new_page(viewport={"width": 1180, "height": 820})
        drop.add_init_script(MOCK)
        drop.goto(server.base_url, wait_until="networkidle")
        drop.wait_for_selector("text=Start rehearsal")

        def drop_calls(name):
            return drop.evaluate(
                f"() => window.__CALLS__.filter(c => c.name === '{name}')")

        drop.locator("button[role='combobox']").first.click()
        drop.wait_for_selector("[role='listbox']")
        drop.keyboard.press("Space")
        drop.wait_for_timeout(400)
        ok("Space in an open list picks from it, and starts nothing",
           len(drop_calls("start_rehearsal")) == 0)
        drop.click("button[aria-label='Settings']")
        drop.wait_for_selector("#output-device")
        drop.click("#output-device")
        drop.wait_for_selector("[role='listbox']")
        drop.keyboard.press("Escape")
        drop.wait_for_selector("[role='listbox']", state="detached")
        ok("Escape in an open list closes the list and not Settings",
           drop.locator("#output-device").count() == 1)
        drop.keyboard.press("Escape")
        try:
            drop.wait_for_selector("text=Start rehearsal", timeout=4000)
        except Exception:
            pass
        ok("and the next Escape leaves Settings",
           drop.locator("#output-device").count() == 0)
        drop.close()

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
