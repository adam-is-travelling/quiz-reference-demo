# Country Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `country` field on players with a constrained dropdown validated against ISO 3166-1 alpha-2 codes plus England/Scotland/Wales/Northern Ireland (ENG/SCO/WAL/NIR).

**Architecture:** A shared `backend/app/countries.py` module exports `VALID_COUNTRY_CODES` and `COUNTRY_NAMES` used by model validators and `normalize_country`. The frontend holds a parallel `countries.ts` list used by a `CountrySelect` native-select component wired into every place country is edited or displayed.

**Tech Stack:** Python/FastAPI/SQLModel (Pydantic v2 field_validator), Alembic, React/TypeScript, TanStack Router, react-hook-form

---

### Task 1: Create `backend/app/countries.py`

**Files:**
- Create: `backend/app/countries.py`
- Test: `backend/tests/test_countries.py` (skeleton only — full tests in Task 2)

- [ ] **Step 1: Write the failing import test**

```python
# backend/tests/test_countries.py
from app.countries import VALID_COUNTRY_CODES, COUNTRY_NAMES


def test_valid_country_codes_is_frozenset() -> None:
    assert isinstance(VALID_COUNTRY_CODES, frozenset)
    assert len(VALID_COUNTRY_CODES) > 250


def test_country_names_covers_all_codes() -> None:
    for code in VALID_COUNTRY_CODES:
        assert code in COUNTRY_NAMES, f"Missing name for {code}"


def test_home_nations_present() -> None:
    for code in ("ENG", "SCO", "WAL", "NIR"):
        assert code in VALID_COUNTRY_CODES
        assert code in COUNTRY_NAMES


def test_gb_present() -> None:
    assert "GB" in VALID_COUNTRY_CODES
    assert COUNTRY_NAMES["GB"] == "United Kingdom"
```

- [ ] **Step 2: Run test to verify it fails**

```
cd backend && python -m pytest tests/test_countries.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.countries'`

- [ ] **Step 3: Create `backend/app/countries.py`**

