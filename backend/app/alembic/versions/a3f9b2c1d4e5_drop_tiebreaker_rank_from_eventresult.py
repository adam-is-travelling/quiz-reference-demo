"""drop tiebreaker_rank from eventresult

Revision ID: a3f9b2c1d4e5
Revises: 52478bef6bc8
Create Date: 2026-06-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3f9b2c1d4e5'
down_revision = '52478bef6bc8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('eventresult', 'tiebreaker_rank')


def downgrade() -> None:
    op.add_column('eventresult', sa.Column('tiebreaker_rank', sa.Integer(), nullable=False, server_default='1'))
