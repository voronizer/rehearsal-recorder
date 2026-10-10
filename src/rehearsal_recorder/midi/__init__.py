"""
Notes from MIDI instruments, recorded beside a take's audio.

ports.py is the one module that talks to the MIDI library: which ports there
are, when one is plugged in or pulled out, and the events that arrive on an
open one, each with the time the OS says it arrived. The rest, a line each:

  identity.py  which port a saved one is, and the order a device's ports go in
  state.py     what a port has set and what it holds: a take's start and end
  rules.py     what a track's mode means, what stops Start, where a notes lane
               goes
  clock.py     which sample of the audio a moment on the computer's clock is
  smf.py       the .mid file: written, read back and cropped; the one module
               that imports mido
  notes.py     a take's .mid read back as the notes the player draws
  capture.py   one take's notes on disk as they are played, made a .mid at
               Stop or after a crash
  rig.py       the rehearsal's ports, kept open, counted and handed to a take
"""