```python
COUNTRY_NAMES: dict[str, str] = {
    "AF": "Afghanistan",
    "AX": "Åland Islands",
    "AL": "Albania",
    "DZ": "Algeria",
    "AS": "American Samoa",
    "AD": "Andorra",
    "AO": "Angola",
    "AI": "Anguilla",
    "AQ": "Antarctica",
    "AG": "Antigua and Barbuda",
    "AR": "Argentina",
    "AM": "Armenia",
    "AW": "Aruba",
    "AU": "Australia",
    "AT": "Austria",
    "AZ": "Azerbaijan",
    "BS": "Bahamas",
    "BH": "Bahrain",
    "BD": "Bangladesh",
    "BB": "Barbados",
    "BY": "Belarus",
    "BE": "Belgium",
    "BZ": "Belize",
    "BJ": "Benin",
    "BM": "Bermuda",
    "BT": "Bhutan",
    "BO": "Bolivia",
    "BQ": "Bonaire, Sint Eustatius and Saba",
    "BA": "Bosnia and Herzegovina",
    "BW": "Botswana",
    "BV": "Bouvet Island",
    "BR": "Brazil",
    "IO": "British Indian Ocean Territory",
    "BN": "Brunei Darussalam",
    "BG": "Bulgaria",
    "BF": "Burkina Faso",
    "BI": "Burundi",
    "CV": "Cabo Verde",
    "KH": "Cambodia",
    "CM": "Cameroon",
    "CA": "Canada",
    "KY": "Cayman Islands",
    "CF": "Central African Republic",
    "TD": "Chad",
    "CL": "Chile",
    "CN": "China",
    "CX": "Christmas Island",
    "CC": "Cocos (Keeling) Islands",
    "CO": "Colombia",
    "KM": "Comoros",
    "CG": "Congo",
    "CD": "Congo, Democratic Republic",
    "CK": "Cook Islands",
    "CR": "Costa Rica",
    "CI": "Côte d'Ivoire",
    "HR": "Croatia",
    "CU": "Cuba",
    "CW": "Curaçao",
    "CY": "Cyprus",
    "CZ": "Czechia",
    "DK": "Denmark",
    "DJ": "Djibouti",
    "DM": "Dominica",
    "DO": "Dominican Republic",
    "EC": "Ecuador",
    "EG": "Egypt",
    "SV": "El Salvador",
    "GQ": "Equatorial Guinea",
    "ER": "Eritrea",
    "EE": "Estonia",
    "SZ": "Eswatini",
    "ET": "Ethiopia",
    "FK": "Falkland Islands",
    "FO": "Faroe Islands",
    "FJ": "Fiji",
    "FI": "Finland",
    "FR": "France",
    "GF": "French Guiana",
    "PF": "French Polynesia",
    "TF": "French Southern Territories",
    "GA": "Gabon",
    "GM": "Gambia",
    "GE": "Georgia",
    "DE": "Germany",
    "GH": "Ghana",
    "GI": "Gibraltar",
    "GR": "Greece",
    "GL": "Greenland",
    "GD": "Grenada",
    "GP": "Guadeloupe",
    "GU": "Guam",
    "GT": "Guatemala",
    "GG": "Guernsey",
    "GN": "Guinea",
    "GW": "Guinea-Bissau",
    "GY": "Guyana",
    "HT": "Haiti",
    "HM": "Heard Island and McDonald Islands",
    "VA": "Holy See",
    "HN": "Honduras",
    "HK": "Hong Kong",
    "HU": "Hungary",
    "IS": "Iceland",
    "IN": "India",
    "ID": "Indonesia",
    "IR": "Iran",
    "IQ": "Iraq",
    "IE": "Ireland",
    "IM": "Isle of Man",
    "IL": "Israel",
    "IT": "Italy",
    "JM": "Jamaica",
    "JP": "Japan",
    "JE": "Jersey",
    "JO": "Jordan",
    "KZ": "Kazakhstan",
    "KE": "Kenya",
    "KI": "Kiribati",
    "KP": "Korea (North)",
    "KR": "Korea (South)",
    "KW": "Kuwait",
    "KG": "Kyrgyzstan",
    "LA": "Laos",
    "LV": "Latvia",
    "LB": "Lebanon",
    "LS": "Lesotho",
    "LR": "Liberia",
    "LY": "Libya",
    "LI": "Liechtenstein",
    "LT": "Lithuania",
    "LU": "Luxembourg",
    "MO": "Macao",
    "MG": "Madagascar",
    "MW": "Malawi",
    "MY": "Malaysia",
    "MV": "Maldives",
    "ML": "Mali",
    "MT": "Malta",
    "MH": "Marshall Islands",
    "MQ": "Martinique",
    "MR": "Mauritania",
    "MU": "Mauritius",
    "YT": "Mayotte",
    "MX": "Mexico",
    "FM": "Micronesia",
    "MD": "Moldova",
    "MC": "Monaco",
    "MN": "Mongolia",
    "ME": "Montenegro",
    "MS": "Montserrat",
    "MA": "Morocco",
    "MZ": "Mozambique",
    "MM": "Myanmar",
    "NA": "Namibia",
    "NR": "Nauru",
    "NP": "Nepal",
    "NL": "Netherlands",
    "NC": "New Caledonia",
    "NZ": "New Zealand",
    "NI": "Nicaragua",
    "NE": "Niger",
    "NG": "Nigeria",
    "NU": "Niue",
    "NF": "Norfolk Island",
    "MK": "North Macedonia",
    "MP": "Northern Mariana Islands",
    "NO": "Norway",
    "OM": "Oman",
    "PK": "Pakistan",
    "PW": "Palau",
    "PS": "Palestine",
    "PA": "Panama",
    "PG": "Papua New Guinea",
    "PY": "Paraguay",
    "PE": "Peru",
    "PH": "Philippines",
    "PN": "Pitcairn",
    "PL": "Poland",
    "PT": "Portugal",
    "PR": "Puerto Rico",
    "QA": "Qatar",
    "RE": "Réunion",
    "RO": "Romania",
    "RU": "Russia",
    "RW": "Rwanda",
    "BL": "Saint Barthélemy",
    "SH": "Saint Helena",
    "KN": "Saint Kitts and Nevis",
    "LC": "Saint Lucia",
    "MF": "Saint Martin",
    "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines",
    "WS": "Samoa",
    "SM": "San Marino",
    "ST": "Sao Tome and Principe",
    "SA": "Saudi Arabia",
    "SN": "Senegal",
    "RS": "Serbia",
    "SC": "Seychelles",
    "SL": "Sierra Leone",
    "SG": "Singapore",
    "SX": "Sint Maarten",
    "SK": "Slovakia",
    "SI": "Slovenia",
    "SB": "Solomon Islands",
    "SO": "Somalia",
    "ZA": "South Africa",
    "GS": "South Georgia",
    "SS": "South Sudan",
    "ES": "Spain",
    "LK": "Sri Lanka",
    "SD": "Sudan",
    "SR": "Suriname",
    "SJ": "Svalbard and Jan Mayen",
    "SE": "Sweden",
    "CH": "Switzerland",
    "SY": "Syria",
    "TW": "Taiwan",
    "TJ": "Tajikistan",
    "TZ": "Tanzania",
    "TH": "Thailand",
    "TL": "Timor-Leste",
    "TG": "Togo",
    "TK": "Tokelau",
    "TO": "Tonga",
    "TT": "Trinidad and Tobago",
    "TN": "Tunisia",
    "TR": "Türkiye",
    "TM": "Turkmenistan",
    "TC": "Turks and Caicos Islands",
    "TV": "Tuvalu",
    "UG": "Uganda",
    "UA": "Ukraine",
    "AE": "United Arab Emirates",
    "GB": "United Kingdom",
    "UM": "United States Minor Outlying Islands",
    "US": "United States",
    "UY": "Uruguay",
    "UZ": "Uzbekistan",
    "VU": "Vanuatu",
    "VE": "Venezuela",
    "VN": "Vietnam",
    "VG": "Virgin Islands (British)",
    "VI": "Virgin Islands (U.S.)",
    "WF": "Wallis and Futuna",
    "EH": "Western Sahara",
    "YE": "Yemen",
    "ZM": "Zambia",
    "ZW": "Zimbabwe",
    # Home nations — compete independently in quizzing
    "ENG": "England",
    "SCO": "Scotland",
    "WAL": "Wales",
    "NIR": "Northern Ireland",
}

VALID_COUNTRY_CODES: frozenset[str] = frozenset(COUNTRY_NAMES.keys())
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd backend && python -m pytest tests/test_countries.py -v
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/countries.py backend/tests/test_countries.py
git commit -m "feat: add countries module with VALID_COUNTRY_CODES and COUNTRY_NAMES"
```

