"""Bounded browse catalog and absolute selection framing on ordinary MIDI CCs."""
from .text import ascii_row
MAX_SONGS, MAX_TAKES, NONE = 128, 512, 16383

def number(value): return [(value >> (7*i)) & 127 for i in range(5)]
def index(value): return [value & 127, (value >> 7) & 127]
def frame(kind, data):
    return [(90,kind),(91,len(data)),*[(92,x) for x in data],(93,(kind+len(data)+sum(data))&127)]
def catalog_frames(tag, catalog):
    songs,takes,si,ti=catalog
    yield from frame(0,number(tag)+index(len(songs))+index(len(takes))+index(si)+index(ti))
    for i,title in enumerate(songs):yield from frame(1,number(tag)+index(i)+list(ascii_row(title).encode('ascii')))
    for i,take in enumerate(takes):yield from frame(2,number(tag)+index(i)+number(take))
    yield from frame(3,number(tag))

class Frame:
    def __init__(self):self.kind=None;self.length=None;self.data=[];self.ready=None
    def receive(self,cc,value):
        if cc==90:self.kind=value;self.length=None;self.data=[];self.ready=None
        elif cc==91 and self.kind is not None:
            if value>48:self.kind=None
            else:self.length=value
        elif cc==92 and self.kind is not None and self.length is not None:
            if len(self.data)>=self.length:self.kind=None
            else:self.data.append(value)
        elif cc==93:
            if self.kind in (4,5) and self.length==7 and len(self.data)==7 and self.data[4]<=15 and (self.kind+7+sum(self.data))&127==value:
                tag=sum(x << (7*i) for i,x in enumerate(self.data[:5]))
                self.ready=(self.kind,tag,self.data[5]+(self.data[6]<<7)) if tag else None
            else:self.ready=None
            self.kind=None
    def consume(self):value=self.ready;self.ready=None;return value
