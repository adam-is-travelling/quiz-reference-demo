"""
Local conftest for pure-Python unit tests that have no DB I/O.

Overrides the session-scoped autouse `db` fixture from tests/conftest.py so
these tests can run without a running database (before migrations are applied).
"""

from collections.abc import Generator

import pytest


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[None, None, None]:  # type: ignore[override]
    yield None
