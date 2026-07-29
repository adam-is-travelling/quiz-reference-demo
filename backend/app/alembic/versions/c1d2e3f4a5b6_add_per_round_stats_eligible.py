"""add per_round_stats_eligible to quizformat

Revision ID: c1d2e3f4a5b6
Revises: e7a1b2c3d4f5
Create Date: 2026-07-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c1d2e3f4a5b6"
down_revision = "e7a1b2c3d4f5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "quizformat",
        sa.Column(
            "per_round_stats_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade():
    op.drop_column("quizformat", "per_round_stats_eligible")
