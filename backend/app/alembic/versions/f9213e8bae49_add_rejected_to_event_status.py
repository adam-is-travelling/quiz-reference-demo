"""add_rejected_to_event_status

Revision ID: f9213e8bae49
Revises: a3f9b2c1d4e5
Create Date: 2026-06-09 21:56:00.886319

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'f9213e8bae49'
down_revision = 'a3f9b2c1d4e5'
branch_labels = None
depends_on = None


def upgrade():
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL.
    # Open a fresh connection with AUTOCOMMIT to avoid the active transaction.
    bind = op.get_bind()
    with bind.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(sa.text("ALTER TYPE eventstatus ADD VALUE IF NOT EXISTS 'rejected'"))


def downgrade():
    bind = op.get_bind()
    with bind.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(sa.text(
            "UPDATE quizevent SET status = 'pending' WHERE status = 'rejected'"
        ))
        conn.execute(sa.text("ALTER TYPE eventstatus RENAME TO eventstatus_old"))
        conn.execute(sa.text("CREATE TYPE eventstatus AS ENUM ('pending', 'approved')"))
        conn.execute(sa.text(
            "ALTER TABLE quizevent ALTER COLUMN status TYPE eventstatus "
            "USING status::text::eventstatus"
        ))
        conn.execute(sa.text("DROP TYPE eventstatus_old"))
