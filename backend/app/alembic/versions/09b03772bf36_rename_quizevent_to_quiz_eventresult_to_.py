"""rename quizevent to quiz, eventresult to quizresult

Revision ID: 09b03772bf36
Revises: b89ea95603f2
Create Date: 2026-06-12 23:01:44.797604

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '09b03772bf36'
down_revision = 'b89ea95603f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Rename tables
    op.rename_table("quizevent", "quiz")
    op.rename_table("eventresult", "quizresult")

    # 2. Drop the old FK from quizresult.event_id → quiz.id (was quizevent.id)
    op.drop_constraint("eventresult_event_id_fkey", "quizresult", type_="foreignkey")

    # 3. Drop old unique constraint before renaming column
    op.drop_constraint("eventresult_event_id_player_id_key", "quizresult", type_="unique")

    # 4. Rename column event_id → quiz_id in quizresult
    op.alter_column("quizresult", "event_id", new_column_name="quiz_id")

    # 5. Recreate unique constraint with new column name
    op.create_unique_constraint("quizresult_quiz_id_player_id_key", "quizresult", ["quiz_id", "player_id"])

    # 6. Recreate FK: quizresult.quiz_id → quiz.id
    op.create_foreign_key(
        "quizresult_quiz_id_fkey",
        "quizresult",
        "quiz",
        ["quiz_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    # 1. Drop new FK
    op.drop_constraint("quizresult_quiz_id_fkey", "quizresult", type_="foreignkey")

    # 2. Drop new unique constraint
    op.drop_constraint("quizresult_quiz_id_player_id_key", "quizresult", type_="unique")

    # 3. Rename column back
    op.alter_column("quizresult", "quiz_id", new_column_name="event_id")

    # 4. Recreate old unique constraint
    op.create_unique_constraint(
        "eventresult_event_id_player_id_key", "quizresult", ["event_id", "player_id"]
    )

    # 5. Recreate old FK pointing back to quizevent
    op.create_foreign_key(
        "eventresult_event_id_fkey",
        "quizresult",
        "quizevent",
        ["event_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 6. Rename tables back
    op.rename_table("quizresult", "eventresult")
    op.rename_table("quiz", "quizevent")
