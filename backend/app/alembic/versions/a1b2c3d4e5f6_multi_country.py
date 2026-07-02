"""multi-country players and per-result country

Revision ID: a1b2c3d4e5f6
Revises: 09b03772bf36
Create Date: 2026-07-01 00:00:00.000000

"""
import json

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "09b03772bf36"
branch_labels = None
depends_on = None


def upgrade():
    # player.countries: add nullable, backfill from country, then enforce non-null
    op.add_column("player", sa.Column("countries", sa.JSON(), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, country FROM player")).fetchall()
    for row in rows:
        countries = [row.country] if row.country is not None else []
        conn.execute(
            sa.text("UPDATE player SET countries = CAST(:c AS JSON) WHERE id = :id"),
            {"c": json.dumps(countries), "id": str(row.id)},
        )
    op.alter_column("player", "countries", nullable=False)
    op.drop_column("player", "country")

    # quizresult.country: nullable, no backfill
    op.add_column(
        "quizresult",
        sa.Column(
            "country",
            sqlmodel.sql.sqltypes.AutoString(length=3),
            nullable=True,
        ),
    )


def downgrade():
    # player.country: restore from first element of countries
    op.add_column(
        "player",
        sa.Column(
            "country",
            sqlmodel.sql.sqltypes.AutoString(length=3),
            nullable=True,
        ),
    )
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, countries FROM player")).fetchall()
    for row in rows:
        countries = row.countries or []
        country = countries[0] if countries else None
        conn.execute(
            sa.text("UPDATE player SET country = :c WHERE id = :id"),
            {"c": country, "id": str(row.id)},
        )
    op.drop_column("player", "countries")

    op.drop_column("quizresult", "country")