---

### Task 2: Add `normalize_country` to `backend/app/utils.py`

**Files:**
- Modify: `backend/app/utils.py`
- Modify: `backend/tests/test_countries.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_countries.py`:

```python
from app.utils import normalize_country


def test_normalize_country_exact_code_uppercase() -> None:
    assert normalize_country("IE") == "IE"


def test_normalize_country_exact_code_lowercase() -> None:
    assert normalize_country("ie") == "IE"


def test_normalize_country_home_nation_code() -> None:
    assert normalize_country("ENG") == "ENG"
    assert normalize_country("sco") == "SCO"


def test_normalize_country_full_name() -> None:
    assert normalize_country("Ireland") == "IE"
    assert normalize_country("ireland") == "IE"
    assert normalize_country("United Kingdom") == "GB"


def test_normalize_country_alias_uk() -> None:
    assert normalize_country("UK") == "GB"
    assert normalize_country("Britain") == "GB"
    assert normalize_country("Great Britain") == "GB"


def test_normalize_country_alias_home_nations() -> None:
    assert normalize_country("England") == "ENG"
    assert normalize_country("Scotland") == "SCO"
    assert normalize_country("Wales") == "WAL"
    assert normalize_country("Northern Ireland") == "NIR"


def test_normalize_country_alias_usa() -> None:
    assert normalize_country("USA") == "US"
    assert normalize_country("United States of America") == "US"


def test_normalize_country_alias_russia() -> None:
    assert normalize_country("Russia") == "RU"


def test_normalize_country_unknown_returns_none() -> None:
    assert normalize_country("Narnia") is None
    assert normalize_country("xyz123") is None


def test_normalize_country_none_input() -> None:
    assert normalize_country(None) is None


def test_normalize_country_empty_string() -> None:
    assert normalize_country("") is None
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd backend && python -m pytest tests/test_countries.py -v -k "normalize"
```
Expected: `ImportError: cannot import name 'normalize_country' from 'app.utils'`

