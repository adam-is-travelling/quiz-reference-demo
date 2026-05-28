"""country_varchar3_nullable

Revision ID: d7d5076c786b
Revises: 5461017c4a57
Create Date: 2026-05-28 22:51:37.669914

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd7d5076c786b'
down_revision = '5461017c4a57'
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.utils import normalize_country
    from app.countries import VALID_COUNTRY_CODES

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, country FROM player WHERE country IS NOT NULL")
    ).fetchall()

    # Phase 1: normalize rows that can be resolved; skip rows that can't
    # (writing NULL here would violate the existing NOT NULL constraint)
    for row in rows:
        normalized = normalize_country(row.country)
        if normalized is not None:
            conn.execute(
                sa.text("UPDATE player SET country = :code WHERE id = :id"),
                {"code": normalized, "id": str(row.id)},
            )

    # Phase 2: alter column — varchar(100) NOT NULL → varchar(3) NULL
    with op.batch_alter_table("player") as batch_op:
        batch_op.alter_column(
            "country",
            existing_type=sa.VARCHAR(length=100),
            existing_nullable=False,
            type_=sa.VARCHAR(length=3),
            nullable=True,
        )

    # Phase 2b: now that the column is nullable, NULL out any remaining invalid values
    conn.execute(
        sa.text(
            "UPDATE player SET country = NULL "
            "WHERE country IS NOT NULL AND length(country) > 3"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    # Pre-step: clear NULLs before restoring NOT NULL constraint
    conn.execute(sa.text("UPDATE player SET country = '' WHERE country IS NULL"))

    with op.batch_alter_table("player") as batch_op:
        batch_op.alter_column(
            "country",
            existing_type=sa.VARCHAR(length=3),
            existing_nullable=True,
            type_=sa.VARCHAR(length=100),
            nullable=False,
            server_default="",
        )
