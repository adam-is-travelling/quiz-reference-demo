"""add quiz participant_mode

Revision ID: f1a2b3c4d5e6
Revises: bbf23bc9abe0
"""

import sqlalchemy as sa
from alembic import op

revision = "f1a2b3c4d5e6"
down_revision = "bbf23bc9abe0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    participant_mode = sa.Enum("individual", "pairs", name="quizparticipantmode")
    participant_mode.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "quiz",
        sa.Column(
            "participant_mode",
            participant_mode,
            nullable=False,
            server_default="individual",
        ),
    )


def downgrade() -> None:
    op.drop_column("quiz", "participant_mode")
    sa.Enum(name="quizparticipantmode").drop(op.get_bind(), checkfirst=True)
