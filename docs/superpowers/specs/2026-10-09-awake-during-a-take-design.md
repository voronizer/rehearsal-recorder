# Awake during a take

Nobody touches the laptop while the band plays. Ten minutes into a long jam
the screen goes dark, the Mac locks, and a laptop on battery may go to sleep
on its own timer. РЭХА asks the system for nothing today: it has no sleep
lock of any kind (the findings, with their sources, are in the project
files, `sleep/findings.md`). During a take only an input stream is open,
and neither system promises to stay awake for a stream that records and
plays nothing.

This keeps the laptop and its screen awake for exactly as long as a take
records, says when the battery is about to end it, and, when the laptop goes
to sleep anyway, ends the take at that moment and says why.

## Decisions

Alex decided these on 9 Oct 2026, one question at a time, each on a mockup
built from the app.

- **D1. Build it** (07:02Z, «Да, делаем»).
- **D2. Only while a take records, with no switch.** Decided without a
  question, and Alex was told. The app asks the system to stay awake from
  the start of a take to the end of Stop, the WAVs written included, and
  lets go when the window closes. If the app dies, the system drops the
  request itself. Between takes, during the signal check and while playing
  back it asks for nothing: a system that plays sound stays awake on its
  own, and sleep there loses nothing. Nobody wants the laptop to sleep in
  the middle of a take, so there is nothing to switch.
