from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import EventResult, Organization, Player, QuizEvent, QuizSeries, User
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        init_db(session)

        # Snapshot IDs that exist before tests run so teardown preserves them
        pre: dict[type, set] = {
            model: {r.id for r in session.exec(select(model)).all()}
            for model in (EventResult, QuizEvent, QuizSeries, Player, Organization, User)
        }

        yield session

        # Delete in FK-safe order, skipping records that pre-existed the test run
        for model in (EventResult, QuizEvent, QuizSeries, Player, Organization, User):
            stmt = delete(model)
            if pre[model]:
                stmt = stmt.where(~col(model.id).in_(pre[model]))
            session.execute(stmt)
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def organizer_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    from tests.utils.user import create_organizer_user
    return create_organizer_user(client=client, db=db)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
