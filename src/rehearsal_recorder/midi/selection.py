"""Atomic selection-reference framing; protocol v1 negotiated extension."""

def frames(value):
    parts = [(value >> (7*i)) & 127 for i in range(5)]
    return [(104+i, part) for i, part in enumerate(parts)] + [(109, sum(parts)&127)]


class Reference:
    def __init__(self):
        self.index = 0
        self.staging = self.checksum = 0
        self.value = None

    def receive(self, cc, value):
        if cc == 104:
            self.index = self.staging = self.checksum = 0
            self.value = None
        if 104 <= cc <= 108:
            if cc != 104+self.index or value > 127 or (self.index == 4 and value > 15):
                self.index = 0; self.value = None
                return
            self.staging |= value << (7*self.index)
            self.checksum = (self.checksum+value)&127
            self.index += 1
        elif cc == 109:
            self.value = self.staging if self.index == 5 and value == self.checksum and self.staging else None
            self.index = 0