- **D3. The screen stays on through the whole take** (07:47Z, «A. Горит»,
  [mockup](https://claude.ai/artifact/SmT4pTxug3YdMYhPeYvQ3W)). It goes dark
  as usual after Stop. There is no setting. A Mac usually locks when its
  screen goes dark, and a locked laptop takes neither Stop nor Space.
- **D4. If the laptop sleeps anyway, the take ends there** (08:01Z, «A.
  Дубль кончается», [mockup](https://claude.ai/artifact/7CzhGjRsd6h9Se6w6spUfL)).
  A closed lid, the battery running out or Sleep from the menu: everything
  up to that moment is kept, nothing after it is added, and once the laptop
  is awake a notice says why the take ended:
  *The laptop went to sleep at 21:14, so the take ends there. Everything up
  to that moment is saved.*
- **D5. A low battery shows on the recording screen** (08:20Z, «B. Когда
  садится», [mockup](https://claude.ai/artifact/N5D43mcGYPJXN8jAYeZuNx)). On
  battery at 20% or less, the status line turns yellow:
  *Battery 14%: plug the laptop in*. Otherwise the line is as it is now. 20%
  is where Windows turns its own battery saver on ("By default, battery
  saver will turn on automatically when your battery falls below 20%",
  [Microsoft](https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/battery-saver)).
- **D6. On reha.stream, words** (08:33Z, «B. Слова»,
  [mockup](https://claude.ai/artifact/9iue29PeAJbPFWBvYr2Pjs)). See
  [On reha.stream](#on-rehastream).
- **D7. The README's wrong line is fixed in the same pull request.** It says
  "If the app dies, the laptop sleeps, or someone trips over the interface,
  you lose seconds". For sleep that is not what happens today.

The decisions are also kept in the project files, `sleep/rulings.md`.

## What the band sees

- **During a take** the laptop does not go to sleep by itself and its screen
  does not go dark or lock. On a Mac, App Nap leaves the app alone even with
  its window hidden. After Stop, and once the take's files are written,
  everything is as the system's own settings say again.
- **On battery at 20% or less** the recording screen's status line, top
  right, says *Battery 14%: plug the laptop in*, in the yellow the line
  already uses for a disk running out. Plugged in, or above 20%, it is the
  usual line.
- **If the laptop sleeps anyway**, the take holds what was recorded before
  it slept. When the laptop wakes, the recording screen stops the take
  itself, the notice above stays in the corner until closed, and the take
  opens as any take does after Stop.

Nothing else changes: no new screen, no new setting, no new control.

## Part 1. Keeping awake

A new module, `src/rehearsal_recorder/awake.py`, does it with each system's
own documented call. Both are reached the way the app already reaches the
system: PyObjC on a Mac (`platform_support.py` already imports `AppKit` and
`Foundation`; PyObjC comes with pywebview) and `ctypes` on Windows. No new
library.

```python
class KeepAwake:
    def hold(self):      # a take has started
    def release(self):   # the take is written, or the window has closed
```

`hold()` twice holds once; `release()` with nothing held does nothing. A
call the system refuses is printed and never stops a take: recording
matters more than the lock.

**macOS.** `NSProcessInfo.processInfo().beginActivityWithOptions_reason_(
NSActivityUserInitiated | NSActivityIdleDisplaySleepDisabled, "Recording a
take")`, and `endActivity_(token)` to let go.
`NSActivityUserInitiated` includes `NSActivityIdleSystemSleepDisabled` and
keeps App Nap off; `NSActivityIdleDisplaySleepDisabled` keeps the screen on.
Both names are in PyObjC's Foundation metadata (checked in
pyobjc-framework-Cocoa 12.2.2).

**Windows.** `PowerCreateRequest` with a `REASON_CONTEXT` holding the
reason as a plain string ("РЭХА is recording a take"), then `PowerSetRequest`
for `PowerRequestDisplayRequired`, `PowerRequestSystemRequired` and
`PowerRequestExecutionRequired`; to let go, `PowerClearRequest` for each
and `CloseHandle`. Microsoft's page for
[PowerSetRequest](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest)
says a display request needs a system request beside it, and that user
sleep (lid, power button, Sleep in Start) ends every request. So a request
is made for each take and closed with it, never kept between takes. Chromium
does the same in `power_save_blocker_win.cc`.

**Elsewhere** (Linux, where the app runs only from source) it does nothing.

**Where.** `Api.start_take` holds once `recorder.start()` has succeeded; a
take that could not start holds nothing. `Api.stop_take` releases once the
take's WAVs are written, whether or not that worked. `Api.shutdown` releases
after abandoning a take still recording.

**What a person can check.** During a take, `pmset -g assertions` on a Mac
lists РЭХА with "Recording a take" under the display and system sleep
assertions, and `powercfg /requests` on Windows (from an administrator's
prompt) lists it under DISPLAY, SYSTEM and EXECUTION. After Stop neither
lists it.

**Not known yet: the Mac's screen saver.** Two developers on Apple's forums
report that keeping the display awake does not stop the screen saver, one
of them for every call they tried, and a screen saver set to ask for a
password locks the Mac as a dark screen does
([Apple developer forums](https://developer.apple.com/forums/thread/26776);
nothing there from Apple). Whether the screen saver is on at all by default
on current macOS is not something I could confirm. The manual check below
runs a take past the screen saver's time. If it still starts, I bring Alex
what does stop it before adding anything.

## Part 2. When the laptop sleeps anyway

No app can stop a closed lid, Sleep from the menu, or the system putting
itself to sleep when the battery is about to run out. What the app can do
is notice, and keep the take honest.

**The system says it is going to sleep.** `awake.py` also listens for that,
once, from when the window is up (`Api.attach_window`) until it closes
(`Api.shutdown`):

- **macOS:** `NSWorkspaceWillSleepNotification` on
  `NSWorkspace.sharedWorkspace().notificationCenter()`, observed with
  `addObserverForName_object_queue_usingBlock_`. It is posted on the main
  thread, where pywebview runs the app's run loop.
- **Windows:** `PowerRegisterSuspendResumeNotification` with
  `DEVICE_NOTIFY_CALLBACK`, waiting for `PBT_APMSUSPEND` (Windows 8 and
  later; the app's Python 3.12 needs 8.1 anyway). The system gives an app
  about two seconds for it
  ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/power/pbt-apmsuspend));
  the app only sets a flag.

Either one tells the take being recorded, if there is one, that it fell
asleep now.

**The take sees it for itself.** Microsoft does not say whether a desktop
app hears `PBT_APMSUSPEND` on a laptop with Modern Standby before the system
pauses it ([Microsoft](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/integrating-apps-with-modern-standby)
says only that desktop apps are paused, much as in S3 sleep). So the take
does not depend on hearing it. The audio callback notes the wall-clock time
of each block. Blocks come about every 21 ms; if two come more than
`SLEPT_GAP_SEC` (10 s) apart, the laptop slept between them, at the time of
the first. The health check asks the same of the last block when none has
come since, because the interface itself may not come back after waking.

The wall clock is used because it keeps counting while the laptop sleeps;
the clock the heartbeat uses may not, depending on the system. A person
setting the computer's clock ten seconds or more forward in the middle of a
take would end it the same way, kept up to that moment. That is accepted.

**In the take** (`AudioRecorder`):

- `fell_asleep(at)` sets the take's error to the sleep notice with the time
  it fell asleep, in the same 24-hour form as the rest of the app (21:14),
  and from then on the callback writes nothing. Whatever the stream delivers
  after waking is dropped, so the take ends exactly where the laptop slept
  and nothing from before is lost.
- `problem()` says the sleep notice before it would say the card went
  silent: after a sleep longer than `SLEPT_GAP_SEC`, a card that does not
  come back is reported as the sleep it was, not as an unplugged
  interface. A shorter sleep reads as today's "no sound from the audio
  interface for 3 seconds". Once said, either stays said.

**On the screen** nothing new is built. The recording screen already polls
`recording_health`, and a take with an error is stopped with the error as a
warning notice (`Recording.tsx`), the way an unplugged interface is today.
After waking, the next poll does exactly that with the sleep notice. The
take's length is what was recorded before the sleep.

If the laptop's battery dies outright while it sleeps, the raw files are
where the last 30-second flush left them, and the drafts offer the take at
the next launch as they do after a crash. That is unchanged.

## Part 3. The battery line

**Python.** `awake.battery_percent()` returns the charge, 0 to 100, only
while the laptop runs on its battery; `None` on mains power, with no battery
or when the system cannot say.

- **macOS:** IOKit's power source functions, `IOPSCopyPowerSourcesInfo`,
  `IOPSCopyPowerSourcesList` and `IOPSGetPowerSourceDescription`, loaded
  with PyObjC's `objc.loadBundleFunctions` from the IOKit bundle. On
  battery when the internal battery's `Power Source State` is
  `Battery Power`; the charge is `Current Capacity` over `Max Capacity`.
  The two Copy functions are declared as returning a retained object, so
  nothing leaks on a poll every two seconds.
- **Windows:** `GetSystemPowerStatus`. On battery when `ACLineStatus` is 0;
  no answer when `BatteryFlag` is 128 (no battery) or 255, or
  `BatteryLifePercent` is 255.

Both are cheap calls, made on each health poll while a take records.

**The health check.** `recording_health` gains `battery_percent`, as above.
`RecordingHealth` in `ui/src/lib/api.ts` gains it too.

**The line.** `HealthLine` shows, in this order: an error, a disk running
out (both as today), then, on battery at `LOW_BATTERY` (20) or less, a
battery icon (`BatteryLow`) and *Battery 14%: plug the laptop in* in the
warning yellow, then the usual line. The battery words are shorter than the
usual line, so the line does not wrap where it did not wrap before and
nothing on the screen moves (checked in the mockup at 720 px).

## On reha.stream

Words only, as the mockup showed:

- `site/content/features.md`, *Tells you it is fine while it runs.*: "The
  interface, the disk, the battery, every input: on screen during the take,
  the only moment anyone would act on it."
- `site/content/faq.md`, after *What if the laptop dies in the middle of a
  take?*:

  > **Will the laptop fall asleep in the middle of a take?**
  > No: while a take records, РЭХА keeps the laptop and its screen awake.
  > Closing the lid still puts it to sleep, and the take ends there, with
  > everything before it kept. On battery, the recording screen asks for
  > the charger at 20%.

The site goes out with the next release, as always. Its tile with the
status line keeps the usual line; there is no new tile and no new piece.

## Docs

- **README**, *What it does*: "If the app dies or someone trips over the
  interface, you lose seconds" (sleep moves out of that list), and the
  *Tells you it is fine* paragraph names the battery.
- **docs/using-it.md**, *While recording*: the screen stays on through the
  take, and the corner turns yellow when the battery is at 20% or less.
  *When something goes wrong* gets *The laptop goes to sleep during a take*:
  what is kept, the notice, and that a closed lid always wins.
- **CHANGELOG.md**, *Unreleased*: one entry, *The laptop stays awake during
  a take.*

## Testing

**Python, everywhere** (`tests/test_engine.py`, `tests/test_platform.py`),
with the system's calls replaced by fakes:

- `KeepAwake`: on a fake Mac it begins one activity with both options and
  the reason, and ends that token; on a fake Windows it creates a request
  with the reason, sets the three types, and on release clears all three
  and closes the handle. A second hold holds nothing more. A refusing call
  is printed and does not raise.
- `Api`: a take that starts holds, one that fails to start holds nothing,
  `stop_take` releases even when writing the WAVs fails, `shutdown`
  releases.
- `AudioRecorder`: after `fell_asleep`, blocks are not written and the
  take's length is what came before; `problem()` gives the sleep notice
  with the time. Two blocks 12 s apart on a patched wall clock end the take
  at the first, and the second is not written. With no block for 12 s of
  wall-clock time, `problem()` gives the sleep notice, not the silent card;
  after 4 s it gives the silent card, as today.
- The sleep listener: on a fake Windows, the registered callback with
  `PBT_APMSUSPEND` reaches the take and resume events do not; on a fake
  Mac, the observer is added for the right notification and removed on
  shutdown.
- `battery_percent`: fake power sources and fake `SYSTEM_POWER_STATUS` for
  mains, battery at 14 and 64, no battery, and unknown.

**Python, on the real system** (CI's macOS and Windows runners, skipped
elsewhere): hold and release with the real calls; the sleep listener
registers and unregisters; `battery_percent()` returns `None` or a number
from 0 to 100. This proves the calls are right for the system, which the
fakes cannot.

**The interface** (`ui/e2e`): the fake bridge's `recording_health` takes a
`window.__BATTERY__`. At 14 the recording screen says *Battery 14%: plug the
laptop in*; at 64, or on mains, the usual line; the line keeps its height
either way. With the sleep notice as the health error, the take stops and
the notice shows, as the unplugged interface test does now.

**By hand, on a laptop** (the plan says who and when; the CI runners have
no lid and no battery):

1. Mac: during a take, `pmset -g assertions` lists РЭХА; after Stop it does
   not.
2. Mac: a take left running longer than the display's sleep time and the
   screen saver's time: the screen stays on and nothing locks.
3. Close the lid in the middle of a take for a minute, open it: the notice
   with the time, and the take ends at that moment.
4. On battery under 20%, the status line asks for the charger.
5. The same on a Windows laptop if one is at hand, with `powercfg /requests`
   for step 1.

## Not part of this

- Stopping a closed lid, Sleep from the menu or the system's own low
  battery sleep. No app can (Microsoft says so for Windows on the
  PowerSetRequest page above).
- Keeping awake between takes, during the signal check or while playing
  back.
- A setting for any of it (D2, D3).
- The battery when it is not low (D5).
- Saying anything about a sleep between takes: nothing is lost then.
