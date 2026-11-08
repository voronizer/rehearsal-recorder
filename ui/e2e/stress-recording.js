// Stress for the recording screen, laid over stress-rehearsal.js (and the band
// under it) in the same script: a test asks for it with
// openApp(page, { stress: "recording" }) (app.ts), and every other page keeps
// the band as it is. The data the recording screen's mockups measured: the
// rehearsal stress band (eight tracks, Drums on Both from the TD-17, "Lead
// and backing vocals (Hanna)", "Keys (Nord Stage 3 MIDI)" on MIDI only, the
// rehearsal "Tuesday jam at the old brewery, with the horn section and the
// choir from upstairs" with 32 takes). On top of it, for this screen:
// - the take is the second of the longest song name, take 33 of the
//   evening: take 16 was its first;
// - somebody plays the Nord, so the MIDI-only tile's notes move too;
// - Guitar clips three times in the take's first seconds ("clipped 3×");
// - Percussion's input is dead, so its tile is silent;
// - the disk is nearly full: about 5 min left.
// The evening is under way when the app opens, as Start rehearsal would have
// begun it, and Record is pressed, as a person would: the screen is the
// recording screen once the take records, and a test waits for its clock.
{
  const SONG = 'Kalychanka (slow version for the wedding, with the long intro the bride asked for)';
  window.__MIDI_PLAYED__ = ['Nord Stage 3 MIDI Output'];
  api.recording_health = async () => ({recording: true, error: null, active: true,
    free_bytes: 2.4e9, minutes_left: 5, low_space: true, battery_percent: null});
  // The clips are counted in polls, not in seconds: the screen asks every 70
  // ms, so these are at about 0.6 s, 1.4 s and 2.2 s into the take, and a
  // machine too busy to keep that pace stretches them instead of missing one
  // (a clip is one run of polls at the top, and the next poll below it).
  const read = api.get_levels;
  let polls = 0;
  api.get_levels = async () => {
    const m = await read();
    polls += 1;
    if ([9, 20, 31].some((k) => polls === k || polls === k + 1)) m.Guitar = [0.995];
    m.Percussion = [0.0005];
    return m;
  };

  api.start_rehearsal('Tuesday jam', 3, 48000, null, 24, null);
  nextName = SONG;

  // Record, once the rehearsal screen has it ready.
  const until = performance.now() + 10000;
  const press = () => {
    if (document.querySelector('[role=timer]') || performance.now() > until) return;
    const record = document.querySelector('button[data-next-take]:not(:disabled)');
    if (record) record.click();
    else setTimeout(press, 40);
  };
  press();
}
