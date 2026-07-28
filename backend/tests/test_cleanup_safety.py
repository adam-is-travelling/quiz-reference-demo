"""Guard: no test may issue an unconditional `delete(<Model>)` statement.

Tests must only delete rows they create. A bare `delete(Model)` (SQLAlchemy/
SQLModel statement builder) with no `.where(...)` deletes an entire table,
which has wiped real dev data before. This meta-test parses every module under
backend/tests/ and fails if any such unfiltered statement-delete exists.

It intentionally ignores `client.delete(...)` (HTTP calls) and `db.delete(obj)`
(single-object deletes) — both have an attribute `func`, not a bare `delete`
name, so they are never flagged.
"""

import ast
from pathlib import Path

TESTS_DIR = Path(__file__).parent


def _unconditional_delete_lines(path: Path) -> list[int]:
    tree = ast.parse(path.read_text(), filename=str(path))

    # delete(...) calls that are the receiver of a `.where(...)` call are safe.
    safe: set[int] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "where"
            and isinstance(node.func.value, ast.Call)
            and isinstance(node.func.value.func, ast.Name)
            and node.func.value.func.id == "delete"
        ):
            safe.add(id(node.func.value))

    offenders: list[int] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "delete"
            and id(node) not in safe
        ):
            offenders.append(node.lineno)
    return sorted(offenders)


def test_no_unconditional_statement_deletes() -> None:
    offenders: dict[str, list[int]] = {}
    for path in sorted(TESTS_DIR.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        lines = _unconditional_delete_lines(path)
        if lines:
            offenders[str(path.relative_to(TESTS_DIR))] = lines
    assert not offenders, (
        "Unconditional delete(<Model>) statements (no .where filter) found. "
        "Tests must delete only rows they create. Offenders (file -> lines): "
        f"{offenders}"
    )
