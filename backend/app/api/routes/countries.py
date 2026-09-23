from fastapi import APIRouter, HTTPException

from app.api.deps import SessionDep
from app.country_page import COUNTRY_CODE_BY_SLUG, build_country_page
from app.models import CountryPagePublic

router = APIRouter(prefix="/countries", tags=["countries"])


@router.get("/{slug}", response_model=CountryPagePublic)
def read_country(slug: str, session: SessionDep) -> CountryPagePublic:
    code = COUNTRY_CODE_BY_SLUG.get(slug)
    if code is None:
        raise HTTPException(status_code=404, detail="Country not found")
    return build_country_page(session=session, code=code)
