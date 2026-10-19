"""Apple's native Bluetooth MIDI pairing window, hosted by the existing app."""
from rehearsal_recorder.platform_support import MACOS
import threading

_picker = None


def available():
    return MACOS


def open_picker():
    if not available():
        return {"ok": False, "error": "Native Bluetooth MIDI setup is available on macOS only"}
    try:
        from PyObjCTools import AppHelper
        from AppKit import NSApplication
        from Foundation import NSBundle
        import objc
        # Imports are lazy; no platform UI is created from MIDI workers.
        def show():
            global _picker
            bundle = NSBundle.bundleWithPath_("/System/Library/Frameworks/CoreAudioKit.framework")
            if not bundle or not bundle.load():
                return
            if _picker is None:
                _picker = objc.lookUpClass("CABTLEMIDIWindowController").alloc().init()
            _picker.showWindow_(None)
            NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
        if threading.current_thread() is threading.main_thread():
            show()
        else:
            AppHelper.callAfter(show)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": f"Could not open Bluetooth MIDI setup: {exc}"}
