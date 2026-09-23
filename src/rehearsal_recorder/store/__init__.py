"""
The rehearsal history: one SQLite database per recordings folder.

models.py says what is kept, migrations/ how the file on disk got that way,
db.py opens it, library.py is what the rest of the app calls, and importer.py
moves in the session.json files older versions wrote.
"""
