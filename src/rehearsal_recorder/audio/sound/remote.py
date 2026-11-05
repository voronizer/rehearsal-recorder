"""
A stand-in, in the main process, for an object in the sound process: the
same methods and attributes, each a question down the pipe (link.Link).

A method is asked once whether it is one and then called straight away;
an attribute is read each time, as it changes. Setting an attribute sets
it there. The stand-in for one object is always the same one, so `is`
works as it did.
"""


class Remote:
    __slots__ = ("_link", "_handle", "_gen", "kind", "__weakref__")

    def __init__(self, link, handle, gen, kind):
        object.__setattr__(self, "_link", link)
        object.__setattr__(self, "_handle", handle)
        object.__setattr__(self, "_gen", gen)
        object.__setattr__(self, "kind", kind)

    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return self._link.get(self, name)

    def __setattr__(self, name, value):
        self._link.set(self, name, value)

    def __repr__(self):
        return f"<{self.kind} #{self._handle} in the sound process>"

    def __del__(self):
        try:
            self._link.dropped(self._handle, self._gen)
        except Exception:  # noqa: BLE001 - nothing to do at exit
            pass
