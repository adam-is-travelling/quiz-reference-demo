import enum
import uuid
from datetime import date, datetime, timezone

from pydantic import EmailStr, field_validator, model_validator
from sqlalchemy import Boolean, Column, DateTime, Enum as SAEnum, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.countries import VALID_COUNTRY_CODES


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


def _validate_slug_shape(v: str | None) -> str | None:
    """Reject a slug that isn't already in slugified form.

    Imports `app.crud.slugify` lazily to avoid a circular import (`app.crud`
    imports from `app.models` at module load time); by the time a request
    actually validates a slug, `app.crud` is fully loaded.
    """
    if v is None:
        return v
    from app.crud import slugify

    if slugify(v) != v:
        raise ValueError(
            "Slug must be lowercase, hyphenated, and contain no other characters"
        )
    return v


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


class UserMePublic(UserPublic):
    db_target: str | None = None


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
    slug: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        return _validate_slug_shape(v)


class Organization(OrganizationBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True, max_length=255)


class OrganizationPublic(OrganizationBase):
    id: uuid.UUID
    slug: str


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
    per_round_stats_eligible: bool = False


class QuizFormatCreate(QuizFormatBase):
    pass


class QuizFormatUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    rounds: list[str] | None = Field(default=None)
    per_round_stats_eligible: bool | None = None


class QuizFormat(QuizFormatBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    rounds: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    per_round_stats_eligible: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )


class QuizFormatPublic(QuizFormatBase):
    id: uuid.UUID


class QuizFormatsPublic(SQLModel):
    data: list[QuizFormatPublic]
    count: int


# ---------------------------------------------------------------------------
# Competition
# ---------------------------------------------------------------------------

class CompetitionBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)


class CompetitionCreate(CompetitionBase):
    organization_id: uuid.UUID


class CompetitionUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    organization_id: uuid.UUID | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        return _validate_slug_shape(v)


class Competition(CompetitionBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    organization_id: uuid.UUID = Field(
        foreign_key="organization.id", ondelete="CASCADE"
    )
    slug: str = Field(unique=True, index=True, max_length=255)


class CompetitionPublic(CompetitionBase):
    id: uuid.UUID
    slug: str
    organization_id: uuid.UUID
    organization_name: str | None = None
    organization_slug: str | None = None


class CompetitionListPublic(SQLModel):
    data: list[CompetitionPublic]
    count: int


# ---------------------------------------------------------------------------
# Event
# ---------------------------------------------------------------------------


class EventValidationError(ValueError):
    """Raised when an event's location or date fields are inconsistent.

    Distinct from the plain ValueError that signals a slug collision, so the
    route layer can map the two to 422 and 409 respectively.
    """


def validate_event_fields(
    *,
    is_online: bool,
    venue: str | None,
    city: str | None,
    country: str | None,
    start_date: date,
    end_date: date,
) -> None:
    """Validate the merged state of an event.

    Called by EventCreate's model validator and, on the update path, by
    crud.update_event against the stored row merged with the patch — a
    partial PATCH cannot be judged from the patch alone.
    """
    if is_online:
        if venue is not None or city is not None or country is not None:
            raise EventValidationError(
                "An online event cannot have a venue, city, or country"
            )
    else:
        if country is None:
            raise EventValidationError("An in-person event requires a country")
        _validate_country_code(country)
    if end_date < start_date:
        raise EventValidationError("end_date must not be before start_date")


class EventBase(SQLModel):
    name: str = Field(max_length=255)
    description: str | None = Field(default=None)
    start_date: date
    end_date: date
    is_online: bool = False
    venue: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=3)


class EventCreate(EventBase):
    organization_id: uuid.UUID

    @model_validator(mode="after")
    def validate_fields(self) -> "EventCreate":
        validate_event_fields(
            is_online=self.is_online,
            venue=self.venue,
            city=self.city,
            country=self.country,
            start_date=self.start_date,
            end_date=self.end_date,
        )
        return self


class EventUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_online: bool | None = None
    venue: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=3)
    organization_id: uuid.UUID | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        return _validate_slug_shape(v)


class Event(EventBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True, max_length=255)
    organization_id: uuid.UUID = Field(
        foreign_key="organization.id", ondelete="CASCADE"
    )


class EventPublic(EventBase):
    id: uuid.UUID
    slug: str
    organization_id: uuid.UUID
    organization_name: str | None = None
    organization_slug: str | None = None
    quiz_count: int = 0


class EventListPublic(SQLModel):
    data: list[EventPublic]
    count: int


# ---------------------------------------------------------------------------
# Quiz
# ---------------------------------------------------------------------------

class QuizStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class QuizParticipantMode(str, enum.Enum):
    individual = "individual"
    pairs = "pairs"


class QuizBase(SQLModel):
    name: str = Field(max_length=255)
    start_date: date
    end_date: date
    description: str | None = Field(default=None)
    organizer_name: str | None = Field(default=None, max_length=255)
    participant_mode: QuizParticipantMode = QuizParticipantMode.individual


