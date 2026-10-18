"""Recorder control contract shared by GUI and MIDI.

Commands and results contain application concepts. Connection protocols, wire
identifiers, packet limits and presentation formatting belong to adapters.
"""
from typing import Callable, Protocol


class ControlAPI(Protocol):
    def execute(self, action: str, parameters: dict | None = None,
                on_accept: Callable[[], None] | None = None, *, wait: bool = False) -> dict:
        """Validate and execute under the shared action gate; never queue toggles."""
        ...

    def snapshot(self) -> dict:
        """Confirmed state, revision and recent semantic action results."""
        ...

    def catalog(self) -> dict | None:
        """Songs/takes and an opaque revision for bound selection requests."""
        ...

    def flush_settings(self) -> None:
        """Persist debounced playback settings."""
        ...
