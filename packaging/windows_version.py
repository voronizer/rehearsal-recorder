"""
The version an .exe carries: Explorer shows it under Properties > Details,
and Task Manager takes the app's name from it rather than the file's.

Without it the .exe has no version at all. The spec hands what is built here
to PyInstaller, which writes it into the .exe, on Windows only: PyInstaller
needs pefile to read these classes, and has it only there.
"""

import re

# US English, Unicode: the table the strings are kept under, which every
# Windows reads when it finds none in its own language.
LANGUAGE = 0x0409
CODEPAGE = 1200


def numbers(version):
    """
    The four numbers Windows keeps a version as, from the release's.

    A release is "0.7.13"; a build between releases is setuptools-scm's
    "0.7.14.dev11+g3613015", which counts as the release it leads to; a clone
    that was never installed says "unknown", and is 0.0.0.0.
    """
    found = re.match(r"(\d+)\.(\d+)\.(\d+)", version)
    if found is None:
        return (0, 0, 0, 0)
    return (*(int(n) for n in found.groups()), 0)


def version_resource(version, name, copyright, filename):
    """What PyInstaller writes into the .exe, as its `version`. The strings
    say the version as it is; the numbers are what Windows compares."""
    from PyInstaller.utils.win32.versioninfo import (
        FixedFileInfo,
        StringFileInfo,
        StringStruct,
        StringTable,
        VarFileInfo,
        VarStruct,
        VSVersionInfo,
    )

    four = numbers(version)
    return VSVersionInfo(
        ffi=FixedFileInfo(filevers=four, prodvers=four),
        kids=[
            StringFileInfo([
                StringTable(f"{LANGUAGE:04x}{CODEPAGE:04x}", [
                    StringStruct("ProductName", name),
                    StringStruct("FileDescription", name),
                    StringStruct("ProductVersion", version),
                    StringStruct("FileVersion", version),
                    StringStruct("LegalCopyright", copyright),
                    StringStruct("OriginalFilename", filename),
                    StringStruct("InternalName", filename.removesuffix(".exe")),
                ]),
            ]),
            VarFileInfo([VarStruct("Translation", [LANGUAGE, CODEPAGE])]),
        ],
    )
