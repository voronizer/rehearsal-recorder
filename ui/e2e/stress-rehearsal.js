// Stress for the rehearsal screen, laid over band.js in the same script: a
// test asks for it with openBandApp(page, { stress: "rehearsal" }) (app.ts),
// and every other page keeps the band as it is. The data the rehearsal
// screen's mockups measured: the rehearsal "Tuesday jam at the old brewery,
// with the horn section and the choir from upstairs", 32 takes of 14 songs
// with two long names, seven audio tracks with "Lead and backing vocals
// (Hanna)", and a set of ten songs with a long name. An eighth track is on
// MIDI only, "Keys (Nord Stage 3 MIDI)", after Hanna's, so a lane of notes
// and its plate are in the player: every take has its .mid (api.take_notes
// reads it back as a keyboard line). The drummer is on Both from the kit's
// TD-17, as the start screen's stress has it: Drums' audio lane and its own
// notes lane under it, one track (a drum grid, read back from Drums.mid).
{
  const LONG_TRACK = 'Lead and backing vocals (Hanna)';
  const MIDI_TRACK = 'Keys (Nord Stage 3 MIDI)';
  const MIDI_PORT = 'Nord Stage 3 MIDI Output';
  VOICE[LONG_TRACK] = VOICE.Vocals; VOICE['Second guitar'] = VOICE.Guitar; VOICE['Keys'] = VOICE.Bass; VOICE['Percussion'] = VOICE.Drums;
  PARTS.splice(0, 1, {name: 'Drums', channel: 1, icon: 'drums', mode: 'both',
                      midi_port: {name: 'TD-17', device: 'TD-17', maker: 'Roland'}});
  PARTS.splice(3, 1, {name: LONG_TRACK, channel: 4, icon: 'vocals'});
  PARTS.push({name: 'Second guitar', channel: 5, icon: 'guitar-electric'},
             {name: 'Keys', channel: 6, icon: 'keys'}, {name: 'Percussion', channel: 7, icon: 'drums'});
  PARTS.splice(4, 0, {name: MIDI_TRACK, icon: 'keys', mode: 'midi',
                      midi_port: {name: MIDI_PORT, device: 'Nord Stage 3', maker: 'Clavia'}});
  // The port is plugged in, so a take recorded tonight keeps its notes.
  window.__MIDI_PORTS__ = ['TD-17', 'Launchkey Mini MK3', MIDI_PORT];
  window.__BAND_ICONS__ = Object.assign(window.__BAND_ICONS__ || {}, {[MIDI_TRACK]: 'keys'});
  // A take of this band: the audio files of the tracks that take sound, and
  // the .mid of the one on MIDI, placed after Hanna's lane as Python places
  // it (rules.lane_after, rules.place_in), and the drums' .mid, under their
  // own audio.
  const midiNotes = (n, length) => {
    const file = `${TONIGHT}/${n}/${MIDI_TRACK}.mid`, kit = `${TONIGHT}/${n}/Drums.mid`;
    fileDurations[file] = length;
    fileDurations[kit] = length;
    return [{name: 'Drums', file: kit, port: 'TD-17', after: 'Drums', place: 0},
            {name: MIDI_TRACK, file, port: MIDI_PORT, after: LONG_TRACK, place: PARTS.findIndex(p => p.name === MIDI_TRACK)}];
  };
  takeOf = function (n, name, length, end, markers) {
    const tracks = PARTS.filter(p => p.mode !== 'midi').map(p => ({name: p.name, file: `${TONIGHT}/${n}/${p.name}.wav`}));
    for (const tr of tracks) {
      KIND[tr.file] = {part: tr.name, seed: n, end};
      fileDurations[tr.file] = length;
    }
    return {take_number: n, name, ...goOfName(name), starred: isTheTake(markers),
            duration_sec: length, tracks, notes: midiNotes(n, length), notes_missing: [], markers};
  };
  // The draft a take leaves when it stops has the notes too.
  const stopTake = api.stop_take;
  api.stop_take = async () => {
    const draft = await stopTake();
    draft.tracks = draft.tracks.filter(t => t.name !== MIDI_TRACK);
    return {...draft, notes: midiNotes(draft.take_number, draft.duration_sec), notes_missing: []};
  };
  const LONG1 = 'Dancing barefoot on the roof of the old brewery';
  const LONG2 = 'Kalychanka (slow version for the wedding, with the long intro the bride asked for)';
  const names = ['Pałyn', 'Pałyn 2', 'Ahoń', 'Take 4', 'Viasna', LONG1, LONG1 + ' 2', 'Zorka', 'Zorka 2', 'Zorka 3',
    'Zorka 4', 'Zorka 5', 'Zorka 6', 'Zorka 7', 'Zorka 8', LONG2, 'Vecharyna', 'Ranica', 'Ranica 2', 'Take 20',
    'Kupalle', 'Žniŭnaja', 'Kalada', 'Dym', 'Dym 2', 'Sonca', 'Ptuška', 'Pałyn 3', 'Viasna 2', 'Take 30',
    'Kupalle 2', 'Sonca 2'];
  const marks = {2: [{at: 50.5, note: 'chorus came in early', label_id: 3}, {at: 112, note: 'bridge — try it slower, and the horn section waits a whole bar before it comes back in', label_id: 4}, {at: 131, note: 'this one is the take', label_id: 2}],
                 6: [{at: 80, note: 'the second verse drags, count it in faster next time', label_id: 4}],
                 7: [{at: 200, note: 'this one is the take', label_id: 2}]};
  const tonight = names.map((n, i) => takeOf(i + 1, n, i === 2 ? 12 : 120 + (i * 37) % 200, i === 2 ? 11 : 110 + (i * 37) % 190, marks[i + 1] || []));
  sets = [{id: 1, name: 'Gig on the 25th at the old brewery with the horn section',
           songs: ['Pałyn', 'Viasna', LONG1, 'Ahoń', 'Sonca', 'Dym', 'Ptuška', LONG2, 'Zorka', 'Kupalle']}];
  nextSetId = 2;
  api.start_rehearsal = async (_name, _device, _rate, _tracks, _depth, _setId) => {
    session = {name: 'Tuesday jam at the old brewery, with the horn section and the choir from upstairs',
               folder: 'C:\\Users\\alex\\RehearsalRecordings\\Tuesday jam - 2026-09-29 19-00',
               tracks: PARTS, takes: JSON.parse(JSON.stringify(tonight)),
               set: {name: sets[0].name, songs: [...sets[0].songs]}};
    takeCounter = tonight.length;
    return {ok: true, folder: session.folder};
  };
}
