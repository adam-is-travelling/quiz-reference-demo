"""drop quizresult.player_id and quizresult.country

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
"""

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    orphans = bind.execute(
        sa.text(
            """
            SELECT count(*) FROM quizresult r
            WHERE NOT EXISTS (
                SELECT 1 FROM quiz_result_player p
                WHERE p.quiz_result_id = r.id
            )
            """
        )
    ).scalar_one()
    if orphans:
        raise RuntimeError(
            f"{orphans} results have no participants; backfill before dropping columns"
        )

    op.drop_constraint("quizresult_quiz_id_player_id_key", "quizresult", type_="unique")
    op.drop_column("quizresult", "player_id")
    op.drop_column("quizresult", "country")


def downgrade() -> None:
    op.add_column("quizresult", sa.Column("country", sa.String(length=3), nullable=True))
    op.add_column("quizresult", sa.Column("player_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE quizresult r
        SET player_id = p.player_id, country = p.country
        FROM quiz_result_player p
        WHERE p.quiz_result_id = r.id AND p.slot = 1
        """
    )
    op.alter_column("quizresult", "player_id", nullable=False)
    op.create_unique_constraint(
        "quizresult_quiz_id_player_id_key", "quizresult", ["quiz_id", "player_id"]
    )