- [ ] **Step 3: Add `normalize_country` to `backend/app/utils.py`**

Add at the top of the file after the existing imports:

```python
from app.countries import COUNTRY_NAMES, VALID_COUNTRY_CODES
```

Then add at the end of the file:

```python
_COUNTRY_ALIASES: dict[str, str] = {
    "UK": "GB",
    "UNITED KINGDOM": "GB",
    "BRITAIN": "GB",
    "GREAT BRITAIN": "GB",
    "ENGLAND": "ENG",
    "SCOTLAND": "SCO",
    "WALES": "WAL",
    "NORTHERN IRELAND": "NIR",
    "USA": "US",
    "UNITED STATES OF AMERICA": "US",
    "RUSSIA": "RU",
}

_COUNTRY_NAME_TO_CODE: dict[str, str] = {
    name.upper(): code for code, name in COUNTRY_NAMES.items()
}


def normalize_country(raw: str | None) -> str | None:
    if not raw:
        return None
    upper = raw.strip().upper()
    if upper in VALID_COUNTRY_CODES:
        return upper
    if upper in _COUNTRY_NAME_TO_CODE:
        return _COUNTRY_NAME_TO_CODE[upper]
    if upper in _COUNTRY_ALIASES:
        return _COUNTRY_ALIASES[upper]
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd backend && python -m pytest tests/test_countries.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/utils.py backend/tests/test_countries.py
git commit -m "feat: add normalize_country utility"
```

---

### Task 3: Update Player models with country validator; fix test helpers

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/tests/utils/quiz.py`
- Modify: `backend/tests/api/routes/test_players.py`
- Modify: `backend/tests/api/routes/test_events.py`
- Modify: `backend/tests/test_countries.py`

- [ ] **Step 1: Write the failing model validation tests**

Append to `backend/tests/test_countries.py`:

```python
import pytest
from pydantic import ValidationError
from app.models import PlayerBase, PlayerUpdate


def test_player_base_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerBase(display_name="Test", country="Narnia")


def test_player_base_accepts_valid_iso_code() -> None:
    p = PlayerBase(display_name="Test", country="IE")
    assert p.country == "IE"


def test_player_base_accepts_home_nation() -> None:
    p = PlayerBase(display_name="Test", country="ENG")
    assert p.country == "ENG"


def test_player_base_accepts_none_country() -> None:
    p = PlayerBase(display_name="Test", country=None)
    assert p.country is None


def test_player_update_rejects_invalid_country() -> None:
    with pytest.raises(ValidationError):
        PlayerUpdate(country="NotACode")


def test_player_update_accepts_none() -> None:
    p = PlayerUpdate(country=None)
    assert p.country is None
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd backend && python -m pytest tests/test_countries.py -v -k "player"
```
Expected: `AssertionError` / tests fail because validator doesn't exist yet

- [ ] **Step 3: Update `backend/app/models.py`**

Add the import at the top of `models.py` (after the existing imports):

```python
from pydantic import field_validator
from app.countries import VALID_COUNTRY_CODES
```

Change `PlayerBase` country field (line 277):

```python
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
        if v is None:
            return None
        if v not in VALID_COUNTRY_CODES:
            raise ValueError(f"Invalid country code: {v!r}")
        return v
