---
date: 2026-10-25
description: Our drummer hates the click. How we kept it out of the vocal mic, why we gave up on it, and how the kit's MIDI saved a track.
---

# When your drummer hates the metronome

After we saw [where our band speeds up](/stories/tempo-drift), the answer looked obvious: play to a click. I had just added a metronome to РЭХА, so I suggested we try it.

Our drummer hates the metronome, and said yes anyway. I should have taken that as a warning.

## The click

A metronome clicks on every beat, a higher click on the first beat of each bar. The drummer plays to the click, and the rest of the band plays to the drummer. That's the idea, anyway.

The first time, the click came out of the monitors. Everyone heard it, which was fine. So did the singer's microphone, which wasn't: on the recording the click ran under the vocals from the first bar to the last.

**The singer has never sounded so steady.**

So the click went to the drummer's headphones and nowhere else. In **Settings › Click & backing track**, under **Click output**, you choose where the click is heard: an interface and its outputs. Pick outputs that feed only the drummer's headphones, or simply the laptop's own headphone socket. On many small interfaces the headphone socket plays the same outputs as the monitors, so listen before you start. РЭХА never records the click itself, so if no microphone hears it, it isn't on the tracks.

## The evening

Then we played. To be exact, the drummer played, and the rest of us stood there holding our instruments.

> **Drummer:** Bloody hell.\
> **Drummer:** What the hell is it doing?\
> **Me:** It's doing 128. Same as a minute ago.\
> **Drummer:** Again.\
> **Drummer:** I hate the metronome!

The whole rehearsal went like that: the drummer against the click, one try after another, with a short drum solo whenever it got really bad.

**The metronome was the only one in the room who enjoyed it.**

We haven't played to a click at a rehearsal since. In the tempo story I said our drummer has views on clicks. Now you know which ones.

## The track

Then we needed to release a track, with drums that sat in time, and a click was out of the question.

So the drummer played it the usual way, and РЭХА recorded the kit's MIDI beside its sound: every hit, which drum, how hard and exactly when, in a `.mid` file next to the take's WAV files. We opened that file in a DAW, a recording program, and moved the hits that had run ahead back into place. A note in a MIDI file moves on its own. A hit on a drum microphone takes the rest of the kit with it.

**The drummer thinks that track is just a very good take. Please don't tell the drummer.**

## The dull bits

On the start screen, put the drum track on **Both**, so it records the kit's sound and its MIDI. Use a cable for the kit: Bluetooth MIDI adds a few milliseconds of uneven delay, and the hits come out a little late and loose.

A `.mid` file says its tempo. A take carries the tempo that was in the metronome's row when you pressed **Record take**, even with the click switched off. With no tempo there, the file is written at 120 bpm. So give the song its tempo before you record.

In the DAW, set the project to the file's tempo, or let the DAW take it from the file, and put the `.mid` at bar 1, where the WAV files start. Then the hits line up with the sound. At any other tempo the notes drift away from the audio, and you spend an evening wondering why.

**We still don't play to a click. We have the tempo line instead, and the drummer likes it because it doesn't click.**
