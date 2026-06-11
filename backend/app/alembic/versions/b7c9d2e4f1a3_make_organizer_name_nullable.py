"""make_organizer_name_nullable

Revision ID: b7c9d2e4f1a3
Revises: f9213e8bae49
Create Date: 2026-06-10 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b7c9d2e4f1a3'
down_revision = 'f9213e8bae49'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('quizevent', 'organizer_name',
                    existing_type=sa.VARCHAR(length=255),
                    nullable=True)


def downgrade():
    op.execute("UPDATE quizevent SET organizer_name = '' WHERE organizer_name IS NULL")
    op.alter_column('quizevent', 'organizer_name',
                    existing_type=sa.VARCHAR(length=255),
                    nullable=False)
