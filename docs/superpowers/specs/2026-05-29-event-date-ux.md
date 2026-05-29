# Event Date UX: Single-Day Default with Optional Range

## Goal

Replace the current two-field start/end date UI with a single-date input (defaulting to today) and an opt-in "Multi-day event" checkbox that reveals the end date.

## Architecture

Frontend-only change. The API contract is unchanged — both `start_date` and `end_date` are always sent; single-day events simply send the same value for both. No backend migration or schema change is required.

## Affected Files

- `frontend/src/components/Upload/steps/Step1EventMeta.tsx` — upload wizard event creation step
- `frontend/src/routes/_layout/admin_.events_.$id.tsx` — admin event edit form

---

## Feature Behaviour

### Single-day mode (default)

- One date input labelled **"Date \*"**, defaulting to today (`YYYY-MM-DD`).
- A **"Multi-day event"** checkbox sits directly below, unchecked.
- On submit, `end_date` is set equal to `start_date`.

### Multi-day mode (checkbox checked)

- The "Date \*" label changes to **"Start date \*"**.
- An **"End date \*"** input appears below the checkbox, pre-filled with the current start date value.
- Both fields are required. Standard HTML5 date validation applies.
- On submit, `start_date` and `end_date` are sent as entered.

### Admin edit form initialisation

When loading an existing event:
- If `start_date === end_date`: single-day mode, checkbox unchecked, one date field shows `start_date`.
- If `start_date !== end_date`: multi-day mode, checkbox checked, both fields populated from the event.

---

## Implementation Details

### `Step1EventMeta` changes

`EMPTY_EVENT_META` becomes a factory function `emptyEventMeta()` that computes today's date at call time:

```ts
function today(): string {
  return new Date().toISOString().split("T")[0]
}

function emptyEventMeta(): EventMeta {
  return {
    name: "",
    start_date: today(),
    end_date: today(),
    organizer_name: "",
    description: "",
    series_id: "",
    organization_id: "",
    format_questions: "",
    format_rounds: "",
    format_categories: "",
  }
}
```

All call sites that previously referenced `EMPTY_EVENT_META` call `emptyEventMeta()` instead.

A local `isMultiDay` boolean state (default `false`) controls visibility of the end date field. `useForm` default values use `emptyEventMeta()`.

The date section of the form becomes:

```tsx
<div className="grid gap-1.5">
  <Label htmlFor="start_date">{isMultiDay ? "Start date *" : "Date *"}</Label>
  <Input id="start_date" type="date" {...register("start_date", { required: true })} />
</div>

<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={isMultiDay}
    onChange={(e) => {
      setIsMultiDay(e.target.checked)
      if (!e.target.checked) {
        setValue("end_date", getValues("start_date"))
      }
    }}
  />
  Multi-day event
</label>

{isMultiDay && (
  <div className="grid gap-1.5">
    <Label htmlFor="end_date">End date *</Label>
    <Input id="end_date" type="date" {...register("end_date", { required: true })} />
  </div>
)}
```

On submit, the `onSubmit` handler derives the final value: `const payload = { ...data, end_date: isMultiDay ? data.end_date : data.start_date }`.

### Admin edit form changes

Same `isMultiDay` state pattern, initialised from the existing event:

```ts
const [isMultiDay, setIsMultiDay] = useState(event.start_date !== event.end_date)
```

`useForm` default values remain `{ start_date: event.start_date, end_date: event.end_date }`. The form renders identically to the upload wizard's date section.

---

## Testing

- Upload wizard: submit with no dates changed → `start_date` and `end_date` both equal today's date.
- Upload wizard: check "Multi-day event", set end date to a later date → `start_date !== end_date` sent correctly.
- Upload wizard: check then uncheck "Multi-day event" → `end_date` resets to `start_date` on submit.
- Admin edit: open a single-day event → checkbox unchecked, one date shown.
- Admin edit: open a multi-day event → checkbox checked, both dates populated.
- Admin edit: uncheck "Multi-day event" on a multi-day event → saves with `end_date = start_date`.
