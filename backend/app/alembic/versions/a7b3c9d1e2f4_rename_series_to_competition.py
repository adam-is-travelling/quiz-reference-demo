"""rename series to competition

Revision ID: a7b3c9d1e2f4
Revises: c1d2e3f4a5b6
Create Date: 2026-08-01 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7b3c9d1e2f4"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NOTE: the FK on `quiz` is named `quizevent_series_id_fkey`, not
    # `quiz_series_id_fkey` — Postgres kept the original name through the
    # earlier quizevent -> quiz table rename (revision 09b03772bf36).
    op.drop_constraint("quizevent_series_id_fkey", "quiz", type_="foreignkey")

    op.alter_column("quiz", "series_id", new_column_name="competition_id")

    op.rename_table("quizseries", "competition")

    # Postgres carries constraint/index names through a table rename, so rename
    # them explicitly or the schema still reads "quizseries".
    op.execute("ALTER INDEX quizseries_pkey RENAME TO competition_pkey")
    op.execute(
        "ALTER TABLE competition RENAME CONSTRAINT "
        "quizseries_organization_id_fkey TO competition_organization_id_fkey"
    )

    op.create_foreign_key(
        "quiz_competition_id_fkey",
        "quiz",
        "competition",
        ["competition_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("quiz_competition_id_fkey", "quiz", type_="foreignkey")

    op.execute(
        "ALTER TABLE competition RENAME CONSTRAINT "
        "competition_organization_id_fkey TO quizseries_organization_id_fkey"
    )
    op.execute("ALTER INDEX competition_pkey RENAME TO quizseries_pkey")

    op.rename_table("competition", "quizseries")

    op.alter_column("quiz", "competition_id", new_column_name="series_id")

    op.create_foreign_key(
        "quizevent_series_id_fkey",
        "quiz",
        "quizseries",
        ["series_id"],
        ["id"],
        ondelete="SET NULL",
    )
