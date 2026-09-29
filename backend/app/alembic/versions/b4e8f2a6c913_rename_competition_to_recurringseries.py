"""rename competition to recurringseries

Revision ID: b4e8f2a6c913
Revises: a3c9d1e5b742
Create Date: 2026-09-28 12:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b4e8f2a6c913'
down_revision = 'a3c9d1e5b742'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Pure rename: every statement keeps its rows. Postgres carries index and
    # constraint names through a table/column rename, so rename them explicitly
    # (same approach as a7b3c9d1e2f4, series -> competition).
    op.rename_table("competition", "recurringseries")
    op.execute("ALTER INDEX competition_pkey RENAME TO recurringseries_pkey")
    op.execute("ALTER INDEX ix_competition_slug RENAME TO ix_recurringseries_slug")
    op.execute(
        "ALTER TABLE recurringseries RENAME CONSTRAINT "
        "competition_organization_id_fkey TO recurringseries_organization_id_fkey"
    )

    op.alter_column("quiz", "competition_id", new_column_name="series_id")
    op.execute(
        "ALTER TABLE quiz RENAME CONSTRAINT "
        "quiz_competition_id_fkey TO quiz_series_id_fkey"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE quiz RENAME CONSTRAINT "
        "quiz_series_id_fkey TO quiz_competition_id_fkey"
    )
    op.alter_column("quiz", "series_id", new_column_name="competition_id")

    op.execute(
        "ALTER TABLE recurringseries RENAME CONSTRAINT "
        "recurringseries_organization_id_fkey TO competition_organization_id_fkey"
    )
    op.execute("ALTER INDEX ix_recurringseries_slug RENAME TO ix_competition_slug")
    op.execute("ALTER INDEX recurringseries_pkey RENAME TO competition_pkey")
    op.rename_table("recurringseries", "competition")
