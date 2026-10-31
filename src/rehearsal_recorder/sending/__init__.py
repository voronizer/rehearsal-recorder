"""
Where saved takes are sent: the cloud folder, or a band service.

Each place is a module of its own, in a file of its own, and neither knows
about the other. They answer the same few calls, which are all a take's
cloud button, Send starred and sending on its own ever make. Settings ›
Folders has one switch, `send_to`, that picks the module new takes go to.

What happens to a take (it is saved, renamed, cropped, deleted) is told to
every module, not only the chosen one: each keeps up to date what it
already holds, and only the chosen one sends anything new.
"""

from typing import Protocol


def false_start(take, limit_sec):
    """
    Whether a take is a false start, as the rehearsal screen greys it
    (isFalseStart in ui/src/lib/evening.ts): longer than nothing, shorter than
    the setting, with no ★ and no marks. Sending on its own leaves one out,
    whichever module sends; the take's own answer on the review screen, or a
    press of its cloud button, still sends it.
    """
    seconds = float(take.get("duration_sec") or 0)
    return (0 < seconds < float(limit_sec)
            and not take.get("starred") and not take.get("markers"))


class Module(Protocol):
    id: str  # "cloud" or "service"

    def send(self, folder, take_number, what=None) -> dict: ...

    def send_starred(self, folder) -> dict: ...

    def saved(self, folder, take_number, take=None) -> None: ...

    # `cut_start`: None when the take's audio stays as it was; for a crop,
    # what it took off the start (0.0 when it cut only the end).
    def edited(self, folder, take_number, cut_start=None) -> None: ...

    def remove(self, folder, take_number) -> dict: ...

    def deleted(self, records: list) -> None: ...

    def states(self, folder) -> dict: ...

    def left(self) -> dict: ...

    def retry(self, entry_id) -> dict: ...

    def start(self) -> None: ...

    def stop(self, timeout=2.0) -> None: ...


class Sending:
    """
    The modules, and which one the switch picks.

    `config` is a function that gives the settings as they are now, since
    the settings are read after the modules are made.
    """

    def __init__(self, modules, config):
        self._modules = dict(modules)
        self._config = config

    def chosen(self):
        """The module new takes go to. The cloud folder while there is no
        band service key, whatever `send_to` says."""
        config = self._config() or {}
        if (config.get("send_to") == "service" and config.get("service_key")
                and "service" in self._modules):
            return self._modules["service"]
        return self._modules["cloud"]

    def all(self):
        return list(self._modules.values())

    def get(self, id):
        return self._modules[id]

    def saved(self, folder, take_number, take=None):
        for module in self.all():
            module.saved(folder, take_number, take=take)

    def edited(self, folder, take_number, cut_start=None):
        for module in self.all():
            module.edited(folder, take_number, cut_start=cut_start)

    def deleted(self, records):
        for module in self.all():
            module.deleted(records)

    def start(self):
        for module in self.all():
            module.start()

    def stop(self, timeout=2.0):
        for module in self.all():
            module.stop(timeout)