class QuizCreate(QuizBase):
    format_id: uuid.UUID | None = None
    competition_id: uuid.UUID | None = None
    event_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None


class QuizUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=255)
    start_date: date | None = None
    end_date: date | None = None
    description: str | None = None
    organizer_name: str | None = Field(default=None, max_length=255)
    format_id: uuid.UUID | None = None
    competition_id: uuid.UUID | None = None
    event_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)
    participant_mode: QuizParticipantMode | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        return _validate_slug_shape(v)


class Quiz(QuizBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True, max_length=255)
    status: QuizStatus = Field(default=QuizStatus.pending)
    submitted_by_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    competition_id: uuid.UUID | None = Field(
        default=None, foreign_key="competition.id", ondelete="SET NULL"
    )
    event_id: uuid.UUID | None = Field(
        default=None, foreign_key="event.id", ondelete="SET NULL"
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
    participant_mode: QuizParticipantMode = Field(
        default=QuizParticipantMode.individual,
        sa_column=Column(
            SAEnum(QuizParticipantMode, name="quizparticipantmode"),
            nullable=False,
            server_default="individual",
        ),
    )


class QuizPublic(QuizBase):
    id: uuid.UUID
    slug: str
    status: QuizStatus
    submitted_by_id: uuid.UUID
    competition_id: uuid.UUID | None = None
    event_id: uuid.UUID | None = None
    event_name: str | None = None
    event_slug: str | None = None
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


def _validate_country_codes(v: list[str]) -> list[str]:
    if len(v) != len(set(v)):
        raise ValueError("Duplicate country codes are not allowed")
    for code in v:
        if code not in VALID_COUNTRY_CODES:
            raise ValueError(f"Invalid country code: {code!r}")
    return v


class PlayerCountry(SQLModel, table=True):
    __tablename__ = "player_country"
    player_id: uuid.UUID = Field(
        foreign_key="player.id", primary_key=True, ondelete="CASCADE"
    )
    code: str = Field(max_length=3, primary_key=True)
    is_primary: bool = Field(default=False)


class PlayerBase(SQLModel):
    display_name: str = Field(max_length=255)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = Field(default=None)
    photo_url: str | None = Field(default=None, max_length=512)


class PlayerCreate(PlayerBase):
    countries: list[str] = Field(default_factory=list)

    @field_validator("countries")
    @classmethod
    def validate_countries(cls, v: list[str]) -> list[str]:
        return _validate_country_codes(v)


class PlayerUpdate(SQLModel):
    display_name: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, max_length=3)
    countries: list[str] | None = Field(default=None)
    city: str | None = Field(default=None, max_length=255)
    club: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    photo_url: str | None = Field(default=None, max_length=512)
    slug: str | None = Field(default=None, max_length=255)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)

    @field_validator("countries")
    @classmethod
    def validate_countries(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return _validate_country_codes(v)


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
    countries: list[str] = Field(default_factory=list)


class PlayersPublic(SQLModel):
    data: list[PlayerPublic]
    count: int


class PlayerSearchResult(SQLModel):
    player: PlayerPublic
    similarity: float


class PlayerSearchResults(SQLModel):
    data: list[PlayerSearchResult]


SEARCH_BATCH_MAX_NAMES = 500


class PlayerSearchBatchRequest(SQLModel):
    names: list[str] = Field(max_length=SEARCH_BATCH_MAX_NAMES)


class PlayerSearchBatchResponse(SQLModel):
    results: dict[str, list[PlayerSearchResult]]


class ResultPartner(SQLModel):
    player_id: uuid.UUID
    display_name: str
    slug: str | None = None


class PlayerResultWithQuiz(SQLModel):
    result_id: uuid.UUID
    quiz_id: uuid.UUID
    quiz_name: str
    quiz_slug: str | None = None
    start_date: date
    end_date: date
    score: float
    final_rank: int | None = None
    country: str | None = None
    competition_id: uuid.UUID | None = None
    competition_name: str | None = None
    partners: list[ResultPartner] = Field(default_factory=list)


class PlayerHistory(SQLModel):
    data: list[PlayerResultWithQuiz]


class PlayerCompetitionGroup(SQLModel):
    competition_id: uuid.UUID | None
    competition_name: str | None
    competition_slug: str | None
    results: list[PlayerResultWithQuiz]
    total_count: int


class PlayerHistoryGrouped(SQLModel):
    data: list[PlayerCompetitionGroup]
    total_quizzes: int
    wins: int
    podiums: int


class PlayerCompetitionHistory(SQLModel):
    data: list[PlayerResultWithQuiz]
    count: int
    competition_name: str | None = None


# ---------------------------------------------------------------------------
# Player merge
# ---------------------------------------------------------------------------


class MergePlayersRequest(SQLModel):
    source_player_id: uuid.UUID
    target_player_id: uuid.UUID


class MergeConflict(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    start_date: date
    source_score: float
    source_rank: int | None
    target_score: float
    target_rank: int | None


class MergePlayersPreview(SQLModel):
    moved_results_count: int
    conflicts: list[MergeConflict]
    filled_fields: list[str]
    added_countries: list[str]


class PlayerMergeAudit(SQLModel, table=True):
    __tablename__ = "player_merge_audit"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    merged_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )
    performed_by_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", nullable=True, ondelete="SET NULL"
    )
    performed_by_email: str = Field(max_length=255)
    source_player_id: uuid.UUID
    source_display_name: str = Field(max_length=255)
    source_slug: str | None = Field(default=None, max_length=255)
    target_player_id: uuid.UUID
    target_display_name: str = Field(max_length=255)
    moved_results_count: int
    deleted_conflicts_count: int


