# A track can be stereo

Some instruments have two outputs — a keyboard, a stereo pair over a drum
kit, a room mic — and recording either of them into one mono file throws
away half of what arrived.

## Why

A track is one name and one input, and the recorder takes one column out of
the incoming block for it (`capture.py:126`) and writes a wav header saying
one channel (`capture.py:261`). A keyboard plugged into inputs 9 and 10 can
be recorded as two tracks, but then it is two tracks: two lanes in the
player, two faders, two files, and nothing says they belong together.

The reading side is further along than the writing side and hides a hole.
The player opens a multichannel file and keeps the first channel only
(`player.py:78, 86`), so a stereo file plays as its left channel with no
warning. Trimming already preserves the channel count (`crop.py:71, 97`).
The mix builds a stereo file by doubling a mono sum (`mixdown.py:80`).

A stereo instrument arrives on two adjacent inputs. That is how a desk is
laid out, and it is the only shape this design supports.

## Part 1 — What is stored

A band member is a name and whether the instrument is stereo:

```json
"tracks": [{"name": "Guitar"}, {"name": "Keys", "stereo": true}]
```

Stereo belongs to the band rather than to an interface: a keyboard has two
outputs wherever it is plugged in. An interface's entry in `layouts` holds
the first of the two inputs, unchanged from a mono track's:

```json
{"device": {"name": "X AIR XR18", "host_api": "ASIO"},
 "inputs": {"Guitar": 3, "Keys": 9}}
```

A stereo track on input 9 occupies inputs 9 and 10.

A member written as a bare string is mono. Converting a config written
before stereo existed turns each string into `{"name": <the string>}`.

## Part 2 — What a track is, in flight

A track handed to the recorder, the signal check or a rehearsal is
`{"name": str, "channel": int | null, "stereo": bool}`. `channel` is the
first input, counted from 1, as it is today; `stereo` defaults to false
where it is absent, so every caller that predates stereo keeps working.

A stereo track needs `channel` and `channel + 1` to exist on the card. Where
`channel + 1` is past the card's input count the track has no input at all
(`channel` is null), which is the state Part 4 of the layout design already
refuses to start a rehearsal on.

Two tracks may not claim the same input. A stereo track claims two.

## Part 3 — Recording

`AudioRecorder` takes two columns from the incoming block for a stereo
track, interleaved left then right, and writes them to the track's `.raw`
file. `raw_to_wav()` writes a header of two channels for such a file.

The scratch buffer a stereo track writes through holds two samples per
frame. Nothing is allocated on the audio thread, as now.

A take interrupted by a crash recovers unchanged: the `.raw` file already
holds the final bytes in their final order, and recovery adds the header.
Recovery reads the channel count from the draft's record rather than
assuming one.

## Part 4 — Playback

A stereo track's two channels go to the two outputs: left to left, right to
right. `_open_track()` keeps both channels of a two-channel file instead of
discarding the second.

Volume, mute and solo apply to a stereo track as they do to a mono one.
There is no balance control: a rehearsal is not panned.

The level a stereo track reports is the louder of its two channels. The
signal check answers "is the keyboard on the keyboard track", not "which of
these two microphones is quieter", and one bar per track keeps the check
readable at a glance.

The waveform of a stereo track is drawn from the louder of the two channels
at each point, for the same reason.

## Part 5 — The mix

A stereo track contributes its left channel to the left of the mix and its
right to the right. A mono track contributes to both, which is what
doubling a mono sum achieves today.

The mix stays 16-bit stereo. What it is for — a file to send people — does
not change.

## Part 6 — Disk space

A stereo track costs twice a mono one. `disk_estimate()` takes the number of
channels being recorded rather than the number of tracks (`api.py:741-751`),
so the estimate on the setup screen holds when half the band is in stereo.

## Part 7 — What the screens show

A track's input control offers a pair for a stereo track, written as the
card's own labels count them: `Inputs 9–10`. A mono track's control is
unchanged.

A track carries a stereo switch. Turning it on for a track whose next input
is taken, or past the end of the card, leaves the track without an input,
which the setup screen already names and refuses to start on.

The level meter shows one bar per track, stereo or not.

## What this does not do

No track is wider than two channels. A surround rig is not what a rehearsal
room has.

The two inputs of a stereo track are adjacent. A desk lays stereo sources
out in pairs, and supporting an arbitrary pair would double the width of
every input control on the screen to serve a case nobody has.

Takes recorded before this change are mono and stay mono. Nothing rewrites
a recorded file.

A stereo track has no balance or width control, in the player or in the mix.

## Testing

`tests/test_engine.py`, against the stubbed sounddevice:

- a stereo track writes two interleaved channels to its raw file, and its
  wav says two channels
- a mono track is unchanged, byte for byte
- a crashed stereo take recovers as a two-channel wav of the right length
- a stereo track claims its second input: another track cannot have it
- a stereo track whose second input is past the card has no input at all
- the player renders a stereo track's left channel to the left output and
  its right to the right
- a mono track still reaches both outputs
- the level of a stereo track is the louder of its channels
- the mix keeps a stereo track's sides apart, and still doubles a mono one
- the disk estimate counts channels, not tracks
- a config of bare-string members converts to objects, and converting twice
  changes nothing

`tests/test_interface.py`, against the mocked bridge:

- a stereo track's input control reads `Inputs 9–10`
- turning stereo on for a track whose pair does not fit leaves it with no
  input, and the rehearsal will not start
- the level meter shows one bar for a stereo track
