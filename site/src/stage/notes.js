// The notes of the site's MIDI tile, as api.take_notes reads them back from
// a .mid: the drums played on an e-kit and the keys on a keyboard, for eight
// bars, the end of the chorus into the bridge. Laid over the fake and
// band.js in the same script (see installDemo), and made from band.js's song
// form: the parts, their lengths and the start are the band's, so the notes
// are where the song is. The band stays the four whose audio the player and
// the story use; these two have no audio and are no part of it.
//
// The kit plays the beat the band's drums do: the kick on 1 and 3, the snare
// on 2 and 4, the hi-hat or, in a chorus, the ride in eighths, toms through
// the bridge, a crash at the top of each part and a fill into the next. The
// keys comp chords, as a keyboard player would: stabs on every beat in the
// chorus with a line on top, long chords in the bridge.

function makeSiteNotes() {
  // Every bar of the song: its part, its place in the part, when it starts.
  const bars = [];
  let at = START;
  for (const [kind, count] of FORM) {
    for (let bar = 0; bar < count; bar++) bars.push({kind, bar, count, t: at + bar * BAR});
    at += count * BAR;
  }
  const bridge = bars.findIndex(b => b.kind === 'bridge');
  // Named, since a form without them would only fail further on, in a line
  // that says nothing of the song.
  if (bridge < 4)
    throw new Error("band.js's song has no four bars before a bridge, and the site's MIDI tile " +
                    "shows the end of the chorus into the bridge (stage/notes.js)");
  const shown = bars.slice(bridge - 4, bridge + 4);

  // MIDI's velocities are 1 to 127: the softest still sounds.
  const velocity = x => Math.max(1, Math.min(127, Math.round(127 * x)));
  const seed = 2;

  const drums = [];
  const kit = name => KIT_ROWS.indexOf(name);
  for (const {kind, bar, count, t: start} of shown) {
    const loudness = {intro: 0.82, verse: 0.78, chorus: 1, bridge: 0.6, outro: 0.95}[kind];
    for (let b = 0; b < 4; b++) {
      const beat = bar * 4 + b;
      const t = start + b * BEAT;
      const loud = loudness * (0.82 + 0.18 * hash(beat + seed * 13));
      const hit = (when, row, strength) =>
        drums.push([when, 0.1, kit(row), velocity(Math.min(1, strength * loud))]);
      if (beat === 0) hit(t, 'Crash', 1);
      if (kind === 'bridge') {
        hit(t, 'Toms', beat % 2 ? 0.7 : 0.95);
        if (beat % 4 === 0) hit(t, 'Kick', 0.9);
        continue;
      }
      hit(t, beat % 2 ? 'Snare' : 'Kick', beat % 2 ? 0.9 : 0.95);
      const cymbal = kind === 'chorus' || kind === 'outro' ? 'Ride' : 'Hi-hat';
      for (const half of [0, 0.5])
        hit(t + half * BEAT, cymbal, (half ? 0.45 : 0.62) * (0.85 + 0.15 * hash(beat * 2 + half * 2 + seed)));
      // A fill into the next part: four sixteenths on the toms.
      if (beat === count * 4 - 1)
        for (let q = 0; q < 4; q++) hit(t + q * BEAT / 4, 'Toms', 0.6 + 0.1 * q);
    }
  }

  // Each chord as [the bass note, the chord above it].
  const chords = {Am: [45, [57, 60, 64]], F: [41, [57, 60, 65]], C: [48, [55, 60, 64]],
                  G: [43, [55, 59, 62]], Dm: [50, [57, 62, 65]], Em: [52, [55, 59, 64]]};
  const progression = {intro: ['Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G'], verse: ['Am', 'F', 'C', 'G'],
                       chorus: ['F', 'G', 'Am', 'C'], bridge: ['Dm', 'Dm', 'Em', 'Em', 'F', 'F', 'G', 'G'],
                       outro: ['Am']};
  const line = [72, 74, 76, 74, 72, 71, 69, 71];
  const keys = [];
  for (const {kind, bar, t} of shown) {
    const chord = progression[kind];
    const [root, above] = chords[chord[bar % chord.length]];
    const strength = x => Math.min(1, x * (0.85 + 0.15 * hash(bar * 7 + seed)));
    const play = (when, length, pitch, x) => keys.push([when, length, pitch, velocity(strength(x))]);
    if (kind === 'chorus') {
      play(t, BAR * 0.95, root, 0.8);
      for (let b = 0; b < 4; b++) for (const pitch of above) play(t + b * BEAT, BEAT * 0.7, pitch, 0.85);
      play(t, BEAT * 1.9, line[bar % 8], 0.9);
      play(t + 2 * BEAT, BEAT * 1.9, line[(bar + 3) % 8], 0.8);
    } else if (kind === 'bridge' && bar % 2 === 0) {
      for (const pitch of [root, ...above]) play(t, BAR * 1.95, pitch, 0.45);
    }
  }

  // In order of start, as Python sends them, and for pitches in whole
  // octaves, C to B, round all of them.
  drums.sort((a, b) => a[0] - b[0]);
  keys.sort((a, b) => a[0] - b[0]);
  const pitches = keys.map(n => n[2]);
  return {
    from: shown[0].t,
    to: shown[7].t + BAR,
    // A bar into the bridge: what is before it has been heard.
    playhead: bars[bridge].t + BAR,
    lanes: [
      {port: 'TD-17',
       notes: {name: 'Drums', icon: 'drums', drums: true, rows: [...KIT_ROWS], notes: drums}},
      {port: 'Launchkey Mini MK3',
       notes: {name: 'Keys', icon: 'keys', drums: false,
               low: Math.floor(Math.min(...pitches) / 12) * 12,
               high: Math.floor(Math.max(...pitches) / 12) * 12 + 11, notes: keys}},
    ],
  };
}
window.__SITE_NOTES__ = makeSiteNotes();