class PlayerMergeAuditPublic(SQLModel):
    id: uuid.UUID
    merged_at: datetime | None
    performed_by_email: str
    source_player_id: uuid.UUID
    source_display_name: str
    source_slug: str | None
    target_player_id: uuid.UUID
    target_display_name: str
    moved_results_count: int
    deleted_conflicts_count: int


class PlayerMergeAuditsPublic(SQLModel):
    data: list[PlayerMergeAuditPublic]
    count: int


# ---------------------------------------------------------------------------
# QuizResult
# ---------------------------------------------------------------------------

class ResultParticipant(SQLModel):
    """One member of a result, as submitted by the upload wizard."""

    player_id: uuid.UUID | None = None
    player_create: PlayerCreate | None = None
    country: str | None = Field(default=None, max_length=3)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)


class ResultParticipantCreate(SQLModel):
    """One member of a result, after players have been resolved to ids."""

    player_id: uuid.UUID
    country: str | None = Field(default=None, max_length=3)


class QuizResultCreate(SQLModel):
    player_id: uuid.UUID
    final_rank: int
    score: float
    round_scores: list[float | None] | None = None
    country: str | None = Field(default=None, max_length=3)
    participants: list[ResultParticipantCreate] = Field(default_factory=list)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)


class QuizResultUpdate(SQLModel):
    final_rank: int | None = None
    score: float | None = None
    round_scores: list[float | None] | None = None
    country: str | None = Field(default=None, max_length=3)

    @field_validator("country")
    @classmethod
    def validate_country(cls, v: str | None) -> str | None:
        return _validate_country_code(v)


class QuizResult(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("quiz_id", "player_id"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    quiz_id: uuid.UUID = Field(foreign_key="quiz.id", ondelete="CASCADE")
    player_id: uuid.UUID = Field(foreign_key="player.id", ondelete="CASCADE")
    score: float
    final_rank: int | None = None
    country: str | None = Field(default=None, max_length=3)
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


class QuizResultPlayer(SQLModel, table=True):
    __tablename__ = "quiz_result_player"
    __table_args__ = (UniqueConstraint("quiz_id", "player_id"),)

    quiz_result_id: uuid.UUID = Field(
        foreign_key="quizresult.id", primary_key=True, ondelete="CASCADE"
    )
    slot: int = Field(primary_key=True)
    quiz_id: uuid.UUID = Field(
        foreign_key="quiz.id", index=True, ondelete="CASCADE"
    )
    player_id: uuid.UUID = Field(
        foreign_key="player.id", index=True, ondelete="CASCADE"
    )
    country: str | None = Field(default=None, max_length=3)


class QuizResultPublic(SQLModel):
    id: uuid.UUID
    quiz_id: uuid.UUID
    player_id: uuid.UUID
    score: float
    final_rank: int | None = None
    country: str | None = None
    round_scores: list[float | None] | None = None


class QuizResultsPublic(SQLModel):
    data: list[QuizResultPublic]
    count: int


class ResultParticipantPublic(SQLModel):
    slot: int
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    country: str | None = None


class QuizResultWithPlayer(SQLModel):
    id: uuid.UUID
    quiz_id: uuid.UUID
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    final_rank: int | None = None
    country: str | None = None
    round_scores: list[float | None] | None = None
    participants: list[ResultParticipantPublic] = Field(default_factory=list)


class QuizResultsWithPlayersPublic(SQLModel):
    data: list[QuizResultWithPlayer]
    count: int


class PodiumFinisher(SQLModel):
    place: int
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    score: float
    country: str | None = None


class QuizPodium(SQLModel):
    quiz_id: uuid.UUID
    quiz_name: str
    quiz_slug: str | None = None
    start_date: date
    end_date: date
    finishers: list[PodiumFinisher]


class PodiumStanding(SQLModel):
    player_id: uuid.UUID
    player_display_name: str
    player_slug: str | None = None
    gold: int
    silver: int
    bronze: int


class PodiumPublic(SQLModel):
    quizzes: list[QuizPodium]
    standings: list[PodiumStanding]


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
    country: str | None = None
    participants: list[ResultParticipant] = Field(default_factory=list)


class SubmitMode(str, enum.Enum):
    append = "append"
    replace = "replace"


class SubmitResultsRequest(SQLModel):
    results: list[ResolvedResultRow]
    mode: SubmitMode = SubmitMode.append
