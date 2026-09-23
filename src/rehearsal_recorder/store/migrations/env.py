"""
Alembic's entry point for this app's migrations.

The app runs them itself (store/db.py) and hands over its open connection in
`config.attributes["connection"]`. The alembic command line, which is only
for writing a new migration, has no such connection and opens the database
named in alembic.ini at the repository root instead.
"""

from alembic import context
from sqlalchemy import create_engine

from rehearsal_recorder.store.models import Base

config = context.config


def _run(connection):
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        # SQLite can hardly ALTER a table; batch mode rebuilds it instead.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


connection = config.attributes.get("connection")
if connection is not None:
    _run(connection)
else:
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    with engine.begin() as connection:
        _run(connection)
