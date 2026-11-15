# S on several tracks at once (РЭХА and the band service)

In a take's player, **S** plays a track on its own. On 15 November 2026
Alex asked: «нужно сделать чтобы можно было солировать несколько треков в
плеере одновременно» (17:33:19Z). Today **S** holds one track: pressed on a
second track, it goes out on the first. This change lets **S** be on for
several tracks, and every track with **S** on is heard, the rest are
silent. It is the same in РЭХА and in the band service, on a computer and
on a phone.

What Claude found (main at 12f6b8d):

1. One player screen for both. The shared hook keeps one soloed name,
   `soloed: string | null` (`ui/src/hooks/useMultitrackPlayer.ts:100`),
   and its **S** asks the sound for that name or for none (`:556-563`).
   The lanes (`ui/src/components/Timeline.tsx:573, 637-638`) and the
   phone's desk (`service/src/takes/Desk.tsx:53-67, 88, 99`) only ask
   `isSoloed(name)` and `hasSolo`.
2. The sound behind it asks for a name or null: `PlayerSound.setSolo(name
   | null)` (`ui/src/lib/playerSound.ts:30`), and the state brings
   `soloed?: string | null` (`ui/src/lib/api.ts:767`).
3. РЭХА's sound keeps one name: `audio/player.py:129` `_soloed`, the gain
   at `:312`, `set_solo(name)` at `:696`, the state at `:832`; the bridge's
   `player_set_solo(name)` at `api.py:5387`; the stand-in while the sound
   process is gone (`api.py:203-216`) and the take set up again after it
   (`api.py:5463-5476`) read the same `soloed`.
