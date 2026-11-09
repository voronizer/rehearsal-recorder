import { closeTake, openBandApp, recordTake, startRehearsal, test } from "./app.ts"

// The rehearsal stress band (stress-rehearsal.js): 32 takes, eight tracks with
// one on MIDI alone, and the drummer on Both. A fixture whose own test fails on
// any error in the page, so what the band does on a track that takes no sound
// is checked here once, and the screens built on it can rely on it.

test("a band with a MIDI-only track records a take with no error in the page", async ({ page }) => {
  await openBandApp(page, { stress: "rehearsal" })
  await startRehearsal(page, 33)
  await recordTake(page, 33)
  await closeTake(page, 34)
})
