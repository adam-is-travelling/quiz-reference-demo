"""normalize player countries into a join table

Revision ID: d3e8f1a2b4c6
Revises: c9d4e5f6a7b8
Create Date: 2026-07-07

"""
import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'd3e8f1a2b4c6'
down_revision = 'c9d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'player_country',
        sa.Column('player_id', sa.Uuid(), nullable=False),
        sa.Column('code', sa.String(length=3), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['player_id'], ['player.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('player_id', 'code'),
    )
    op.create_index(
        'ix_player_country_code', 'player_country', ['code'], unique=False
    )

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, countries FROM player")).fetchall()
    for row in rows:
        raw = row.countries
        codes = json.loads(raw) if isinstance(raw, str) else (raw or [])
        for index, code in enumerate(codes):
            conn.execute(
                sa.text(
                    "INSERT INTO player_country (player_id, code, is_primary) "
                    "VALUES (:player_id, :code, :is_primary)"
                ),
                {
                    "player_id": str(row.id),
                    "code": code,
                    "is_primary": index == 0,
                },
            )

    op.drop_column('player', 'countries')


def downgrade() -> None:
    op.add_column(
        'player',
        sa.Column('countries', sa.JSON(), nullable=False, server_default='[]'),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT player_id, code, is_primary FROM player_country")
    ).fetchall()
    by_player: dict[str, list[tuple[str, bool]]] = {}
    for row in rows:
        by_player.setdefault(str(row.player_id), []).append((row.code, row.is_primary))
    for player_id, links in by_player.items():
        primary = [code for code, is_primary in links if is_primary]
        rest = sorted(code for code, is_primary in links if not is_primary)
        conn.execute(
            sa.text("UPDATE player SET countries = CAST(:c AS JSON) WHERE id = :id"),
            {"c": json.dumps(primary + rest), "id": player_id},
        )

    op.alter_column('player', 'countries', server_default=None)
    op.drop_index('ix_player_country_code', table_name='player_country')
    op.drop_table('player_country')
