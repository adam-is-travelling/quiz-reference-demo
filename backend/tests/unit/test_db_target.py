from app.core.config import Settings, format_db_target, settings


def test_db_target_field_defaults_to_dev() -> None:
    assert Settings.model_fields["DB_TARGET"].default == "dev"


def test_settings_exposes_db_target() -> None:
    assert isinstance(settings.DB_TARGET, str)
    assert settings.DB_TARGET != ""


def test_format_db_target_names_target_and_host() -> None:
    msg = format_db_target()
    assert f"Database target: {settings.DB_TARGET}" in msg
    assert settings.POSTGRES_SERVER in msg
    assert str(settings.POSTGRES_PORT) in msg
    assert settings.POSTGRES_DB in msg


def test_format_db_target_never_leaks_password() -> None:
    # The password may be blank in some envs; only assert when it is set.
    if settings.POSTGRES_PASSWORD:
        assert settings.POSTGRES_PASSWORD not in format_db_target()
