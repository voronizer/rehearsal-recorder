# Louder takes in the band service

On 10 November 2026 Alex said that takes sound quiet in the band service.
His band sets each channel on the mixer at about −18 dB. He asked whether
РЭХА should normalise the tracks to the loudest one before sending them, or
whether there is another way.

This change turns each take up in the service's player by one amount for
all its tracks, so the band's balance stays as it was. РЭХА counts the
amount from the take's files and sends it with the take. The files
themselves stay as recorded.

What Claude found (main at 6399f0d, checked again at a53abae):

1. Nothing turns a take up anywhere. РЭХА sends each track's MP3 and FLAC
   at the level it was recorded at (`src/rehearsal_recorder/sending/service_files.py:222`,
   `src/rehearsal_recorder/audio/encode.py:117`). The faders and Master stop
   at 100% in the service's player (`service/src/takes/player/player.ts:330`,
   `:270`) and in РЭХА's (`src/rehearsal_recorder/audio/player.py:681`, `:713`).
   The cloud folder's mix and the service's **Download** mix turn a take
   down when it would go over full scale and never turn it up
   (`src/rehearsal_recorder/audio/mixdown.py:76`, `service/src/takes/player/mix.ts:65`).
2. Ill never new 14, measured from the FLAC files Alex downloaded from the
   service: 5 tracks of 6 (VOX2 was not among them), 16-bit, 48 kHz. At
   РЭХА's balance it plays at −30.3 LUFS (LUFS: loudness as the ear hears
   it, over the whole take), its loudest sample at −13.1 dBFS. ffmpeg's
   ebur128 gives the same figures. Spotify and YouTube play music at
   −14 LUFS. The tracks' loudest samples: GTR1 −25.3, GTR2 −22.8,
   VOX1 −18.3, BASS −15.1, DRM −9.8 dBFS. The balance turns DRM to 0.64,
   VOX1 to 0.72 and BASS to 0.74.
3. With every track at full level the tracks together peak at −9.8 dBFS,
   at a drum hit, so one amount for all tracks can be about +9.6 dB.
   Counted by the service page from the `.peaks` files alone it is only
   +5.5 dB, because those files are too coarse. Reaching −14 LUFS takes
   +16.3 dB and a limiter that works in 187 of the take's 298 seconds.
4. MP3 raises this take's peak with all tracks together by 0.25 dB
   (LAME at its best variable bit rate, as РЭХА encodes).

The measuring script and its results are in
/mnt/project-files/band-service/loudness/ (`measure.py`, `take14.json`).
The listening page Alex heard the choices on:
https://claude.ai/artifact/M3QjdC6NHGpih6qhebe18i.

## Alex's picks

- 10 November, 14:35 UTC: «мы записываем треки и по факту получается
  общий микс тихо в сервисе (у нас гейн на микшере в -18дб на каждой
  дорожке). может нормализовать треки по самому громкому перед
  выкладыванием на сервис. или как-то по другому можно решить?»
- 10 November, 14:47: «у тебя ж есть доступ к клаудфларе - посмотри там
  дубли лежат». The Cloudflare connector cannot read the files, so on
  14 November, 12:17, he uploaded Ill never new 14's tracks.
- 14 November, 12:27, card: **Одна прибавка**. One amount for all tracks,
  set by the take's loudest moment, with no limiter.
- 12:29, card: **Числом в плеере**. РЭХА counts one number per take and
  sends it with the take. The service plays the take louder by it. The
  files stay as recorded, and takes already in the service get only the
  number.
- 12:30, card: **Только сервис**. The service's player and its
  **Download** mix get louder. РЭХА's player and the cloud folder's mix
  stay as they are.
- 12:32, card: **На каждый дубль**. Each take has its own amount, not one
  for the whole rehearsal.
- 12:33, card: **Ничего на сайте**. reha.stream does not change.
- 12:40, «ок» to this spec.

## What the band hears

- In the service each take plays louder by its own amount. Every track gets
  the same amount, so the balance stays as recorded. The amount puts the
  take's loudest moment, with every track at full level, at −1 dBFS.
  Ill never new 14 gets about +8.8 dB and plays at about −21.5 LUFS at
  РЭХА's balance, counted from the 5 tracks measured; with VOX2 it may get
  a little less.
- The faders and Master work as now, from 0 to 100%, on top of the amount.
  The amount is counted with every track at full level, so the faders
  cannot make a take crackle, except in the rare case of tracks that cancel
  each other (Stress cases).
- A track's meter and Master's meter show what is heard, the amount
  included. The waves stay as recorded, as in РЭХА.
- **Download** › **The mix** gets the same amount. **Tracks in MP3** and
  **Tracks in FLAC** download as recorded.
- A take with no amount plays as now. That covers a take from an older
  РЭХА, and a take already in the service whose files are no longer on
  РЭХА's computer.
- РЭХА's player and the cloud folder's mix do not change.

## How it is built

### РЭХА

- The count: the loudest sample of the take's audio tracks added together
  at full level, the band's tracks and the Backing track, not the notes. A
  mono track goes into both sides and a stereo one side by side, as the
  first pass of `audio/mixdown.py` and the service's player both do. It is
  one function in `audio/mixdown.py`, which the mixdown uses too. It took
  0.33 s for Ill never new 14 in the container.