```

Change `PlayerUpdate` country field (line 290):

```python
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
        if v is None:
            return None
        if v not in VALID_COUNTRY_CODES:
            raise ValueError(f"Invalid country code: {v!r}")
        return v
```

- [ ] **Step 4: Fix `create_random_player` in `backend/tests/utils/quiz.py`**

Change `country="Ireland"` to `country="IE"`:

```python
def create_random_player(db: Session) -> Player:
    return crud.create_player(
        session=db,
        player_in=PlayerCreate(
            display_name=random_lower_string(), country="IE"
        ),
    )
```

- [ ] **Step 5: Fix `backend/tests/api/routes/test_players.py`**

Change both occurrences of `"country": "Ireland"` to `"country": "IE"` (lines 96 and 105):

```python
def test_create_player_organizer(client: TestClient, db: Session) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "IE"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["display_name"] == "Test Player"
    assert data["slug"] is not None


def test_create_player_requires_organizer(client: TestClient, normal_user_token_headers: dict) -> None:
    payload = {"display_name": "Test Player", "country": "IE"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=normal_user_token_headers)
    assert r.status_code == 403
```

Also add the new validation tests to `test_players.py`:

```python
def test_create_player_invalid_country_returns_422(
    client: TestClient, db: Session
) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "Narnia"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 422


def test_create_player_null_country_succeeds(
    client: TestClient, db: Session
) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": None}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["country"] is None


