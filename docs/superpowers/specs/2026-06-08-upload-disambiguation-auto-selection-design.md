# Upload Disambiguation Auto-Selection Design Spec

**Date:** 2026-06-08

## Overview

Step 4 of the upload wizard (Match Players) currently requires the admin to manually resolve every row. For large uploads (~4000 entries) this is impractical. This feature adds automatic resolution for clear cases and surfaces only the ambiguous rows for manual attention.

---

## Auto-Selection Logic (Frontend)

When `RowDisambiguator` mounts and its candidate query resolves, the initial resolution is set automatically using the following rules:

| Candidates | Condition | Resolution |
|---|---|---|
| None | No candidates returned | Auto-create: `player_create` populated from CSV row |
| One or more | Exactly one candidate ≥ 90% similarity | Auto-select: `player_id` set to that candidate |
| One or more | Multiple candidates ≥ 90% | Needs review: unresolved |
| One or more | All candidates < 90% | Needs review: unresolved |

The threshold is defined as a named constant `SIMILARITY_THRESHOLD = 0.9` in `Step4Disambiguation.tsx` so it can be adjusted in one place.

A row is considered **auto-resolved** if its resolution was set by this logic without admin input. A row **needs review** if it remains unresolved after the query settles.

Auto-resolved rows remain editable — the admin can expand the auto-resolved section and override any row.

---

## Diacritics Normalization (Backend)

The current `search_players` in `backend/app/crud.py` uses `SequenceMatcher` on lowercased strings, which treats "Šošić" and "Sosic" as distinct. A `_normalize` helper strips diacritics via Unicode NFD decomposition:

```python
import unicodedata

def _normalize(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )
```

Both the query `q` and each candidate's `display_name` are passed through `_normalize` before the similarity ratio is computed. The `ilike` filter used to fetch initial candidates also uses the normalized query so diacritic variants are included in the result set.

---

## UI Layout (Step4Disambiguation)

`Step4Disambiguation` splits all rows into two groups after candidate queries settle:

### Needs Review section (top)

- Shown when one or more rows are unresolved.
- Section heading: **"Needs Review (N)"** in destructive colour.
- Each row rendered with a red border (`border-destructive`).
- The "Next →" button remains disabled until this section is empty (all rows resolved).

### Auto-resolved section (bottom)

- Section heading: **"Auto-resolved (N)"** with a chevron toggle.
- Collapsed by default using a `<details>` / `<summary>` element (or equivalent controlled state).
- Each row shows a compact read-only summary: player name → matched name + country (or "new player"), with the same "(no published results)" amber badge if applicable.
- The admin can expand and override any row; overriding does not move it to the Needs Review section — it stays in Auto-resolved (now with a manual selection).
- If there are zero rows needing review, the auto-resolved section is expanded by default.

### Empty state

If every row is auto-resolved and there are no review rows, the step renders only the auto-resolved section (expanded) and the "Next →" button is enabled immediately.

---

## Out of Scope

- Persisting the threshold to user settings.
- Backend changes to the similarity algorithm beyond diacritics normalization.
- Auto-skipping Step 4 entirely when all rows are auto-resolved (admin should always have the opportunity to review).