- It goes as `peak` (1.0 is full scale) with the take's details,
  `PUT /api/reha/takes/:uid`, for the generation being sent. A crop makes
  a new generation and sends its own peak.
- Like the tempo count, it waits while a take plays in РЭХА, so it cannot
  cause the stutter (`Api._sound_busy`).
- Takes already in the service: the listing `GET /api/reha/takes` says
  which generation's peak each take has (`peak_gen`, as `drift_gen` for the
  tempo). РЭХА sends the details of a take without one again, with its
  peak, in the background, one take at a time, the way it caught up the
  tempo line (`_catch_up`, `sending/band_service.py:1121`, asked for at
  `:880`). A take whose files are gone gets none.

### The service

- A migration adds `peak` (a real number) and `peak_gen` (an integer) to
  `take`, both empty to begin with.
- `TakeMeta` takes `peak` as an optional number, 0 or more; 0 (silence)
  gives the amount 1. The service keeps it with the generation it came with.
- The take page gets the take's `gain`: 0.891 / peak, at most 16 (+24 dB),
  and 1 when the take has no peak.
- The player sets each track's gain node to its level times the take's
  gain, with M and S as now. The one player takes the gain with each take,
  so the bar at the bottom plays each take at its own amount.
- The **Download** mix multiplies each track's level by the take's gain.
  It still turns the mix down if it goes over, as a guard.
- `service/openapi.json` describes the new field.

## Stress cases

- A silent or almost silent take, such as a false start sent by hand: the
  amount stops at +24 dB, so its hiss is not raised further.
- A take whose tracks together already go over −1 dBFS: its amount is
  below 1, so it plays quieter than now by as much as it went over −1 dBFS,
  and no longer crackles.
- Two tracks that cancel each other, such as two mics on one cabinet in
  opposite polarity: turning one down can make the sum louder than the
  counted peak, and the loudest moment may crackle in the player. The
  **Download** mix still turns itself down.
- A take sent by an older РЭХА, or one whose files are gone: no peak, so it
  plays as now.
- A take cropped after it went up: the new generation brings its own peak.
  The amount is used only with the generation it was counted for, so while
  the cropped files go up, the take plays as now for those minutes.
- A band whose service is older than its РЭХА: the service ignores the
  peak, and takes play as now. Once the service is updated, РЭХА's next look
  at it, within an hour, sends the peak of every take whose files are still
  on the computer.
- A take open in the service while РЭХА sends its peak: it keeps playing at
  its old level, and plays louder the next time it is opened.

## Words

No new words in the interface.

## Pictures, the guide and the site

- The guide, `docs/using-it.md:814`: “A take plays there at the levels its
  tracks have in РЭХА's player.” becomes three sentences: the tracks keep
  the levels they have in РЭХА's player; the service turns the whole take
  up as far as its loudest moment allows, every track by the same amount,
  so it sounds louder there than in РЭХА; a take sent by an older РЭХА is
  turned up once РЭХА has been updated, if its files are still on the
  computer.
- reha.stream does not change (Alex, 12:33). The CHANGELOG item goes after
  the first item of “Unreleased”, so the site's news line, which reads the
  first item of a release, does not show it.
- README.md and service/README.md do not change: neither speaks of levels.
- The service's pictures do not change: their takes have no peak, so they
  play and look as now.
- CHANGELOG, under “Unreleased”: one item starting with
  **Louder takes in the band service.**

## Tests

Only the tests the change touches, each once; the full suites run on CI.

- Python: the peak function on a mono and a stereo track and on silence;
  a new take's details carry `peak`; a ★ sends the same peak without
  counting again; the catch-up sends details for a take whose `peak_gen` is
  behind.
- Service: `TakeMeta` takes and keeps `peak` with its generation; the
  listing gives `peak_gen`; the take page's gain with its ceiling, its cap
  and no peak; the player's gain node is level times gain; the mix gets
  the gain.

## Calls Claude made

1. The ceiling is −1 dBFS (0.891), not 0.97 as in `audio/mixdown.py`. MP3
   raises the peak by 0.25 dB on Ill never new 14, and 0.97 leaves 0.26 dB.
   So that take gets +8.8 dB, not the +9.6 shown on the listening page.
2. The amount stops at +24 dB.
3. A take that already goes over −1 dBFS is turned down.
4. The amount is counted with every track at full level, not at РЭХА's
   balance, so a member's faders cannot make it crackle. At the balance
   Ill never new 14 could take +12.1 dB.
5. The Backing track counts; the notes do not, since the service does not
   play them.
6. The meters include the amount; the waves do not.
7. Tracks downloaded as files stay as recorded.
8. РЭХА counts from the WAV files, not from the MP3s it sends; the ceiling
   covers the difference.
9. РЭХА sends the peak, and the service works out the amount, so the
   ceiling and the cap live in one place.
10. No setting turns this off.
11. The guide's sentence changes, though the site does not.
12. No new pictures.
13. While a cropped take's new files go up, it plays as now: the amount
    of the old generation is not kept for the new one.
14. A take open in the service when its peak arrives keeps its level until
    it is opened again, so the sound does not jump during playback.

## Not in this

- A limiter (Alex, 12:27).
- Changing the files (Alex, 12:29).
- Master above 100% (Claude's call).
- РЭХА's player and the cloud folder's mix (Alex, 12:30).
- Raising the gain on the mixer, or recording at 24 bits (this take is
  16-bit; РЭХА's **Depth** setting).
