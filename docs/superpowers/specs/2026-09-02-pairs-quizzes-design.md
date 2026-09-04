# Pairs quizzes

**Date:** 2026-09-02
**Status:** Design approved

## Problem

Some quizzes are contested by two people working together. Today a result is one player:
`QuizResult` holds a single `player_id` under a `UniqueConstraint("quiz_id", "player_id")`,
so a pairs quiz can only be recorded by inventing a fake combined player or by uploading
one of the two names and losing the other. Neither survives contact with player history —
the partner's record shows nothing.

This spec adds pairs as a first-class shape: a quiz declares that its results are contested
in pairs, a result carries two participants, and both of them get the result on their record.

## Participant mode belongs to the quiz

`QuizFormat` describes the *shape of the quiz itself* — its rounds, its scoring, whether it
is eligible for per-round stats. It says nothing about who is taking it, and the same format
can be run solo one month and in pairs the next. So participant mode is a property of `Quiz`,
not of `QuizFormat`:

```python
class QuizParticipantMode(str, enum.Enum):
    individual = "individual"
    pairs = "pairs"
```

An enum rather than an `is_pairs` boolean, following the existing `QuizStatus` pattern, so
that further participant shapes are a new member plus validation rather than a redesign.
`individual` is the default, both in the column default and in the upload wizard's UI.

A pairs quiz may use any format, or none. The two fields do not constrain each other.

## Data model

Participants move out of `QuizResult` into a join table. `QuizResult` keeps what belongs to
the *result* — score, rank, round scores — and the join table holds who achieved it.

```python
class QuizResultPlayer(SQLModel, table=True):
    __tablename__ = "quiz_result_player"
    quiz_result_id: uuid.UUID = Field(
        foreign_key="quizresult.id", primary_key=True, ondelete="CASCADE"
    )
    slot: int = Field(primary_key=True)          # 1, 2
    quiz_id: uuid.UUID = Field(foreign_key="quiz.id", ondelete="CASCADE", index=True)
    player_id: uuid.UUID = Field(foreign_key="player.id", ondelete="CASCADE", index=True)
    country: str | None = Field(default=None, max_length=3)

    __table_args__ = (UniqueConstraint("quiz_id", "player_id"),)
```

`QuizResult` loses `player_id` and `country`; everything else stays.

```
Quiz
 └── QuizResult          score, final_rank, round_1..20
      └── QuizResultPlayer   slot, player_id, country
           slot 1 -> Player
           slot 2 -> Player   (pairs only)
```

`quiz_id` is denormalized onto the join row for one reason: the old constraint's intent — *a
player appears at most once in a quiz* — is otherwise a cross-table uniqueness check that the
database cannot express. Carrying `quiz_id` turns it back into a plain `UNIQUE (quiz_id,
player_id)` on a single table, and it catches the degenerate "same player in both slots of one
pair" case with the same index. `crud.create_quiz_results` sets it from the parent result;
it is never accepted from the API.

`slot` is a stable ordering key, not a ranking — slot 1 is not the senior partner. It exists
so that a result's participants render in a consistent order and so the primary key is stable
under re-upload.

### Country

`country` is per participant, not per result, because a pair is frequently mixed-nationality
and one value per row would have to lie about one of them.

For **individual** quizzes nothing changes in behaviour: the country column stays required in
the upload, and the value records the country that player represented *at that quiz* —
preserving what the multi-country players work established for players holding more than one
nationality.

For **pairs** quizzes the country column becomes optional. Left unmapped, both participants
get `country = NULL` and every display falls back to the player's own countries from
`PlayerCountry`. A pair with one English and one Scottish member then reads correctly, and
nothing claims the pair represents a single country.

Because the field is per participant, a second country column can be added to the mapping UI
later with no migration.

### Migration

Three steps, reversible:

1. Create `quiz_result_player`. Add `participant_mode` to `quiz` with a server default of
   `'individual'`.
2. Backfill one slot-1 row per existing `QuizResult`, copying `player_id`, `country`, and
   `quiz_id` from the parent.
3. Drop `quizresult.player_id`, `quizresult.country`, and the old
   `UniqueConstraint("quiz_id", "player_id")`.

Step 2 must complete before step 3 in the same migration. Row counts before and after must
match; the migration asserts this.

## Upload — parsing a pair

Two CSV shapes are accepted, per the mapped name column(s).

**Combined column.** One name cell holding both quizzers, split on:

- `\s*&\s*`
- `\s+and\s+`, case-insensitive

Splitting on *all* occurrences, then trimming and collapsing whitespace per name, dropping
empties, and running each name through the existing `normalizePlayerName`.

The whitespace requirement around `and` is what keeps **Alex*and*er** and **S*and*y** intact;
`&` needs no such guard. The residual limitation is a person genuinely named with a standalone
" and ", who would be split — the escape hatch is the two-column layout.

**Two columns.** A second name column mapped explicitly. No splitting.

Either shape then yields a name count per row:

