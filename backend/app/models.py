import enum
import uuid
from datetime import date, datetime, timezone

from pydantic import EmailStr, field_validator
from sqlalchemy import Column, DateTime, JSON, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

from app.countries import VALID_COUNTRY_CODES


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    is_organizer: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore[assignment]
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

class OrganizationBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)
    website: str | None = Field(default=None, max_length=512)
    logo_url: str | None = Field(default=None, max_length=512)


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    website: str | None = Field(default=None, max_length=512)
    logo_url: str | None = Field(default=None, max_length=512)


class Organization(OrganizationBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)


class OrganizationPublic(OrganizationBase):
    id: uuid.UUID


class OrganizationsPublic(SQLModel):
    data: list[OrganizationPublic]
    count: int


# ---------------------------------------------------------------------------
# QuizFormat
# ---------------------------------------------------------------------------

class QuizFormatBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)
    rounds: list[str] = Field(default_factory=list)


class QuizFormatCreate(QuizFormatBase):
    pass


class QuizFormatUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    rounds: list[str] | None = Field(default=None)


class QuizFormat(QuizFormatBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    rounds: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class QuizFormatPublic(QuizFormatBase):
    id: uuid.UUID


class QuizFormatsPublic(SQLModel):
    data: list[QuizFormatPublic]
    count: int


# ---------------------------------------------------------------------------
# QuizSeries
# ---------------------------------------------------------------------------

class QuizSeriesBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)


class QuizSeriesCreate(QuizSeriesBase):
    organization_id: uuid.UUID | None = None


class QuizSeriesUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    organization_id: uuid.UUID | None = None


class QuizSeries(QuizSeriesBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    organization_id: uuid.UUID | None = Field(
        default=None, foreign_key="organization.id", ondelete="SET NULL"
    )


class QuizSeriesPublic(QuizSeriesBase):
    id: uuid.UUID
    organization_id: uuid.UUID | None = None


class QuizSeriesListPublic(SQLModel):
    data: list[QuizSeriesPublic]
    count: int


# ---------------------------------------------------------------------------
# Quiz
# ---------------------------------------------------------------------------

class QuizStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class QuizBase(SQLModel):
    name: str = Field(max_length=255)
    start_date: date
    end_date: date
    description: str | None = Field(default=None)
    organizer_name: str | None = Field(default=None, max_length=255)


class QuizCreate(QuizBase):
    format_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None


class QuizUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    organizer_name: str | None = Field(default=None, max_length=255)
    format_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None


class Quiz(QuizBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    status: QuizStatus = Field(default=QuizStatus.pending)
    submitted_by_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    series_id: uuid.UUID | None = Field(
        default=None, foreign_key="quizseries.id", ondelete="SET NULL"
    )
    organization_id: uuid.UUID | None = Field(
        default=None, foreign_key="organization.id", ondelete="SET NULL"
    )
    format_id: uuid.UUID | None = Field(
        default=None, foreign_key="quizformat.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )


class QuizPublic(QuizBase):
    id: uuid.UUID
    status: QuizStatus
    submitted_by_id: uuid.UUID
    series_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    format_id: uuid.UUID | None = None
    format: QuizFormatPublic | None = None
    created_at: datetime | None = None


class QuizzesPublic(SQLModel):
    data: list[QuizPublic]
    count: int


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------


def _validate_country_code(v: str | None) -> str | None:
    if v is None:
        return None
    if v not in VALID_COUNTRY_CODES:
        raise ValueError(f"Invalid country code: {v!r}")
    return v


class PlayerBase(SQLModel):
    display_name: str = Field(max_length=255)
    country: str | None = Field(default=None, max_length=3)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = Field(default=None)
    photo_url: str | None = Field(default=None, max_length=512)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)


class PlayerCreate(PlayerBase):
    pass


class PlayerUpdate(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=3)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    photo_url: str | None = Field(default=None, max_length=512)
    slug: str | None = Field(default=None, max_length=255)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)


class Player(PlayerBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str | None = Field(default=None, unique=True, index=True, max_length=255)
    is_published: bool = Field(default=False)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )


class PlayerPublic(PlayerBase):
    id: uuid.UUID
    slug: str | None = None
    is_published: bool = False
    created_at: datetime | None = None


class PlayersPublic(SQLModel):
    data: list[PlayerPublic]
    count: int


class PlayerSearchResult(SQLModel):
    player: PlayerPublic
    similarity: float


class PlayerSearchResults(SQLModel):
    data: list[PlayerSearchResult]


class PlayerResultWithQuiz(SQLModel):
    result_id: uuid.UUID
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    end_date: date
    score: float
    final_rank: int | None = None


class PlayerHistory(SQLModel):
    data: list[PlayerResultWithQuiz]


# ---------------------------------------------------------------------------
# QuizResult
# ---------------------------------------------------------------------------

class QuizResultCreate(SQLModel):
    player_id: uuid.UUID
    final_rank: int
    score: float
    round_scores: list[float | None] | None = None


class QuizResultUpdate(SQLModel):
    final_rank: int | None = None
    score: float | None = None
    round_scores: list[float | None] | None = None


class QuizResult(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("quiz_id", "player_id"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    quiz_id: uuid.UUID = Field(foreign_key="quiz.id", ondelete="CASCADE")
    player_id: uuid.UUID = Field(foreign_key="player.id", ondelete="CASCADE")
    score: float
    final_rank: int | None = None
    round_1: float | None = None
    round_2: float | None = None
    round_3: float | None = None
    round_4: float | None = None
    round_5: float | None = None
    round_6: float | None = None
    round_7: float | None = None
    round_8: float | None = None
    round_9: float | None = None
    round_10: float | None = None
    round_11: float | None = None
    round_12: float | None = None
    round_13: float | None = None
    round_14: float | None = None
    round_15: float | None = None
    round_16: float | None = None
    round_17: float | None = None
    round_18: float | None = None
    round_19: float | None = None
    round_20: float | None = None


class QuizResultPublic(SQLModel):
    id: uuid.UUID
    quiz_id: uuid.UUID
    player_id: uuid.UUID
    score: float
    final_rank: int | None = None
    round_scores: list[float | None] | None = None


class QuizResultsPublic(SQLModel):
    data: list[QuizResultPublic]
    count: int


class QuizResultWithPlayer(SQLModel):
    id: uuid.UUID
    quiz_id: uuid.UUID
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    final_rank: int | None = None
    round_scores: list[float | None] | None = None


class QuizResultsWithPlayersPublic(SQLModel):
    data: list[QuizResultWithPlayer]
    count: int


# ---------------------------------------------------------------------------
# Upload flow — parse / submit models
# ---------------------------------------------------------------------------

class ParsedResultRow(SQLModel):
    player_name: str
    country: str  # raw CSV value; normalized in upload flow (see Step4Disambiguation)
    score: float


class ParseResultsRequest(SQLModel):
    rows: list[ParsedResultRow]


class ParsedResultWithCandidates(SQLModel):
    row: ParsedResultRow
    candidates: list[PlayerSearchResult]


class ParseResultsResponse(SQLModel):
    results: list[ParsedResultWithCandidates]


class ResolvedResultRow(SQLModel):
    player_id: uuid.UUID | None = None
    player_create: PlayerCreate | None = None
    final_rank: int
    score: float | None = None
    round_scores: list[float | None] | None = None


class SubmitMode(str, enum.Enum):
    append = "append"
    replace = "replace"


class SubmitResultsRequest(SQLModel):
    results: list[ResolvedResultRow]
    mode: SubmitMode = SubmitMode.append
