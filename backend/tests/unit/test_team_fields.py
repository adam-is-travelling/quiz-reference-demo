import pytest

from app.models import (
    QuizParticipantMode,
    TeamFieldsError,
    TeamType,
    validate_team_fields,
)


def _validate(**overrides: object) -> None:
    kwargs: dict[str, object] = {
        "participant_mode": QuizParticipantMode.teams,
        "team_name": "England A",
        "team_type": TeamType.national,
        "team_country": "GB",
    }
    kwargs.update(overrides)
    validate_team_fields(**kwargs)  # type: ignore[arg-type]


def test_national_team_with_country_is_valid() -> None:
    _validate()


def test_international_side_is_a_national_team_without_a_country() -> None:
    _validate(team_country=None)


def test_club_without_country_is_valid() -> None:
    _validate(team_type=TeamType.club, team_country=None)


def test_teams_mode_requires_a_team_name() -> None:
    with pytest.raises(TeamFieldsError, match="team_name"):
        _validate(team_name=None)


def test_teams_mode_rejects_a_blank_team_name() -> None:
    with pytest.raises(TeamFieldsError, match="team_name"):
        _validate(team_name="   ")


def test_teams_mode_requires_a_team_type() -> None:
    with pytest.raises(TeamFieldsError, match="team_type"):
        _validate(team_type=None)


def test_individual_quiz_rejects_team_fields() -> None:
    with pytest.raises(TeamFieldsError, match="teams quiz"):
        _validate(participant_mode=QuizParticipantMode.individual)


def test_pairs_quiz_rejects_team_fields() -> None:
    with pytest.raises(TeamFieldsError, match="teams quiz"):
        _validate(participant_mode=QuizParticipantMode.pairs)


def test_individual_quiz_accepts_all_team_fields_unset() -> None:
    validate_team_fields(
        participant_mode=QuizParticipantMode.individual,
        team_name=None,
        team_type=None,
        team_country=None,
    )


def test_invalid_country_code_is_rejected() -> None:
    with pytest.raises(ValueError, match="Invalid country code"):
        _validate(team_country="ZZ")
