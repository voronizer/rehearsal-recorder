# Downloading a take from the band service: plan

Spec: `docs/superpowers/specs/2026-11-04-service-download-design.md`.
Branch `claude/project-thread-yf8w7z`. Three tasks, done in this thread one
after another. While building, only the tests a change touches run, once
each; the full suites run once, on CI.

## Task 1. The mix

Files: `service/package.json`, `service/src/takes/player/mix.ts`,
`service/src/takes/player/mix.test.ts`.

1. Add `wasm-media-encoders` 0.7.0, pinned as the other dependencies are.
2. `mix.ts`:
   - `mixName(take, muted, soloed)`: “Viasna 12.mp3”, “Viasna 12 - without
     Bass, Vocals.mp3”, “Viasna 12 - only Guitar.mp3”.
   - `gainsOf(tracks, volumes, muted, soloed)`: each track's gain, 0 for a
     muted track or one left out by S.
   - `sum(decoded, gains)`: adds the tracks into one buffer a side, a mono
     track into both; one buffer for the two sides while every track is
     mono, to keep a phone's memory down. Returns the peak.
   - `turnDown(buffers, peak)`: scales to 0.97 of full scale when the peak
     is over it, never up (`audio/mixdown.py`).
   - `makeMix(take, state, { onProgress, signal })`: fetches each MP3 in
     the mix one at a time, decodes it with `decodeAudioData` on an
     `OfflineAudioContext` at the file's own sample rate (`parseFrames` in
     `mp3.ts` reads it), sums, turns down, then encodes with
     `createEncoder("audio/mpeg", url)`, the WebAssembly file imported with
     Vite's `?url` so it is a file of its own, `vbrQuality: 0`, stereo. The
     encoder module is a dynamic `import()`, loaded on the first mix. It
     encodes a second of sound at a time and yields between, so the page
     keeps moving and `signal` can stop it. Progress: fetching and
     decoding are the first half, encoding the second. Returns a Blob.
3. `mix.test.ts` (Vitest, as `sound.test.ts`): names; gains with M and S;
   the sum of two short made-up tracks, mono and stereo; turned down over
   full scale and left alone under it.
4. Run `npx vitest run src/takes/player/mix.test.ts`, then `npm run
   typecheck`. Build once (`npx vite build`) and check that the encoder is
   its own chunk and the `.wasm` its own file, with no base64 copy of the
   Ogg encoder in any chunk.

## Task 2. The button and the window

Files: `service/src/takes/Download.tsx` (new), `Take.tsx`,
`Downloads.tsx` (deleted), `service/e2e/takes.spec.ts`.

1. `Take.tsx`: `useServiceSound(take)` moves up into `TakeView`, which
   passes it to `Full`, `Phone` and `Download`, so the window reads the
   same levels, M and S the player plays. **Download** goes in the title
   row before the star; on a phone the icon alone (`size="icon-row"`,
   `aria-label="Download"`). Both `<Downloads>` go.
2. `Download.tsx`:
   - The button and the dialog (`Dialog`, `DialogButtons`), rows built as
     `ShareOption` in РЭХА's `ShareDialog.tsx`; title “Download “Viasna
     12”” with curly quotes (B8).
   - **The mix**: from `sound.state()` takes volumes, muted and soloed,
     calls `makeMix`, saves the Blob through a link with `download` set to
     the name. The spinner after a second (`useAfter`,
     `SPINNER_AFTER_MS`), “Mixing… N%” after the name, other rows greyed;
     **Close** aborts. On failure the row's line reads “Could not make the
     mix. Try again.”. With no tracks of sound, no row.
   - **Tracks in MP3** / **Tracks in FLAC**: the list from `take.files`,
     each file a `Checkbox` line, all ticked; notes under their track.
     FLAC greyed with “The originals are still coming from РЭХА.” while
     `take.flac_coming`. **Back**, **Cancel**, **Download N files**. Each
     ticked file goes through a hidden link to
     `/files/{uid}/{gen}/{n}.{kind}?download=1`, 300 ms apart, then the
     window closes.
3. `takes.spec.ts`: the old **Download tracks** test and the phone test
   that placed the marks before the downloads change to:
   - the window's three rows; FLAC greyed on Pałyn 9 and its words; the
     FLAC list on Viasna 12 with the Drums notes under Drums, the count on
     the button, unticking one, and the links' addresses (read from the
     page, not clicked);
   - **The mix** on Viasna 12 with Bass muted: a download named “Viasna
     12 - without Bass.mp3” arrives (`page.waitForEvent("download")`);
   - on a phone, **Download** is the icon and opens the same window.
4. Run `npx vitest run` for the touched unit tests, `npm run typecheck`,
   then `npx playwright test e2e/takes.spec.ts` once.

## Task 3. reha.stream, CHANGELOG

Files: `site/content/band-service.md`, `service/pictures/site.spec.ts`,
`site/src/stories/band-service/downloads-{light,dark}.webp`,
`CHANGELOG.md`.

1. `band-service.md`: the sentence in «Hear your own part»; «Take your
   track home» says **Download** and **Tracks in FLAC**; the picture's
   words describe the window.
2. `site.spec.ts`: `downloads` opens the window over Kupalle 2's page
   before the shot. `npm run pictures` for that picture only (`-g
   downloads`); only `downloads-*.webp` change.
3. CHANGELOG: “## Unreleased” on top with the item from the spec.
4. Words checked with the humanizer skill; the site's page test for
   band-service run once.

## After the tasks

A whole-branch review, every finding fixed, then the PR with
“Generated with Claude Code” at its end. Alex sees the new picture and
the window before the merge, and merges on his word. The service and the
site go up after the merge to main; the CHANGELOG item waits for the next
release.
