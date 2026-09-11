"""add team fields to quizresult

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a7b8
"""

import sqlalchemy as sa
from alembic import op

revision = "d5e6f7a8b9c0"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Safe inside alembic's transaction on PostgreSQL 12+ because this
    # migration does not USE the new value in the same transaction.
    op.execute("ALTER TYPE quizparticipantmode ADD VALUE IF NOT EXISTS 'teams'")

    team_type = sa.Enum("national", "club", name="teamtype")
    team_type.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "quizresult", sa.Column("team_name", sa.String(length=255), nullable=True)
    )
    op.add_column("quizresult", sa.Column("team_type", team_type, nullable=True))
    op.add_column(
        "quizresult", sa.Column("team_country", sa.String(length=3), nullable=True)
    )

    # Teams need not be unique across quizzes, but two results in ONE quiz
    # naming the same team under different spellings is a data error.
    op.execute(
        "CREATE UNIQUE INDEX ix_quizresult_quiz_team_name "
        "ON quizresult (quiz_id, lower(team_name)) "
        "WHERE team_name IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_quizresult_quiz_team_name")
    op.drop_column("quizresult", "team_country")
    op.drop_column("quizresult", "team_type")
    op.drop_column("quizresult", "team_name")
    sa.Enum(name="teamtype").drop(op.get_bind(), checkfirst=True)
    # quizparticipantmode keeps 'teams'; removing an enum value requires
    # rewriting the type, and an unused value is harmless.