4. The service's sound keeps one index: `Desk.solo: number | null`
   (`service/src/takes/player/desk.ts:3`), the Player (`player.ts:181, 284,
   356-367, 543`), the one player for every take page (`one.tsx:83-95, 255,
   268, 364-373, 399-406`), the take page's sound (`sound.ts:65, 95, 107,
   120, 256-262`) and the desk a take opens with (`backing.ts:33`).
5. **Download** › **The mix** makes the take as you hear it. Its name
   says what you hear: "Viasna 12 - only Guitar.mp3"
   (`service/src/takes/player/mix.ts:24-37`; `Download.tsx:125`).
6. M and S on one track take each other off, in both
   (`desk.ts:5-9`, `player.py:686-700`): Alex's pick of 3 November 2026,
   22:25:21Z, card «Одна снимает другую».
7. The stand-ins for tests, mockups and pictures keep one name too:
   `ui/e2e/fake-bridge.js:162, 2316-2366` and `ui/e2e/band.js:310`.
8. No key and no MIDI controller button presses **S**
   (`docs/using-it.md:1623-1662`, `src/rehearsal_recorder/control.py`).

## Alex's picks

- **Where**, 17:40:40Z card «В сервисе и в РЭХА»: several **S** in the
  band service, on a phone too, and in РЭХА. The service goes up after the
  merge, РЭХА with the next release. The others were the service only and
  РЭХА only.
- **How S adds**, 17:41:12Z card «А. Каждая S добавляет» (mockup
  https://claude.ai/artifact/4kKCfzRUqeJmg4Qea4mb49, sources
  `/mnt/project-files/band-service/multi-solo/q2-mock/`): each **S** adds
  its track to the ones heard, and pressed again takes it away. The same
  on a phone. The other was Ableton's way: **S** alone keeps only its
  track, and with Ctrl or ⌘ adds one, which a phone cannot do.
- **reha.stream**, 17:41:47Z card «А. Одна фраза»: one sentence on the
  band service's page, no new pictures. The other was nothing on the site.
- **The spec**, 17:58:42Z «ок», on the version first sent (36450ce, calls
  1-6). The plan check then added: S on Backing and nothing to sync (under
  "The rest is as today"), "a soloed track" in the guide, S on every track
  in call 2, and calls 7-8. These went to Alex with the plan.
- **The plan**, 18:01:56Z «ок», with those additions.

## What a band member sees

Ivan opens Viasna #12 and presses **S** on Guitar: only the guitar plays,
as today. He presses **S** on Drums: now the guitar and the drums play,
both **S** are yellow, and Bass and Vocals are greyed. He presses **S** on
Guitar again: only the drums play. He presses **S** on Drums: every track
plays again.

The rest is as today:

- **M** on a track with **S** on turns its **S** off; **S** on a muted
  track turns its **M** off. **S** on another track leaves a muted one
  muted.
- **S** on the take's Backing track turns its **M** off, and its song
  then keeps Backing heard, as **M** does (`useMultitrackPlayer.ts:562`,
  `backing.ts:76-80`).
- A track's notes go paler with its waveform when the track is muted, or
  when **S** is on for other tracks and not for it. Notes of a track on
  **MIDI** go paler while **S** is on for any track.
- In the service a take's page keeps its **M** and **S** while another
  take plays, and a take opens with every **S** off. In РЭХА a take opens
  with every **S** off.
- **Download** › **The mix** is the take as you hear it.
- **S** stays on the screen it was pressed on: РЭХА does not send it and
  the service does not keep it, so there is nothing to sync.

## Words

- reha.stream, `site/content/band-service.md:32`, «Hear your own part»:
  "Play yours alone to hear what you really did, or mute it and practise
  along with the band as it played that night." becomes "Play yours alone,
  or with the drums, to hear what you really did. Or mute it and practise
  along with the band as it played that night." (Alex saw the first half
  on the card.)
- The guide, `docs/using-it.md:414-418`: "**M**, after the fader, mutes a
  track, and **S**, after **M**, plays it on its own." becomes "**M**,
  after the fader, mutes a track, and **S**, after **M**, plays it on its
  own. Press **S** on more tracks to hear them together, and again to
  take one away." In the same paragraph, "**M** on the soloed track turns
  its **S** off" becomes "**M** on a soloed track turns its **S** off".
- The guide, `docs/using-it.md:1143-1144`: "when the track is muted or
  another is soloed" becomes "when the track is muted, or other tracks are
  soloed and it is not".
- CHANGELOG, under "Unreleased": "**S on several tracks at once.** Press
  **S** on more than one track to hear them together, and press it again
  to take that track away. In РЭХА's player and in the band service, on a
  phone too."
- README: nothing changes ("volume, mute and solo", `README.md:53`, stays
  true).
- No new words in the app.

## Pictures

None change: no picture of the guide, the service or the site shows
**S** on.

## Claude's calls

1. No button turns every **S** off at once: press each lit **S** again.
2. **Download** › **The mix** with **S** on for several tracks is named
   with them in the take's order: "Viasna 12 - only Drums, Guitar.mp3".
   With **S** on every track it is the take's name alone, "Viasna
   12.mp3", as nothing is left out.
3. The sound is asked per track, as for **M**: `setSolo(name, on)` in the
   shared `PlayerSound`, `player_set_solo(name, on)` in РЭХА's bridge, and
   the state brings `soloed` as a list of names in the take's order. The
   screen and the sound are one build in РЭХА, and the service's page and
   sound one deploy, so nothing reads the old shape.
4. Two quick presses on two **S** both count: each press asks for its own
   track, so one answer cannot undo the other press.
5. The fakes (`fake-bridge.js`, `band.js`) keep a list, as the real sounds
   do.
6. The site's sentence goes up with the merge, with the service. The
   CHANGELOG item waits in "Unreleased" for the next release, which brings
   РЭХА's part.
7. The site's old sentence is split in two; the second reads "Or mute it
   and practise along with the band as it played that night."
8. РЭХА's player takes **S** only for a track the take has, and the
   bridge's `on` has no default, so a screen not rebuilt after a pull
   cannot silence the take.
