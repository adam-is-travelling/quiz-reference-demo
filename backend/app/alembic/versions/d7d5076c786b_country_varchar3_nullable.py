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
    # Phase 1: normalize existing country values to valid codes
    from app.utils import normalize_country

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, country FROM player WHERE country IS NOT NULL")).fetchall()
    for row in rows:
        normalized = normalize_country(row.country)
        conn.execute(
            sa.text("UPDATE player SET country = :code WHERE id = :id"),
            {"code": normalized, "id": str(row.id)},
        )

    # Phase 2: alter column — varchar(100) NOT NULL → varchar(3) NULL
    with op.batch_alter_table("player") as batch_op:
        batch_op.alter_column(
            "country",
            existing_type=sa.VARCHAR(length=100),
            type_=sa.VARCHAR(length=3),
            nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("player") as batch_op:
        batch_op.alter_column(
            "country",
            existing_type=sa.VARCHAR(length=3),
            type_=sa.VARCHAR(length=100),
            nullable=False,
            server_default="",
        )