| Names | Behaviour |
|-------|-----------|
| 1     | Solo result in a pairs quiz — allowed, no warning |
| 2     | A pair |
| 3+    | Row error, blocks submission |
| Same player twice | Row error, blocks submission |

Row errors join the existing per-row errors in `validateUploadRows.ts`, listed by row number
in Step 5 with the Submit button disabled — the same treatment a missing score gets today.

A single name is deliberately permitted: a pair whose partner dropped out is a real result.

## Upload — wizard changes

**Step 1 (quiz details)** gains the Individual / Pairs control, Individual preselected.

**Step 3 (column mapping)**, for pairs quizzes only, gains a layout radio. It is auto-detected
with the user able to override, matching the existing auto-detect behaviour in
`columnDetection.ts`:

1. If ≥50% of non-empty cells in the mapped name column contain a separator → **Combined**.
2. Else if an unclaimed header matches a partner pattern (`player 2`, `partner`, `name 2`,
   `player b`) → **Two columns**, with that column preselected.
3. Else → **Combined**.

Also for pairs quizzes, the country column becomes optional, gaining a "Not mapped" entry
alongside the existing Position column's.

The Step 3 and Step 5 previews both grow **Player 1 / Player 2** columns. This is the safety
net for case 3 above: because a lone name is accepted silently, a mis-detected layout must be
visible before submit, and an empty Player 2 column across every row is unmistakable.

**Step 4 (matching)** resolves *participants*, not rows. Both names go through the same
`search_players` batch and the same auto-resolution logic in `matchPlayers.ts`, so a row with
one confident match and one ambiguous name shows only the ambiguous half for a decision.
`ParsedResultRow`, `Resolution` and `ResolvedResultRow` become participant-keyed.

## Read paths

Every query that filters `QuizResult.player_id == player_id` becomes a join through
`quiz_result_player`. Both members of a pair get **full credit**: a pairs result appears in
both players' history and a pairs win counts toward both players' wins and podium tallies,
exactly as a solo win does. This falls out of the join — a result matches a player in either
slot — rather than needing a separate rule.

- `crud.get_player_history_grouped`, `crud.get_player_competition_history` — join, and add the
  partner's display name and slug to `PlayerResultWithQuiz` so history rows can read
  "1st, with Bob". Its `country` now comes from *this player's* participant row rather than
  from the result, falling back to the player's own countries when null.
- Podium and standings — same join; both members take the gold. `PodiumFinisher` carries the
  result's participants rather than a single player, so a pairs podium names both winners.
- `QuizResultWithPlayer` becomes a participants list. `QuizResultsTable.tsx` renders both
  names, each linked to its player, and renders country per participant rather than one value
  per row.
- `submit_results` and `crud.create_quiz_results` write the join rows, and the "update the
  existing row" path matches on the result's full participant set rather than on `player_id`.

### API models

`QuizResultCreate`, `QuizResultUpdate` and `QuizResultPublic` currently carry `player_id` and
`country` as scalars. Each grows a participants list of `{slot, player_id, country}` in their
place, and `QuizResultCreate` validates that the list matches the quiz's `participant_mode` —
one participant for `individual`, one or two for `pairs`. The single-result edit and delete
routes (`PUT`/`DELETE /{id}/results/{result_id}`) and `crud.update_quiz_result` follow the same
reshaping; editing a result can change either participant.

### Player merge

`merge_players` needs specific attention. Its conflict rule is "source and target both have a
result in this quiz", which acquires a new shape under pairs: the two players being merged may
have been **partners in the same result**. Collapsing them would put one player in both slots
of a single pair, violating `UNIQUE (quiz_id, player_id)` and producing a nonsense result.

This must be detected and surfaced as its own conflict type in `MergePlayersPreview`, distinct
from the existing "both competed separately" conflict, so an admin sees what will happen
before confirming rather than hitting a constraint error. The merge itself deletes the
offending result, consistent with how existing conflicts resolve.

## Testing

**Backend**

- Split parsing: the Alexander/Sandy cases, `&` with and without surrounding spaces, mixed
  separators, 3+ names, duplicate player in one row.
- Migration round-trip on seeded data, asserting participant counts match result counts.
- `submit_results` for a pairs quiz containing both paired and solo rows.
- Player history, podium and standings crediting both members of a pair.
- Merge where source and target were partners in the same result.
- The `UNIQUE (quiz_id, player_id)` guard against a player appearing in two results of one
  quiz.

**Frontend**

- `validateUploadRows` unit tests for each row-error case.
- Layout auto-detect unit tests for all three branches.
- A Playwright pairs upload covering both CSV shapes end to end.

Per the repo's convention, tests delete only rows they create — no table-wide deletes.

## Out of scope

- Teams, and any participant shape beyond two.
- A second country column for mixed-nationality pairs.
- Pair-level identity: a pair is its two members, with no name, slug or page of its own, and
  no cross-quiz continuity.
- Separating pairs and individual achievements in a player's headline stats.