def test_create_player_eng_country_succeeds(
    client: TestClient, db: Session
) -> None:
    headers = create_organizer_user(client=client, db=db)
    payload = {"display_name": "Test Player", "country": "ENG"}
    r = client.post(f"{settings.API_V1_STR}/players/", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["country"] == "ENG"
```

- [ ] **Step 6: Fix `backend/tests/api/routes/test_events.py`** — the `test_submit_results_creates_new_player` test sends `"country": "USA"` which will now fail validation (USA is not a valid code; US is). Change line 280:

```python
def test_submit_results_creates_new_player(
    client: TestClient,
    organizer_token_headers: dict[str, str],
    db: Session,
) -> None:
    event = create_random_event(db)
    response = client.post(
        f"{settings.API_V1_STR}/events/{event.id}/results",
        headers=organizer_token_headers,
        json={
            "results": [
                {
                    "player_create": {
                        "display_name": "Brand New Player",
                        "country": "US",
                    },
                    "score": 55.0,
                    "tiebreaker_rank": 1,
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1
```

- [ ] **Step 7: Run the full test suite to verify**

```
cd backend && python -m pytest tests/ -v
```
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/tests/utils/quiz.py backend/tests/api/routes/test_players.py backend/tests/api/routes/test_events.py backend/tests/test_countries.py
git commit -m "feat: add country validator to PlayerBase and PlayerUpdate models"
```

---

### Task 4: Alembic migration — normalize data then alter column

**Files:**
- Create: `backend/app/alembic/versions/<hash>_country_varchar3_nullable.py`

The migration has two phases: (1) data migration — normalize any existing `country` strings to codes and NULL out unresolvable ones; (2) schema change — alter column from `varchar(100) NOT NULL` to `varchar(3) NULL`.

**IMPORTANT:** The data migration must run BEFORE the schema alteration. Existing values like "Ireland" are 7 chars and will be truncated/rejected if you alter the column first.

- [ ] **Step 1: Generate the migration file**

Inside the running backend container (or with the venv activated):

```bash
docker compose exec backend alembic revision --autogenerate -m "country_varchar3_nullable"
```

This creates a new file in `backend/app/alembic/versions/`. Note the generated hash (e.g. `abc123def456`).

- [ ] **Step 2: Replace the generated migration body**

Open the generated file and replace the `upgrade()` and `downgrade()` functions with:

```python
def upgrade() -> None:
    # Phase 1: normalize existing country values to valid codes
    # Import here to avoid circular issues at migration load time
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
    from app.utils import normalize_country

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, country FROM player WHERE country IS NOT NULL"))
    for row in rows:
        normalized = normalize_country(row.country)
        conn.execute(
            sa.text("UPDATE player SET country = :code WHERE id = :id"),
            {"code": normalized, "id": str(row.id)},
        )

    # Phase 2: alter column — varchar(100) NOT NULL → varchar(3) NULL
    with op.batch_alter_table("player") as batch_op:
        batch_op.alter_column(
            "country",
            existing_type=sa.VARCHAR(length=100),
            type_=sa.VARCHAR(length=3),
            nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("player") as batch_op:
        batch_op.alter_column(
            "country",
            existing_type=sa.VARCHAR(length=3),
            type_=sa.VARCHAR(length=100),
            nullable=False,
            server_default="",
        )
```

- [ ] **Step 3: Apply the migration**

```bash
docker compose exec backend alembic upgrade head
```
Expected: `Running upgrade <prev> -> <new>, country_varchar3_nullable`

- [ ] **Step 4: Verify the column in the DB**

```bash
docker compose exec db psql -U app -d app -c "\d player"
```
Expected: `country` column shows `character varying(3)` and `Nullable`.

- [ ] **Step 5: Run tests to confirm nothing is broken**

```bash
docker compose exec backend bash scripts/tests-start.sh
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/alembic/versions/
git commit -m "feat: migrate player.country to varchar(3) nullable with data normalization"
```

---

### Task 5: Create `frontend/src/lib/countries.ts`

**Files:**
- Create: `frontend/src/lib/countries.ts`

- [ ] **Step 1: Create the file**

```typescript
// frontend/src/lib/countries.ts
export type Country = { code: string; name: string }

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AX", name: "Åland Islands" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AS", name: "American Samoa" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AI", name: "Anguilla" },
  { code: "AQ", name: "Antarctica" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AW", name: "Aruba" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BM", name: "Bermuda" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BQ", name: "Bonaire, Sint Eustatius and Saba" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BV", name: "Bouvet Island" },
  { code: "BR", name: "Brazil" },
  { code: "IO", name: "British Indian Ocean Territory" },
  { code: "BN", name: "Brunei Darussalam" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "KY", name: "Cayman Islands" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CX", name: "Christmas Island" },
  { code: "CC", name: "Cocos (Keeling) Islands" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo, Democratic Republic" },
  { code: "CK", name: "Cook Islands" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d'Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CW", name: "Curaçao" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FK", name: "Falkland Islands" },
  { code: "FO", name: "Faroe Islands" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GF", name: "French Guiana" },
  { code: "PF", name: "French Polynesia" },
  { code: "TF", name: "French Southern Territories" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" },
  { code: "GL", name: "Greenland" },
  { code: "GD", name: "Grenada" },
  { code: "GP", name: "Guadeloupe" },
  { code: "GU", name: "Guam" },
  { code: "GT", name: "Guatemala" },
  { code: "GG", name: "Guernsey" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HM", name: "Heard Island and McDonald Islands" },
  { code: "VA", name: "Holy See" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IM", name: "Isle of Man" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JE", name: "Jersey" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KP", name: "Korea (North)" },
  { code: "KR", name: "Korea (South)" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MO", name: "Macao" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MQ", name: "Martinique" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "YT", name: "Mayotte" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MS", name: "Montserrat" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NC", name: "New Caledonia" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "NU", name: "Niue" },
  { code: "NF", name: "Norfolk Island" },
  { code: "MK", name: "North Macedonia" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "NIR", name: "Northern Ireland" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestine" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PN", name: "Pitcairn" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "QA", name: "Qatar" },
  { code: "RE", name: "Réunion" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "BL", name: "Saint Barthélemy" },
  { code: "SH", name: "Saint Helena" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "MF", name: "Saint Martin" },
  { code: "PM", name: "Saint Pierre and Miquelon" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "Sao Tome and Principe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SCO", name: "Scotland" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SX", name: "Sint Maarten" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "GS", name: "South Georgia" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SJ", name: "Svalbard and Jan Mayen" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TK", name: "Tokelau" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Türkiye" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TC", name: "Turks and Caicos Islands" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "UM", name: "United States Minor Outlying Islands" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "VG", name: "Virgin Islands (British)" },
  { code: "VI", name: "Virgin Islands (U.S.)" },
  { code: "WAL", name: "Wales" },
  { code: "WF", name: "Wallis and Futuna" },
  { code: "EH", name: "Western Sahara" },
  { code: "ENG", name: "England" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
].sort((a, b) => a.name.localeCompare(b.name))

export function countryName(code: string | null | undefined): string {
  if (!code) return ""
  const entry = COUNTRIES.find((c) => c.code === code)
  return entry ? entry.name : code
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && bun run build 2>&1 | head -30
```
Expected: no errors related to `countries.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/countries.ts
git commit -m "feat: add frontend countries list with countryName helper"
```

---

### Task 6: Create `CountrySelect` component

**Files:**
- Create: `frontend/src/components/ui/CountrySelect.tsx`

- [ ] **Step 1: Create the component**

```typescript
// frontend/src/components/ui/CountrySelect.tsx
import { COUNTRIES } from "@/lib/countries"

interface CountrySelectProps {
  value: string | null | undefined
  onChange: (code: string | null) => void
  className?: string
}

export function CountrySelect({ value, onChange, className }: CountrySelectProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={
        className ??
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      <option value="">— Unknown —</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && bun run build 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/CountrySelect.tsx
git commit -m "feat: add CountrySelect native select component"
```

---

### Task 7: Update read-only country display in three frontend files

**Files:**
- Modify: `frontend/src/components/Players/PlayerProfile.tsx`
- Modify: `frontend/src/routes/_public/quizzers.tsx`
- Modify: `frontend/src/routes/_layout/admin_.players.$id.tsx`

- [ ] **Step 1: Update `PlayerProfile.tsx`**

Add import at the top:
```typescript
import { countryName } from "@/lib/countries"
```

Change line 86 (the subtitle line):
```typescript
          <p className="text-muted-foreground">
            {[countryName(player.country), player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
```

- [ ] **Step 2: Update `quizzers.tsx`**

Add import at the top:
```typescript
import { countryName } from "@/lib/countries"
```

Change line 60 (the card subtitle):
```typescript
              <p className="text-xs text-muted-foreground truncate">
                {[countryName(player.country), player.club].filter(Boolean).join(" · ")}
              </p>
```

- [ ] **Step 3: Update `admin_.players.$id.tsx` subtitle (line 83)**

Add import at the top:
```typescript
import { countryName } from "@/lib/countries"
```

Change the subtitle line from:
```typescript
          <p className="text-muted-foreground text-sm">
            {[player.country, player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
```
to:
```typescript
          <p className="text-muted-foreground text-sm">
            {[countryName(player.country), player.city, player.club]
              .filter(Boolean)
              .join(" · ")}
          </p>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && bun run build 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Players/PlayerProfile.tsx frontend/src/routes/_public/quizzers.tsx frontend/src/routes/_layout/admin_.players.\$id.tsx
git commit -m "feat: display country full name instead of raw code in read-only views"
```

---

### Task 8: Add country field to admin player edit form

**Files:**
- Modify: `frontend/src/routes/_layout/admin_.players.$id.tsx`

The current edit form has only slug, photo_url, and bio. Country needs to be added. The form uses `react-hook-form` with `useForm({ defaultValues: { slug, bio, photo_url } })`. Country is not currently in the form — it must be added to both `defaultValues` and the form JSX.

`PlayerUpdate` (from the generated client) has `country: string | null`. The `CountrySelect` onChange yields `string | null`.

- [ ] **Step 1: Update the form**

Full updated `PlayerEditForm` function in `frontend/src/routes/_layout/admin_.players.$id.tsx`:

Add `CountrySelect` to the imports:
```typescript
import { CountrySelect } from "@/components/ui/CountrySelect"
```

Update `useForm` defaultValues and add the country field to the form. The `country` field must use `Controller` from react-hook-form because `CountrySelect` is an uncontrolled-style native select, not a standard input:

```typescript
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Suspense } from "react"
import { Controller, useForm } from "react-hook-form"
import type { PlayerUpdate } from "@/client"
import { PlayersService } from "@/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { CountrySelect } from "@/components/ui/CountrySelect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countryName } from "@/lib/countries"
import useCustomToast from "@/hooks/useCustomToast"
```

Update `useForm` to include country:
```typescript
  const { register, handleSubmit, control } = useForm({
    defaultValues: {
      slug: player.slug ?? "",
      bio: player.bio ?? "",
      photo_url: player.photo_url ?? "",
      country: player.country ?? null,
    },
  })
```

Add the country field to the form JSX, after the Photo URL field and before the Bio field:
```tsx
        <div className="grid gap-1.5">
          <Label>Country</Label>
          <Controller
            name="country"
            control={control}
            render={({ field }) => (
              <CountrySelect
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && bun run build 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/_layout/admin_.players.\$id.tsx
git commit -m "feat: add country selector to admin player edit form"
```

---

### Task 9: Replace country `<Input>` with `<CountrySelect>` in Step4Disambiguation

**Files:**
- Modify: `frontend/src/components/Upload/steps/Step4Disambiguation.tsx`

Currently `RowDisambiguator` has `const [newCountry, setNewCountry] = useState(parsedRow.country)` and uses a plain `<Input>`. The `parsedRow.country` value comes from the CSV (raw text). We initialise the state with `null` since we can't assume the CSV value is a valid code (it hasn't been normalised on the frontend; backend `normalize_country` handles normalisation on submit). The `onChange` for `player_create` already accepts `country: string` — but `PlayerCreate` now requires `country: string | null`. The type in the client will reflect this after `generate-client.sh` is run (Task 4 changes the model). For now the type is already `string | null` from the model update.

- [ ] **Step 1: Update `Step4Disambiguation.tsx`**

Add `CountrySelect` import:
```typescript
import { CountrySelect } from "@/components/ui/CountrySelect"
```

In `RowDisambiguator`, change `newCountry` initial state from `parsedRow.country` (raw CSV string) to `null`:
```typescript
  const [newCountry, setNewCountry] = useState<string | null>(null)
```

Replace the country `<Input>` block:
```tsx
          <div className="grid gap-1">
            <Label className="text-xs">Country</Label>
            <CountrySelect
              value={newCountry}
              onChange={(code) => {
                setNewCountry(code)
                onChange({
                  player_id: null,
                  player_create: {
                    display_name: newName,
                    country: code,
                  },
                })
              }}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
```

Also remove the `Input` import if it is no longer used elsewhere in the file. Check: `Input` is also used for the Name field, so keep the import.

- [ ] **Step 2: Regenerate the frontend API client**

After the backend model changes (Task 3), regenerate the client so `PlayerCreate.country` reflects `string | null`:

```bash
cd /path/to/project && bash ./scripts/generate-client.sh
```

Expected: `frontend/src/client/` updated with nullable `country` on `PlayerCreate` and `PlayerBase`.

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
cd frontend && bun run build 2>&1 | head -50
```
Expected: clean build, no type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Upload/steps/Step4Disambiguation.tsx frontend/src/client/
git commit -m "feat: replace country freetext input with CountrySelect in upload disambiguation"
```

---

## Final verification

- [ ] Run the full backend test suite:
  ```bash
  docker compose exec backend bash scripts/tests-start.sh
  ```
  Expected: all tests PASS

- [ ] Run the frontend build:
  ```bash
  cd frontend && bun run build
  ```
  Expected: clean build, no type errors

- [ ] Start the dev stack and manually verify:
  - `/quizzers` page shows country names (e.g. "Ireland" not "IE")
  - Player profile page shows country names
  - Admin player edit form has a country dropdown that saves correctly
  - Upload wizard Step 4 shows a country dropdown for new players
