"""make series organization optional

Revision ID: d8e3f0a2b5c7
Revises: c7d2e9f1a4b6
Create Date: 2026-09-29 16:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd8e3f0a2b5c7'
down_revision = 'c7d2e9f1a4b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("recurringseries", "organization_id", nullable=True)


def downgrade() -> None:
    # Fails while any series has no organization; assign one first.
    op.alter_column("recurringseries", "organization_id", nullable=False)
