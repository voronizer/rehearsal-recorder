---
date: 2026-10-25
description: We used to argue about which bar it was. Now we record each rehearsal from our Behringer XR18, a track per musician. How we do it, and what went wrong.
---

# Record your band's rehearsal from a digital mixer

I play bass in a band, and we never used to record our rehearsals. Every evening ended in the same kind of argument.

> **Guitarist:** You came in late in the second bar.\
> **Me:** No, that was the third.\
> **Drummer:** Bloody hell, you're all playing it wrong!

> **Singer:** Let's change that bit in the chorus.\
> **Guitarist:** Which bit?\
> **Singer:** You know. That bit.

> **Guitarist:** We're speeding up.\
> **Drummer:** No, you're dragging.

Then we started jamming, and it got worse, because now we also had to remember what we'd played.

> **Singer:** What was that riff at the end of the jam?\
> **Guitarist:** Which one?\
> **Singer:** Da-da, da-DUM.\
> **Me:** That's “Smoke on the Water”.

## Now we record

So now we record. Someone says “second bar”, we play the take back and hear who was right.

After the rehearsal the takes go to our Google Drive folder, and everyone listens again at home, where nobody talks over the chorus.

One of our singers takes the instrument tracks home as well, practises over them and tries out words. If we jammed that evening, ideas for a new song arrive afterwards.

That bit with the singer is why a phone in the corner wouldn't do. A phone would settle the arguments, sure. But it records the whole room as one sound, vocals and all, and to give the singer the band without the vocals you need every instrument on a track of its own.

If your band has a digital mixer, you already have that. We use a Behringer XR18: plug its USB cable into a laptop, and each of its channels arrives as a separate track.

## The first evening

The first evening we recorded, I was worried about our two guitarists, whose favourite word at a rehearsal is “more”. More guitar in the monitors, more in the room, a bit more after the break. I was sure we'd get one long guitar solo.

We didn't, and they still got all the “more” they asked for.

The XR18 sends each channel to the laptop before the EQ, the compressor and the fader, so you can push things up and down in the room all night and the recording won't notice.

**What happens at the mixer stays at the mixer.**

## The gain

What the recording does notice is the gain, which on the XR18 you set in its app. We set ours at the soundcheck, where our drummer plays as if there's a baby asleep next door.

**In the first chorus the baby woke up.**

The drums on that take came out as one flat crackle.

Now we set the gain for the loudest chorus of the evening and leave plenty of room at the top of the meter. Don't worry if a track then looks quiet: at 24 bit you can turn it up later and it still sounds clean.

And once we start playing, nobody touches the gain, because every change is a jump in level on the recording.

## A channel each

The mixer can only record what goes into it, so everyone needs a channel of their own.

There are five of us: a singer with a guitar, a second guitarist, a second singer who joined recently and writes good lyrics, the drummer, and me on bass.

Only the two singers need microphones. Both guitars go through processors, the ToneX kind, and the processors plug straight into the mixer.

My bass head, a Gallien-Krueger Fusion, has an XLR output, and a cable from it goes to the mixer. If your amp hasn't got one, a DI box between the bass and the amp does the same job. In the room nobody hears the bass anyway, but on the recording everyone hears exactly where I came in late.

Our drummer plays an electronic kit, a Roland TD-27. It sends a stereo pair to the mixer, and down a USB cable it sends the laptop every hit: which drum, how hard and exactly when. РЭХА saves those as a MIDI file beside the audio.

**At last there's a track in the band nobody can argue with.**

I added MIDI recording to the app not long ago, and the drummer has been very pleased with it ever since.

If your drummer plays an acoustic kit, the drums alone can take more channels than the rest of the band put together.

## The dull bits

A few dull things, quickly.

On a Mac the XR18 needs no driver. On Windows, get the ASIO driver from Behringer's site first, or Windows shows you two inputs and you start wondering where the rest of the band went.

The laptop and the mixer also have to agree on the sample rate.

**They're the only two in our band who agree on anything.**

The XR18 runs at 48 kHz unless you change it in its app, so the laptop records at 48 kHz too.

As for disk space, each track takes about half a gigabyte an hour. Eight tracks over a three-hour rehearsal come to about 12 GB. All 18 would be about 28 GB, so record only the channels that have someone on them.

## The app

And the app. I wrote РЭХА, a free app for macOS and Windows, so we'd stop arguing about which bar it was.

In **Settings**, under **Audio**, you choose the mixer (on Windows, with the **ASIO** driver), 48 kHz for **Rate** and 24 bit for **Depth**.

The start screen has a track for each of us, with a name and an input. The drums are a **Stereo** track on **Both**, so they get the kit's sound and its MIDI. It's all filled in for you next time.

Before each song you press **Record take**. Every track goes to its own WAV file as you play, everything is safely on the disk every 30 seconds, and the laptop doesn't fall asleep halfway through the bridge.

Press **Stop** and you can listen straight away: just the drums, the chorus on repeat, or the bar where the bass came in late.

**Put a mark on that bar, and next week nobody can claim it was the third.**

To get the takes onto Google Drive, choose a folder it syncs as the cloud folder in **Settings › Folders**. **Send starred** copies the takes you starred (★) there. Choose **The original tracks** under **What gets sent**, and your singer gets every instrument on its own track to practise with at home.
