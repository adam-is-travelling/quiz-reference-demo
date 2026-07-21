"""add player_merge_audit

Revision ID: e7a1b2c3d4f5
Revises: d3e8f1a2b4c6
Create Date: 2026-07-15
"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "e7a1b2c3d4f5"
down_revision = "d3e8f1a2b4c6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "player_merge_audit",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("performed_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "performed_by_email",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("source_player_id", sa.Uuid(), nullable=False),
        sa.Column(
            "source_display_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "source_slug", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True
        ),
        sa.Column("target_player_id", sa.Uuid(), nullable=False),
        sa.Column(
            "target_display_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("moved_results_count", sa.Integer(), nullable=False),
        sa.Column("deleted_conflicts_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["performed_by_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("player_merge_audit")
