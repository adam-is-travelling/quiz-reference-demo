from sqlalchemy import inspect
from sqlmodel import Session


def test_recurringseries_table_replaces_competition(db: Session) -> None:
    tables = inspect(db.get_bind()).get_table_names()
    assert "recurringseries" in tables
    assert "competition" not in tables


def test_quiz_references_series_by_series_id(db: Session) -> None:
    insp = inspect(db.get_bind())
    columns = {c["name"] for c in insp.get_columns("quiz")}
    assert "series_id" in columns
    assert "competition_id" not in columns

    fks = {fk["name"]: fk for fk in insp.get_foreign_keys("quiz")}
    fk = fks["quiz_series_id_fkey"]
    assert fk["referred_table"] == "recurringseries"
    assert fk["constrained_columns"] == ["series_id"]
    assert fk["options"].get("ondelete") == "SET NULL"


def test_recurringseries_constraint_and_index_names(db: Session) -> None:
    # Postgres carries names through a table rename; the migration renames them
    # so the schema never still reads "competition".
    insp = inspect(db.get_bind())
    assert insp.get_pk_constraint("recurringseries")["name"] == "recurringseries_pkey"
    assert "ix_recurringseries_slug" in {
        i["name"] for i in insp.get_indexes("recurringseries")
    }
    assert {fk["name"] for fk in insp.get_foreign_keys("recurringseries")} == {
        "recurringseries_organization_id_fkey"
    }


def test_recurringseries_type_column_defaults_to_quiz(db: Session) -> None:
    columns = {c["name"]: c for c in inspect(db.get_bind()).get_columns("recurringseries")}
    assert "type" in columns
    assert columns["type"]["nullable"] is False
    assert "quiz" in str(columns["type"]["default"])


def test_event_references_series_by_series_id(db: Session) -> None:
    insp = inspect(db.get_bind())
    assert "series_id" in {c["name"] for c in insp.get_columns("event")}
    fks = {fk["name"]: fk for fk in insp.get_foreign_keys("event")}
    fk = fks["event_series_id_fkey"]
    assert fk["referred_table"] == "recurringseries"
    assert fk["constrained_columns"] == ["series_id"]
    assert fk["options"].get("ondelete") == "SET NULL"
