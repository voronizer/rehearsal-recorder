"""Optional controller-only rotating trace. No listener, settings or dependencies."""
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import time


def configure_trace(path=None):
    path = path or os.environ.get('REHA_CONTROLLER_TRACE')
    if not path:
        return None
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('rehearsal_recorder.midi.controller')
    for old in list(logger.handlers):
        if getattr(old, '_controller_trace', False):
            logger.removeHandler(old);old.close()
    handler = RotatingFileHandler(target, maxBytes=2*1024*1024, backupCount=2, encoding='utf-8')
    handler._controller_trace = True
    formatter = logging.Formatter('%(asctime)s %(message)s', datefmt='%Y-%m-%dT%H:%M:%SZ')
    formatter.converter = time.gmtime
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return handler
