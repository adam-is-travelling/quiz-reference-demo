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

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, country FROM player WHERE country IS NOT NULL")
    ).fetchall()

    # Phase 1: normalize rows that can be resolved; skip unresolvable ones
    for row in rows:
        normalized = normalize_country(row.country)
        if normalized is not None:
            conn.execute(
                sa.text("UPDATE player SET country = :code WHERE id = :id"),
                {"code": normalized, "id": str(row.id)},
            )

    # Phase 1b: blank out remaining unresolvable values (length > 3 means unrecognized)
    # Cannot NULL them yet — column is still NOT NULL. Use '' as a placeholder.
    conn.execute(
        sa.text("UPDATE player SET country = '' WHERE length(country) > 3")
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

    # Phase 2b: convert empty-string placeholders to NULL now that column is nullable
    conn.execute(sa.text("UPDATE player SET country = NULL WHERE country = ''"))


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
