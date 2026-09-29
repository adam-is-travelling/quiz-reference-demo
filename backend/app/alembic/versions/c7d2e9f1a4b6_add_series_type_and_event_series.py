"""add series type and event series

Revision ID: c7d2e9f1a4b6
Revises: b4e8f2a6c913
Create Date: 2026-09-29 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c7d2e9f1a4b6'
down_revision = 'b4e8f2a6c913'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every existing series is a series of quizzes, so the default backfills it.
    series_type = sa.Enum("quiz", "event", name="recurringseriestype")
    series_type.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "recurringseries",
        sa.Column("type", series_type, nullable=False, server_default="quiz"),
    )

    op.add_column("event", sa.Column("series_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "event_series_id_fkey",
        "event",
        "recurringseries",
        ["series_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("event_series_id_fkey", "event", type_="foreignkey")
    op.drop_column("event", "series_id")
    op.drop_column("recurringseries", "type")
    sa.Enum(name="recurringseriestype").drop(op.get_bind(), checkfirst=True)
