"""add round_abbreviations to quizformat

Revision ID: f1c3a7e2b9d4
Revises: e4b7c1d9a2f3
Create Date: 2026-10-12 16:00:00.000000

"""
import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = 'f1c3a7e2b9d4'
down_revision = 'e4b7c1d9a2f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quizformat",
        sa.Column(
            "round_abbreviations", sa.JSON(), nullable=False, server_default="[]"
        ),
    )


def downgrade() -> None:
    op.drop_column("quizformat", "round_abbreviations")
