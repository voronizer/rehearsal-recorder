"""Opt-in diagnostics only write to the explicitly requested temporary path."""
import json
import logging
import os
from pathlib import Path
import tempfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from rehearsal_recorder.midi.diagnostics import configure_trace
from rehearsal_recorder.midi.controller import trace


def main():
    logger=logging.getLogger('rehearsal_recorder.midi.controller')
    saved=os.environ.pop('REHA_CONTROLLER_TRACE',None)
    try:
        assert configure_trace() is None
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'nested'/'controller.log'
            h=configure_trace(path);trace('test',token=42,state='ready');h.flush()
            line=path.read_text().strip();assert line[19]=='Z'
            record=json.loads(line.split(' ',1)[1]);assert record['token']==42 and record['t_ns']>0
            h2=configure_trace(path);assert h.stream is None
            trace('second',note=60);h2.flush();assert len(path.read_text().splitlines())==2
            logger.removeHandler(h2);h2.close()
        print('Controller diagnostics: passed')
    finally:
        if saved is not None:os.environ['REHA_CONTROLLER_TRACE']=saved

if __name__=='__main__':main()
