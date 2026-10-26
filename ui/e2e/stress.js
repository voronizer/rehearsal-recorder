// Stress: long names, many songs, a bigger band. Laid over band.js, in the
// same script, so PAST, pastTakes, api and the rest are band.js's own: a
// test asks for it with openBandApp(page, { stress: true }) (app.ts), and
// every other page keeps the band as it is. From the start screen's
// mockups (design-system/screen-start/q4), where it showed each way of
// keeping a long name whole.
{
  // Last time: thirteen songs, two of them with long names, one of those
  // with a long note, the other longer than two lines of its row.
  const tue = PAST['/rec/tue'];
  // A name longer than two lines of the card, so every way has one to cut.
  tue[0] = 'Tuesday jam at the old brewery, with the horn section and the choir from upstairs';
  tue[3].splice(10, 0,
    ['Dancing barefoot on the roof of the old brewery', 312,
      [{at: 80, note: 'the second verse drags, count it in faster next time', label_id: 4}]],
    ['Dancing barefoot on the roof of the old brewery 2', 298,
      [{at: 200, note: 'this one is the take', label_id: 2}]],
    ['Kalychanka (slow version for the wedding, with the long intro the bride asked for)', 240, []],
    ['Zorka', 180, []], ['Zorka 2', 176, []], ['Zorka 3', 190, []], ['Zorka 4', 185, []],
    ['Zorka 5', 170, []], ['Zorka 6', 182, []], ['Zorka 7', 188, []], ['Zorka 8', 179, []],
    ['Vecharyna', 222, []],
    ['Ranica', 205, []], ['Ranica 2', 210, []],
    ['Kupalle', 260, []], ['Žniŭnaja', 233, []], ['Kalada', 248, []]);

  // Earlier: the soundcheck under a name longer than its row, so it wraps
  // and leaves its figures no room at all.
  PAST['/rec/soundcheck'][0] = 'Soundcheck at the community hall before the open-air concert';

  // Five tracks: the drummer on Both from the kit, a long name, keys on MIDI.
  window.__MIDI_PLAYED__ = ['TD-17', 'Launchkey Mini MK3'];
  api.load_default_tracks = async () => ({tracks: [
    {name: 'Drums', channel: 1, icon: 'drums', stereo: false, mode: 'both', midi_port: {name: 'TD-17'}},
    {name: 'Bass', channel: 2, icon: 'bass', stereo: false},
    {name: 'Guitar', channel: 3, icon: 'guitar-electric', stereo: false},
    {name: 'Lead and backing vocals (Hanna)', channel: 4, icon: 'vocals', stereo: false},
    {name: 'Keys', channel: null, icon: 'keys', stereo: false, mode: 'midi', midi_port: {name: 'Launchkey Mini MK3'}}]});

  // An interface with a long name, and Under the hood records with it.
  const LONG_CARD = 'Universal Audio Apollo Twin X DUO Heritage Edition';
  const devices = api.list_input_devices;
  api.list_input_devices = async () => (await devices()).map(d =>
    d.index === 3 ? {...d, name: LONG_CARD} : d);
  const hood = api.under_the_hood;
  api.under_the_hood = async () => {
    const h = await hood();
    return {...h, audio: {...h.audio, recording: h.audio.recording && {...h.audio.recording, name: LONG_CARD}}};
  };
}
