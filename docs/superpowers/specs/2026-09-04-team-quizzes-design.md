# Team quizzes

**Date:** 2026-09-04
**Status:** Design approved

## Problem

Some quizzes are contested by teams — a national side, a club, or a mixed international
squad. Today a result carries one or two players via `quiz_result_player`, with no way to
record who they played *for*. A team result can only be entered by inventing a fake player
named after the team, which loses every squad member's record, or by entering one member,
which loses the rest.

This spec adds teams as a third participant shape: a quiz declares that its results are
contested by teams, a result names the team and carries the squad that turned out, and every
member of that squad gets the result on their public record.

It builds directly on the pairs work (`2026-09-02-pairs-quizzes-design.md`), which moved
participants out of `QuizResult` into a join table and made every read path participant-keyed.
Most of that machinery is reused unchanged.

## A team is per quiz, not global

The single most important decision here: **a team has no cross-quiz identity**. "England A" at
2026 IQC and "England A" at some other quiz are different teams that happen to share a name.

This follows from how squads actually work. The eight people who turned out for England A in
2026 are not the eight who turn out in 2027, and a roster that is edited in one place while
being referenced from many quizzes cannot represent both truthfully. Correcting the 2026 IQC
lineup must be structurally incapable of touching any other quiz's England A.

Two consequences:

- There is **no `team` table**. A team belongs to exactly one result, so a table would be 1:1
  with `QuizResult`. The team's name, type and country are columns on the result.
- There is **no standing roster**. The squad *is* the result's `quiz_result_player` rows,
  which are keyed by `quiz_result_id`. Editing one lineup has no representation anywhere else
  to touch — the invariant is structural rather than enforced by a rule.

If cross-quiz team identity is ever wanted, extracting three columns into a table is a routine
migration. Doing it now would mean building dedup, merge and typo-cleanup tooling for an
identity nothing yet reads.

## Data model

### Participant mode

`QuizParticipantMode` gains a third member, following the pattern pairs established:

```python
class QuizParticipantMode(str, enum.Enum):
    individual = "individual"
    pairs = "pairs"
    teams = "teams"
```

Participant mode stays a property of `Quiz`, not `QuizFormat` — a format describes the shape
of the quiz itself and says nothing about who is taking it. The same format can be run solo
one month and in teams the next.

### Team fields on the result

```python
class TeamType(str, enum.Enum):
    national = "national"
    club = "club"


class QuizResult(SQLModel, table=True):
    ...
    team_name: str | None = Field(default=None, max_length=255)
    team_type: TeamType | None = None
    team_country: str | None = Field(default=None, max_length=3)
```

`international` is deliberately **not** a team type. An international side is a national team
with no single country, so `team_type = national` and `team_country = NULL` expresses it
exactly. The label is derived at render time — `countryName(team_country)` when set,
`"International"` when not — and never stored, so the two can never disagree.

A club team's country is optional. It is validated against `VALID_COUNTRY_CODES` whenever
present, for either type.

### Lineups

Unchanged from pairs. The squad is the result's existing `quiz_result_player` rows:

```
Quiz  (participant_mode = teams)
 └── QuizResult          team_name, team_type, team_country, score, final_rank, round_1..20
      └── QuizResultPlayer   slot, player_id, country
           slot 1..N -> Player
```

`slot` runs 1..N and remains a stable ordering key, not a rank. Inline additions append at
`max(slot) + 1`; removals leave gaps, because nothing reads slot as a sequence and renumbering
would churn primary keys.

The existing `UNIQUE (quiz_id, player_id)` on `quiz_result_player` already prevents one player
turning out for two teams in the same quiz. No new constraint is needed for it.

### Constraints and invariants

One constraint is expressible in the database, as a partial unique index:

```sql
CREATE UNIQUE INDEX ix_quizresult_quiz_team_name
    ON quizresult (quiz_id, lower(team_name))
    WHERE team_name IS NOT NULL;
```

Teams need not be unique across quizzes, but two results *within one quiz* being the same team
under different spellings is a data error worth catching at the database. `lower()` catches
"England A" against "england a"; the partial predicate leaves individual and pairs quizzes
entirely unaffected.

Three further invariants depend on the parent quiz's mode, which spans tables, so they are
enforced in `crud` and surfaced as 422s:

