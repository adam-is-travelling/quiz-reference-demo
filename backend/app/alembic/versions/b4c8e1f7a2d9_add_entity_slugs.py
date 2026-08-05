"""add slugs to quiz, organization, competition

Revision ID: b4c8e1f7a2d9
Revises: a7b3c9d1e2f4
Create Date: 2026-08-04 00:00:00.000000

"""

import re

import sqlalchemy as sa
from alembic import op

revision = "b4c8e1f7a2d9"
down_revision = "a7b3c9d1e2f4"
branch_labels = None
depends_on = None

TABLES = ("quiz", "organization", "competition")


def _slugify(text: str) -> str:
    # Mirrors app.crud.slugify. Reimplemented inline so the migration stays
    # self-contained and keeps working if the application helper changes.
    base = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_]+", "-", base).strip("-")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("slug", sa.String(255), nullable=True))

    conn = op.get_bind()
    for table in TABLES:
        if table == "quiz":
            rows = conn.execute(
                sa.text("SELECT id, name, start_date FROM quiz ORDER BY id")
            ).fetchall()
        else:
            rows = conn.execute(
                sa.text(f"SELECT id, name FROM {table} ORDER BY id")  # noqa: S608
            ).fetchall()

        seen: set[str] = set()
        for row in rows:
            base = _slugify(row.name or "")
            if table == "quiz":
                base = (
                    f"{base}-{row.start_date.isoformat()}"
                    if base
                    else str(row.start_date)
                )
            if not base:
                base = str(row.id)
            slug, counter = base, 2
            while slug in seen:
                slug = f"{base}-{counter}"
                counter += 1
            seen.add(slug)
            conn.execute(
                sa.text(f"UPDATE {table} SET slug = :slug WHERE id = :id"),  # noqa: S608
                {"slug": slug, "id": row.id},
            )

    for table in TABLES:
        op.alter_column(table, "slug", nullable=False)
        op.create_index(f"ix_{table}_slug", table, ["slug"], unique=True)


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"ix_{table}_slug", table_name=table)
        op.drop_column(table, "slug")
