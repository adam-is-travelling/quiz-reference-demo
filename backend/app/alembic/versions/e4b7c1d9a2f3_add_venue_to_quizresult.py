"""add venue to quizresult

Revision ID: e4b7c1d9a2f3
Revises: d8e3f0a2b5c7
Create Date: 2026-10-12 12:00:00.000000

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op


# revision identifiers, used by Alembic.
revision = 'e4b7c1d9a2f3'
down_revision = 'd8e3f0a2b5c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quizresult",
        sa.Column("venue", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("quizresult", "venue")