| Invariant | Rule |
|-----------|------|
| Team fields | `teams` → `team_name` non-empty and `team_type` set. `individual` / `pairs` → all three team fields NULL. |
| Participant count | `individual` → exactly 1. `pairs` → 1 or 2. `teams` → **0 or more**. |
| Country code | `team_country`, when present, must be in `VALID_COUNTRY_CODES`. |

### API models

The three team fields are added to `QuizResultCreate`, `QuizResultUpdate` and
`ResolvedResultRow` (the upload's submit payload) alongside the existing `participants` list,
and to `QuizResultPublic`. `crud.create_quiz_results` and `crud.update_quiz_result` apply the
invariants above against the parent quiz's `participant_mode`, so a teams payload sent to an
individual quiz — or the reverse — is rejected at the same point for both the create and the
edit path.

**Zero participants is a supported state, not a degenerate one.** An upload frequently names
the teams and their scores without listing squads; the result is recorded with an empty lineup
and filled in later from the results page. This is the case the rest of the system must
tolerate rather than guard against.

## Upload

### Step 1 — quiz details

The participant mode control gains **Teams**. Choosing it reveals a second control, "Teams in
this file are: National / Club", which is a default for the Step 4 panel below. It is wizard
state only and is not persisted on `Quiz` — it describes one upload, not the quiz.

### Step 3 — column mapping

For teams quizzes only:

- A **Team** column, required. A blank cell is a row error.
- A **lineup layout** radio, auto-detected with user override, mirroring the existing
  behaviour in `detectPairsLayout.ts`:
  1. If ≥50% of non-empty cells in the mapped name column contain a separator → **Combined**.
  2. Else if ≥2 unclaimed headers match `player\s*\d+`, `member\s*\d+` or `name\s*\d+` →
     **Numbered columns**, with every matching column preselected in header order.
  3. Else → **Combined**.
- **Combined** splits one cell on `\s*&\s*`, `\s+and\s+` (case-insensitive) and `\s*,\s*`.
  Comma is new for teams; `splitPairNames.ts` gains it. The whitespace requirement around
  `and` is what keeps Alex*and*er and S*and*y intact, exactly as it does for pairs.
- **Numbered columns** maps N name columns with add/remove in the mapping UI. Blank cells are
  skipped, so a file with a Player 6 column that only two teams filled works correctly.
- The **country** column becomes optional, as it is for pairs. When mapped on a teams quiz it
  seeds **`team_country`**, not the participant's country — a national-team file's country
  column describes the side, not the person. Participant `country` stays NULL and every
  display falls back to the player's own `PlayerCountry` rows.

### Row validation

Joining the existing per-row errors in `validateUploadRows.ts`, listed by row number in Step 5
with Submit disabled:

| Case | Behaviour |
|------|-----------|
| Blank team name | Row error |
| Same team name twice in the file | Row error |
| Same player twice anywhere in the file | Row error |
| Same name twice within one row | Row error |
| Zero players | **Allowed, no warning** |
| N players | A squad |

### Step 4 — matching

Because teams have no cross-quiz identity, Step 4 does **no team resolution** — there is no
existing team to match against and no team search endpoint. It gains a compact "Teams in this
file" panel listing each distinct team name once, with:

- a type selector prefilled from the Step 1 default;
- a country combobox prefilled from the mapped country column where present;
- an **"International (no single country)"** checkbox, shown only when the type is National,
  that clears and disables the country picker. A club team's country is optional already, so
  the checkbox would say nothing there.

Player names go through the existing `search_players` batch and the existing auto-resolution in
`matchPlayers.ts`, unchanged. Pairs already made Step 4 participant-keyed rather than
row-keyed, so a squad of eight is just more participants.

### Previews

The Step 3 and Step 5 previews gain **Team** and **Lineup** columns. This is the safety net for
a mis-detected layout: because an empty squad is accepted silently, an empty Lineup column
across every row must be visible before submit.

## Inline lineup editing

Admins fill in and correct squads from the quiz's own results page —
`_public/quizzes_.$slug.tsx`, which already renders `AdminControls` for superusers.

Each team row expands to show its lineup. For superusers the expanded row gains:

- an **add** control: a player-search combobox reusing `GET /players/search`, with a
  "Create <name>" option falling back to the existing `POST /players`;
- a **remove** control per squad member;
- the team's name, type and country editable in place.

**No new endpoints are required.** `PATCH /quizzes/{quiz_id}/results/{result_id}` is already
`CurrentSuperuser`-gated and already replaces a result's whole participant set.
`QuizResultUpdate` gains `team_name`, `team_type` and `team_country`; the route and
`crud.update_quiz_result` apply the same invariants listed above. Non-superusers get the
existing 403.

This inline surface is the only place teams are managed. There is deliberately no admin teams
screen: with no cross-quiz identity there is no global list to curate.

## Read paths

`PlayerResultWithQuiz`, `QuizResultPublic`, `QuizResultWithPlayer` and `PodiumFinisher` each
gain `team_name`, `team_type` and `team_country`.

- **Player history** — a team result appears on the public page of every player in the lineup,
  reading "2nd, for England A". `partners` is left **empty** for team results: a twenty-strong
  squad has no business being serialized into every history row, and the team name carries the
  context that `partners` carries for a pair.
- **Credit** — every lineup member takes full credit in total quizzes, wins and podiums,
  exactly as both members of a pair do. This falls out of the existing join through
  `quiz_result_player` rather than needing a separate rule. Separating team achievements from
  individual ones in the headline tiles is out of scope, consistent with the same decision
  taken for pairs.
- **Podium and standings** — same join; every member of a winning squad takes the gold.
  `PodiumFinisher` carries the team fields so a team podium names the side as well as its
  players.
- **`QuizResultsTable.tsx`** — on a teams quiz, a **Team** column showing the name with its
  country or an "International" badge, and the lineup rendered through the existing
  `PlayerLinks`.

### The empty-lineup audit

A result with no participants is the one case that touches existing code rather than extending
it. Such a result must **render on the quiz page** while being **absent from every
player-keyed query** — it credits nobody, which is correct.

`_results_public` and the history and podium joins currently assume at least one participant
row per result. Each needs checking: player-keyed queries are naturally correct (no join row,
no match), but any inner join used to *render* a quiz's results must become an outer join, and
any code indexing `participants[0]` must tolerate an empty list. `QuizResultsTable.tsx`'s
`accessorFn` for the player column already reads `participants?.[0]` with a fallback.

## Migration

One revision, no backfill, reversible:

1. `ALTER TYPE quizparticipantmode ADD VALUE 'teams'`. Safe inside a transaction on PostgreSQL
   12+ — the deployment runs 18 — because the migration does not *use* the new value in the
   same transaction.
2. Create the `teamtype` enum.
3. Add `team_name`, `team_type`, `team_country` to `quizresult`, all nullable.
4. Create the partial unique index on `(quiz_id, lower(team_name))`.

Existing rows keep NULLs in all three columns and are untouched. Downgrade drops the index and
the columns; the added enum value is left in place, which is harmless and is the conventional
treatment.

## Testing

**Backend**

- Each invariant in both directions: a teams result without a name or type is rejected; an
  individual or pairs result carrying team fields is rejected; a teams result with zero
  participants is accepted.
- `team_country` rejects an invalid code and accepts NULL as an international side.
- The partial unique index rejects two results in one quiz with the same team name in
  different cases, and permits the same team name in two different quizzes.
- `UNIQUE (quiz_id, player_id)` rejects a player appearing in two teams' lineups in one quiz.
- `submit_results` for a teams quiz containing rows with zero, one and N players.
- `PATCH` adding and removing a lineup member, editing team fields, and returning 403 for a
  non-superuser.
- Player history, podium and standings crediting every member of a squad; a result with an
  empty lineup crediting nobody and rendering on the quiz page without error.
- Migration round-trip on seeded data.

**Frontend**

- `splitPairNames` extended to commas, including the Alexander and Sandy cases and mixed
  separators.
- Lineup layout auto-detect across all three branches.
- `validateUploadRows` unit tests per row-error case, and the zero-player case producing none.
- A Playwright teams upload covering both CSV shapes end to end, then a superuser adding a
  squad member on the results page and seeing that result appear on the player's history page.

Per the repo's convention, tests delete only rows they create — no table-wide deletes.

## Out of scope

- Cross-quiz team identity: team pages, slugs, search, and any notion that two same-named
  teams in different quizzes are the same team.
- Team merge tooling, and any global list of teams to curate.
- Standing rosters and squad continuity between quizzes.
- Separating team achievements from individual and pairs achievements in a player's headline
  stats.
- `User` → `Player` account linking and a signed-in "my results" view. Team results are
  visible on public player pages, which needs no account.
