"""series_require_organization

Revision ID: c9d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-07-05

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c9d4e5f6a7b8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Organization is now required: remove orphaned series first.
    # Quizzes pointing at them are safe — quiz.series_id FK is ON DELETE SET NULL.
    conn.execute(sa.text("DELETE FROM quizseries WHERE organization_id IS NULL"))
    op.alter_column(
        'quizseries', 'organization_id', existing_type=sa.Uuid(), nullable=False
    )
    op.drop_constraint(
        'quizseries_organization_id_fkey', 'quizseries', type_='foreignkey'
    )
    op.create_foreign_key(
        None,
        'quizseries',
        'organization',
        ['organization_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint(
        'quizseries_organization_id_fkey', 'quizseries', type_='foreignkey'
    )
    op.create_foreign_key(
        'quizseries_organization_id_fkey',
        'quizseries',
        'organization',
        ['organization_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.alter_column(
        'quizseries', 'organization_id', existing_type=sa.Uuid(), nullable=True
    )
