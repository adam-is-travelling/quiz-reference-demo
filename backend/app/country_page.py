"""The public country page: who has represented a country, its national team
appearances, and the medals its quizzers have won.

See docs/superpowers/specs/2026-09-22-country-pages-design.md for the rules
this module implements.
"""

from sqlmodel import Session

from app import crud
from app.countries import COUNTRY_NAMES
from app.models import CountryPagePublic

# Built once: country names are static, and slugify is the same rule every
# other slugged entity uses. The unit tests pin that no two names collide.
COUNTRY_CODE_BY_SLUG: dict[str, str] = {
    crud.slugify(name): code for code, name in COUNTRY_NAMES.items()
}


def country_slug(code: str) -> str:
    return crud.slugify(COUNTRY_NAMES[code])


def build_country_page(*, session: Session, code: str) -> CountryPagePublic:  # noqa: ARG001
    return CountryPagePublic(
        code=code, name=COUNTRY_NAMES[code], slug=country_slug(code)
    )
