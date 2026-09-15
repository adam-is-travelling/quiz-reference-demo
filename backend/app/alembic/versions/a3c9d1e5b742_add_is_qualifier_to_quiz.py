"""add_is_qualifier_to_quiz

Revision ID: a3c9d1e5b742
Revises: d5e6f7a8b9c0
Create Date: 2026-09-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3c9d1e5b742'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'quiz',
        sa.Column('is_qualifier', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('quiz', 'is_qualifier')
