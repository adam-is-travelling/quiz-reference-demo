"""add quiz_result_player and backfill from quizresult

Revision ID: b2c3d4e5f6a7
Revises: f1a2b3c4d5e6
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quiz_result_player",
        sa.Column("quiz_result_id", sa.Uuid(), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column("quiz_id", sa.Uuid(), nullable=False),
        sa.Column("player_id", sa.Uuid(), nullable=False),
        sa.Column("country", sa.String(length=3), nullable=True),
        sa.ForeignKeyConstraint(
            ["quiz_result_id"], ["quizresult.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["quiz_id"], ["quiz.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["player.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("quiz_result_id", "slot"),
        sa.UniqueConstraint("quiz_id", "player_id", name="uq_quiz_result_player_quiz_player"),
    )
    op.create_index(
        "ix_quiz_result_player_quiz_id", "quiz_result_player", ["quiz_id"]
    )
    op.create_index(
        "ix_quiz_result_player_player_id", "quiz_result_player", ["player_id"]
    )

    # Backfill: one slot-1 participant per existing result.
    op.execute(
        """
        INSERT INTO quiz_result_player
            (quiz_result_id, slot, quiz_id, player_id, country)
        SELECT id, 1, quiz_id, player_id, country FROM quizresult
        """
    )

    # Every result must have produced exactly one participant row.
    bind = op.get_bind()
    results = bind.execute(sa.text("SELECT count(*) FROM quizresult")).scalar_one()
    participants = bind.execute(
        sa.text("SELECT count(*) FROM quiz_result_player")
    ).scalar_one()
    if results != participants:
        raise RuntimeError(
            f"backfill mismatch: {results} results produced {participants} participants"
        )


def downgrade() -> None:
    op.drop_index("ix_quiz_result_player_player_id", "quiz_result_player")
    op.drop_index("ix_quiz_result_player_quiz_id", "quiz_result_player")
    op.drop_table("quiz_result_player")
