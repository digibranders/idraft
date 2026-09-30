# 10. Forms

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: primitives in `apps/web/src/components/ui/` (`field.tsx`, `input.tsx`, `input-variants.ts`, `input-group.tsx`, `password-input.tsx`, `otp-field.tsx`, `textarea.tsx`, `select.tsx`, `combobox.tsx`, `multi-select.tsx`, `checkbox-group.tsx`, `radio-group.tsx`, `segmented-control.tsx`, `date-picker.tsx`, `calendar.tsx`, `number-field.tsx`, `secret-input.tsx`, `file-dropzone.tsx`, `search-input.tsx`, `save-bar.tsx`, `error-summary.tsx`); form components in `apps/web/src/components/app/forms/` (`form-field.tsx`, `url-input.tsx`, `domain-input.tsx`); `DateRangePicker` in `apps/web/src/components/app/filters/date-range-picker.tsx`; `apps/web/src/lib/forms/` (server error mapping, error copy); shared schemas in `packages/contracts/src/forms/`. Primitives in `components/ui` never import react-hook-form, `packages/contracts` or `@/lib/format`: they receive display strings and Intl options from their caller ([26-implementation-guidelines.md](26-implementation-guidelines.md) section 2, rule 1).
Depends on: [04-spacing-density.md](04-spacing-density.md), [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md), [08-interaction-states.md](08-interaction-states.md), [09-buttons-controls.md](09-buttons-controls.md).

## 1. Scope and decisions at a glance

This document defines every control that captures a value and the rules for laying out, validating and submitting forms. Checkbox, radio, switch and slider visuals are in [09-buttons-controls.md](09-buttons-controls.md) section 8; this document covers their use in forms. Filter bars (which are not forms) are in [13-filters-search.md](13-filters-search.md). Dialog and popover shells are in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md). Value formatting is in [22-content-formatting.md](22-content-formatting.md).

| Decision | Default |
|---|---|
| Label | Above the control, 6 px gap; optional fields say "(optional)", required fields are unmarked |
| Helper and error text | Below the control in `type-meta`; the error replaces the helper |
| Control height | 36 px; 32 px in inline forms; 40 px in auth and onboarding only |
| Validation | First blur, then every change; submit validates everything |
| Submit button | Always enabled; disabled only while submitting or without permission |
| State and wiring | react-hook-form 7 and zod 4 schemas from `packages/contracts`; Base UI `Field` and `Fieldset` for ARIA |
| Settings pages | 640 px column, sticky save bar when dirty; switches save immediately |

## 2. Field anatomy

```
 Label text (optional)             type-label (12 px, tertiary); "(optional)" in type-meta
 ↕ 6 px
 ┌────────────────────────────┐
 │ value                      │    h-control (36 px), border, surface, rounded-md
 └────────────────────────────┘
 ↕ 6 px
 Helper text or error message     type-meta; error in negative-text with icon
```

Every field is a `FormField` (`components/app/forms/form-field.tsx`), which composes react-hook-form's `useController` with the Field parts in `components/ui/field.tsx` (Base UI `Field.Root`, `Field.Label`, `Field.Control`, `Field.Description` and `Field.Error`). Inline and non-form uses render the Field parts directly. Base UI generates the ids and wires `htmlFor`, `aria-describedby` and `aria-invalid`; components never write these by hand.

| Part | Classes and rules |
|---|---|
| Field root | `flex flex-col gap-1.5` plus the width class (section 3) |
| Label | `type-label` (12 / 16 px, weight 400, `foreground-tertiary`). Sentence case, no colon, at most 4 words. It names the value, not the action: "Monthly limit", not "Enter your monthly limit" |
| Optional marker | A space, then `<span className="type-meta">(optional)</span>`, inside the label. The space is a text node of the label, so the accessible name reads "Job title (optional)" |
| Control | Per control type below |
| Helper text | `FieldDescription` (`Field.Description`), `type-meta` (13 / 20 px, `foreground-tertiary`). One line preferred, two maximum. States a format, a constraint or a consequence ("Both adds two tracked keywords for each keyword") |
| Error text | `Field.Error`, `flex items-start gap-1 type-meta text-negative-text`, leading `CircleX` at 12 px (`size-icon-xs`) with `mt-1`, which centers it on the 20 px first line. Shown in place of the helper text. This document owns field anatomy; other documents use the same 12 px icon |
| Placeholder | `placeholder:text-foreground-tertiary`. Only an example of the expected format ("example.com", "YYYY-MM-DD"). Never the label, never an instruction the user must remember |

### 2.1 Required and optional: decision

Mark optional fields with "(optional)"; do not mark required fields with asterisks.

Rationale:
1. Most fields in this product are required (keyword text, domain, limit, workload). Marking the minority adds less noise than an asterisk on nearly every label.
2. An asterisk needs a legend ("* required") and is read inconsistently by screen readers ("star"). A word needs neither.
3. Users decide whether to skip a field by reading its label; "(optional)" answers that question where it is asked.

Implementation: required controls carry `aria-required="true"`, so assistive technology announces "required" without a visual asterisk. `FormField` hands the control `required` (true unless the field is marked `optional`), and the control puts it on `aria-required`. The native `required` attribute is not used: it would start the browser's and Base UI's own validation beside the schema. Forms set `noValidate` so the browser never shows its own validation bubbles. A form in which every field is optional (rare; for example an export options dialog) shows no markers at all.

### 2.2 Error replaces helper text

When a field shows an error, the helper text is not rendered and the error takes its place (`FormField` renders `FieldError` or `FieldDescription`, never both; a description that is only hidden would still be read, because `aria-describedby` reads hidden targets). Error messages must therefore contain the constraint that the helper text stated (section 19). This keeps the field one line tall in both states and gives `aria-describedby` a single, current description.

## 3. Layout and widths

| Rule | Value |
|---|---|
| Label to control | 6 px (`gap-1.5`) |
| Control to helper or error | 6 px (`gap-1.5`) |
| Between stacked fields | 16 px (`gap-4`) |
| Between fields in a row | 12 px (`gap-3`) |
| Columns | One column by default. Two fields share a row only when they are one concept split in two (Location and Language, From and To). Never more than two per row |
| Between sections | 24 px, a 1 px `border-subtle` divider, then 24 px (`py-6` on the section) |
| Section heading | `type-section-title` (`h2`), optional one-line `type-meta` description, 16 px before the first field |
| Form column | `max-w-form` (640 px) on settings pages; dialog body width in dialogs |
| Labels beside controls | Only for checkboxes, radios and switches, which put the label to the right (checkbox, radio) or left (switch row) |

Field widths are set by the expected content, not by the container. A short value in a full-width box makes the form harder to scan and suggests a longer answer is expected.

| Width | Class | px | Content |
|---|---|---|---|
| Short | `w-30` | 120 | Numbers, currency, percent, counts, hour of day |
| Date | `w-40` | 160 | Single date input with its calendar button |
| Medium | `w-60` | 240 | Names, select values (engine, workload, language), short identifiers |
| Long | `w-90` | 360 | Domains, URLs, emails, locations, combobox with chips |
| Full | `w-full` | container | Textareas, keyword paste, descriptions, secrets |

Widths shrink to `w-full` below the `sm` breakpoint (640 px). On a 640 px settings column, "Long" leaves room for an adornment button.

## 4. Text input

Base UI `Input` (via `Field.Control`).

| Property | `md` (default) | `sm` (inline forms) | `lg` (auth, onboarding) |
|---|---|---|---|
| Height | `h-control` 36 px | `h-control-sm` 32 px | `h-control-lg` 40 px |
| Padding | `px-3` | `px-2` | `px-3` |
| Text | `type-body text-foreground` (14 px) | `type-body` | `type-body` |

Shared classes: `w-full rounded-md border border-border bg-surface placeholder:text-foreground-tertiary focus-visible:focus-ring`. The light `border` outline passes WCAG 1.4.11 because the boundary is not what identifies an input: it always has a visible label (or, in inline forms, a placeholder) and often a leading icon ([20-accessibility.md](20-accessibility.md) section 3.2, rule 6). An input with none of these is not allowed.

| State | Treatment |
|---|---|
| Hover | None. Inputs do not change on hover; the cursor is the text cursor |
| Focus | 2 px `ring`, 2 px offset. The border does not change color |
| Invalid | `data-invalid:border-negative-solid`; focus ring stays `ring` |
| Disabled | `data-disabled:bg-surface-disabled data-disabled:text-foreground-disabled data-disabled:border-border`, `cursor-not-allowed` |
| Autofill | `color-scheme` per theme keeps browser autofill colors legible ([01-foundations.md](01-foundations.md) section 3) |

**Adornments** (prefix text, units, icons, buttons) use `InputGroup`: the group draws the border, the radius and the focus ring while its input has focus (`has-[input:focus-visible]:focus-ring`; a focused button inside shows its own ring); the invalid border and the disabled fill are read from the input only (`has-[input[data-invalid]]`, `has-[input[data-disabled]]`), so a disabled button beside an enabled input changes nothing; a press on the padding, the icon or the unit puts the caret in the input; the inner input has no border and `min-w-0 flex-1`. Prefix and suffix text is `type-body text-foreground-tertiary` with 8 px between it and the value, and is not part of the value. Buttons inside a group are `icon-xs` (24 px) at 4 px from the edge.

## 5. Textarea

Base UI has no textarea, so `Textarea` is a native `<textarea>` rendered through `Field.Control render={<textarea />}` to keep the Field wiring.

| Property | Value |
|---|---|
| Classes | Input classes plus `py-1.5 resize-none field-sizing-content` |
| Height | Minimum 3 lines, grows with content to 8 lines, then scrolls: `min-h-[calc(3lh+0.875rem)] max-h-[calc(8lh+0.875rem)] overflow-y-auto` (arbitrary values are permitted inside `components/ui`) |
| Fallback | Where `field-sizing` is unsupported, `useAutoGrow` sets `height` from `scrollHeight` on input, clamped to the same limits |
| Counter | When the schema has a maximum length, a right-aligned `type-meta num` counter ("612 of 700") appears once 80% of the limit is used; it turns `text-negative-text` above the limit. The limit is enforced by validation, never by `maxLength` truncation, so pasted text is not silently cut |
| Enter | Inserts a newline. Cmd or Ctrl plus Enter submits the form when the textarea is the main field (Add keywords, prompt text) |

## 6. Select, combobox and multi-select

### 6.1 Which control

| Situation | Control |
|---|---|
| 2 to 4 short options, all worth seeing | Radio group or segmented control (sections 7 and 9) |
| 5 to 6 options, all worth seeing | Radio group (section 7) |
| 7 to 15 options, no search needed | `Select` |
| More than 15 options, or options loaded from the server | `Combobox` (single) |
| Several values from a list | `MultiSelect` (Combobox with `multiple`) |
| Free values with suggestions (tags, aliases) | `MultiSelect` with `creatable` |

Native `<select>` is not used.

### 6.2 Select

Base UI `Select` (`Root`, `Trigger`, `Value`, `Icon`, `Portal`, `Positioner`, `Popup`, `List`, `Item`, `ItemIndicator`, `ItemText`, `Group`, `GroupLabel`).

| Part | Spec |
|---|---|
| Trigger | Input classes, `flex items-center justify-between gap-2`, value in `type-body text-foreground`, placeholder ("Select a workload") in `text-foreground-tertiary`, trailing `ChevronDown` 14 px in `text-foreground-muted` |
| Positioning | `alignItemWithTrigger={false}`: the list opens below the trigger with `sideOffset={4}`, like every other popover. Overlaying the trigger was rejected because it hides the label and the fields around it |
| Popup | Same surface as a menu ([09-buttons-controls.md](09-buttons-controls.md) section 10): `min-w-(--anchor-width) max-h-(--available-height) rounded-lg border border-border bg-surface-elevated p-1 shadow-popover` |
| Item | 32 px (`h-8`), `px-2 gap-2 rounded-md type-body`, `data-highlighted:bg-surface-elevated-hover`; 16 px leading slot with `Check` 14 px on the selected item |
| Item with description | Label in `type-body`, second line `type-meta`; item height grows to fit (`py-1.5`) |

Keyboard follows the APG select-only combobox: Enter, Space or arrows open; typing jumps by first letters; Enter selects; Escape closes without change.

### 6.3 Combobox (single)

Base UI `Combobox` (`Root`, `Input`, `Trigger`, `Clear`, `Portal`, `Positioner`, `Popup`, `List`, `Item`, `ItemIndicator`, `Empty`, `Group`, `GroupLabel`).

| Aspect | Spec |
|---|---|
| Input | Input classes with trailing `ChevronDown` trigger (`icon-xs`) and a `Clear` button (`icon-xs`, `X`, label "Clear") when a value is set |
| Filtering | Client side for up to 500 items. Server side for larger sets (locations, domains): debounce 250 ms, minimum 2 characters, up to 50 results |
| Loading | A 32 px status row (the option row height) with a 14 px spinner and "Searching" in `type-meta`, shown once a request has run 300 ms; previous results stay visible while a new query runs |
| Empty | `Combobox.Empty`: "No locations match "berl"" in `type-meta`, 32 px row |
| Grouping | `GroupLabel` in `type-meta`, for example Countries then Cities |
| Blur | Text that matches no item is cleared; the field keeps its last valid value |

### 6.4 Multi-select: chips inside the control or a summary

| Context | Presentation | Why |
|---|---|---|
| Forms (dialogs, settings), where the selection is the thing being edited | **Chips inside the control** | The user needs to see and remove each value; the form has vertical room |
| Filter bars, toolbars, table-inline cells, any fixed control height | **Summary**: the value label when one is selected, "3 selected" when two or more; full list in the tooltip and in the open popup | The height is fixed and the chips below the filter bar already show active values ([13-filters-search.md](13-filters-search.md)) |

Chips inside the control:

| Part | Spec |
|---|---|
| Container | `Combobox.Chips`: `flex min-h-control flex-wrap items-center gap-1 rounded-md border border-border bg-surface px-1 py-1 focus-within:focus-ring`, grows to 3 rows then scrolls inside (`max-h-24 overflow-y-auto`) |
| Chip | `Combobox.Chip`: `h-badge gap-1 rounded-sm border border-neutral-border bg-neutral-subtle px-2 type-micro text-neutral-text` (the 22 px neutral badge style, [14-badges-status.md](14-badges-status.md) section 1) |
| Remove | `Combobox.ChipRemove`: `X` 12 px, accessible name "Remove {value}"; the 24 px spacing exception of WCAG 2.5.8 applies because chip rows are 26 px apart (22 px chip plus the 4 px gap) |
| Input | Inline after the last chip, `min-w-24 flex-1`, placeholder "Add tags" only while empty |
| Keyboard | Backspace in an empty input removes the last chip; Left Arrow from the input moves focus through chips; Delete or Backspace removes the focused chip |
| Popup items | Leading checkbox (16 px, [09-buttons-controls.md](09-buttons-controls.md) section 8.1) showing selection; the popup stays open after each pick |
| Creatable | A final item "Create "q4-launch"" when the query matches no existing value; Enter creates |

Summary presentation: the trigger is a `Select`-styled button; the popup has a search input at the top when there are more than 10 options, checkbox items, and a footer with "Select all" and "Clear" as `link` buttons.

## 7. Checkbox group and radio group

Both are named by a `Fieldset.Legend` styled `type-label`, so the group has a programmatic name. A checkbox group is a `<fieldset>`; a radio group renders the Base UI `RadioGroup` as the fieldset element, so it is a `role="radiogroup"` named by the legend.

| Aspect | Checkbox group (`CheckboxGroup`) | Radio group (`RadioGroup`) |
|---|---|---|
| Use | Zero or more independent choices | Exactly one choice from 2 to 6 |
| Layout | Vertical, `gap-2`; horizontal (`gap-4`) only for 3 or fewer options of 2 words or less | Vertical, `gap-2`. Short options that belong side by side are a `SegmentedControl` |
| Option | Control plus label `type-body`; optional description `type-meta` under the label, aligned to the label's left edge (the 24 px target plus the 8 px gap: `pl-8`). The description describes the control (`aria-describedby`) and is not part of its name | Same |
| Parent | "Select all" parent checkbox with indeterminate state when there are more than 5 options | n/a |
| Error | Below the whole group, not per option ("Select at least one engine") | Below the group |
| Default | Schema default; never all checked "to be safe" | Always one selected unless "none" is a valid answer |

**Radio cards** are used when each option needs a sentence of consequence (action on hard budget limit, depth profile). Each card is a full-width `label` wrapping the radio: `rounded-md border border-border bg-surface p-3`, checked `data-checked:border-primary-border data-checked:bg-surface-selected`, focus ring on the card via `has-[:focus-visible]:focus-ring`. Cards stack vertically with `gap-2`. They are not used for more than 4 options.

## 8. Switch in forms

A switch saves immediately ([09-buttons-controls.md](09-buttons-controls.md) section 8.3). Consequences for forms:
- A switch never belongs to a react-hook-form form and never appears above a save bar. A boolean that is saved with other fields is a checkbox, including settings such as an engine's "Enabled" flag or query matching options when they sit in a save-bar form.
- Switches live in `SettingRow` components inside a section of their own. A settings section is either all immediate switches or a save-bar form, never mixed.
- Behavior on save and failure is in section 13.3.

## 9. Segmented control in forms

A form value with 2 to 4 short options (each at most 12 characters) that the user should see side by side, such as Device (Desktop, Mobile, Both) or Search engine (Google, Bing), uses `SegmentedControl` in its `RadioGroup` form ([09-buttons-controls.md](09-buttons-controls.md) section 6). In forms it is `md` (36 px), sits under a `Fieldset.Legend` label, and hugs its content. The selected option uses the v2 selected style (`primary-subtle` fill, `primary-border` outline, `primary-text` label). Arrow keys move and select (radio semantics); Tab leaves the group.

## 10. Date picker and date range

Base UI has no calendar primitive. Both pickers are a Base UI `Popover` containing react-day-picker 10 (`DayPicker`), styled once in `components/ui/calendar.tsx`.

### 10.1 Shared calendar rules

| Rule | Value |
|---|---|
| Week start | Monday (`weekStartsOn={1}`), matching ISO week rollups |
| Time zone | `timeZone={project.timezone}`, set on the client after mount (avoids a hydration mismatch). Values are business dates (`YYYY-MM-DD`) computed with `TZDate`; the component never converts through the browser's zone |
| Months shown | Range picker 2, single picker 1 |
| Outside days | Hidden (`showOutsideDays={false}`) |
| Future dates | Disabled |
| Day cell | 32 px (`size-8`), `rounded-md type-body num` (14 px), hover `bg-surface-hover`, focus `focus-visible:focus-ring` |
| Day states | Selected, range start and end `bg-primary text-primary-foreground`; in range `bg-primary-subtle rounded-none`; today `text-primary-text` weight 500; disabled `text-foreground-disabled`, not focusable |
| Caption and navigation | `type-subsection-title`; `icon-sm` buttons "Previous month" and "Next month"; weekday header `type-meta` ("Mo") |
| Keyboard | Arrows move by day, Page Up and Page Down by month, Shift plus Page Up and Page Down by year, Home and End to week start and end, Enter selects |
| Zone note | Footer line in `type-meta`: "Dates in Europe/Berlin" |

### 10.2 DateRangePicker

Used in the filter bar and in forms that take a window. It lives in `components/app/filters/date-range-picker.tsx` (not `components/ui`) because it formats its label with `@/lib/format`; it composes the `Popover` and `Calendar` primitives.

```
 [(cal) Last 28 days  v]          A preset is applied: presets only
 +------------------+
 | Presets          |
 | v Last 28 days   |
 |   Last 7 days    |
 |   ...            |
 |   Custom range > |
 +------------------+

 Custom range chosen (or a custom range is applied): the calendar opens beside the list
 +------------------+-----------------------------------------------------+
 | Last 7 days      |  From [2026-09-01]        To [2026-09-28]           |
 | Last 28 days     |  <  August 2026               September 2026     >  |
 | Last 90 days     |  Mo Tu We Th Fr Sa Su     Mo Tu We Th Fr Sa Su     |
 | Last 12 weeks    |   ...                                               |
 | v Custom range > |  Dates in America/New_York       [Cancel] [Apply]   |
 +------------------+-----------------------------------------------------+
```

| Aspect | Spec |
|---|---|
| Trigger | `Button` `secondary` (`md`, 36 px, in the filter bar and in forms), leading `Calendar` icon, trailing chevron in the filter bar, label is the preset name or `formatDateRange` output ("Sep 1 to Sep 28, 2026"); tooltip shows the resolved dates and zone for presets |
| Presets | Last 7 days, Last 28 days (default), Last 90 days, Last 12 weeks, Custom range. Rolling presets end today in the project time zone, inclusive. "Last 12 weeks" is the current ISO week plus the 11 before it, Monday to today |
| Width | 176 px (`w-44`) with presets only. With the calendar open: 176 px plus the calendar area (12 px padding on each side, two 224 px month grids of 7 x 32 px day cells, 16 px gap between months, about 665 px in all). The open calendar is an exception to the popover width in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.1. Below 768 px it opens as a bottom sheet ([19-responsive-behavior.md](19-responsive-behavior.md)) |
| Preset list | 176 px column (`w-44`), 32 px items (`h-control-sm`), selected preset marked with `Check`. Clicking a preset applies it and closes the popover. "Custom range" has a trailing `ChevronRight` and opens the calendar pane beside the list (hairline `border-subtle` between them); the popover is re-placed so it stays inside the viewport |
| Calendar visibility | Hidden while a preset is applied, so the common case is a short list. Shown when "Custom range" is chosen, and on open when the applied window is custom |
| Custom | Selecting days or typing in From and To (`YYYY-MM-DD`, validated on blur) updates the calendar; nothing applies until "Apply" (`primary sm`, 32 px). "Cancel" (`ghost sm`) or Escape closes without change |
| Weekly screens | Clicking any day selects its whole Monday to Sunday week; the range snaps to whole weeks |
| Limits | Day-granularity screens disable end dates more than 400 days after the start and say so under the inputs: "Ranges longer than 400 days are not available for daily data" |
| URL | The applied window is in the query string (`win=28d` or `from` and `to`) through the `nuqs` parsers |
| Focus | Opening moves focus to the selected preset; closing returns it to the trigger |

### 10.3 DatePicker (single)

An `InputGroup` of width `w-40`: a text input in `YYYY-MM-DD` (placeholder "YYYY-MM-DD", helper names the format) and a trailing `icon-xs` button "Choose date" that opens a one-month calendar. Typed and picked values stay in sync. ISO input was chosen over "Sep 29, 2026" because it is unambiguous, locale independent and fast to type; displayed dates elsewhere still use `formatBusinessDate`.

## 11. Number input

`NumberInput` wraps Base UI `NumberField` (`Root`, `Group`, `Input`, `Decrement`, `Increment`).

| Aspect | Spec |
|---|---|
| Width | `w-30` (120 px) including adornments |
| Alignment | Left aligned, `num` (tabular figures) |
| Units | `InputGroup` prefix or suffix in `text-foreground-tertiary`: `$` prefix for USD, `%` suffix for percentages, "days", "keywords" as word suffixes. Units are never typed by the user |
| Formatting | `NumberInput` stays in `components/ui/number-field.tsx` and does not import `@/lib/format`. The caller (a `components/app` or feature component) calls `numberInputFormat(kind)` from `@/lib/format` (`'integer' \| 'decimal' \| 'currency' \| 'percent'`) and passes the returned Intl options through the `format` prop, with the same locale as `formatInteger` and `formatCurrency`; `NumberInput` hands them to `NumberField` `format`. No component builds Intl options itself. On blur the value shows grouped ("2,000.00"); while editing, grouping separators are accepted |
| Steppers | Hidden by default. Shown only for integers with a range of 20 or less (replicates, max prompts per keyword): `icon-xs` `Minus` and `Plus` buttons at the right of the group, labels "Decrease" and "Increase" |
| Keyboard | Up and Down step; Shift plus arrow steps by 10; wheel scrubbing is off |
| Range | `min` and `max` are validated by the schema and stated in the helper text ("1 to 100"). They are not passed to `NumberField` for clamping, so an out-of-range entry produces an error message instead of being silently changed. The wrapper disables steppers at the bounds |
| Empty | Empty means "not set" (`undefined`), never 0 |
| Percent | The user types whole percent (80). Conversion to the API unit happens in the schema, not in the component |

Gap to close: `numberInputFormat` does not yet exist in `apps/web/src/lib/format/number.ts`. It must be added to `lib/format`, with unit tests, before any screen uses `NumberInput` ([25-component-inventory.md](25-component-inventory.md) section 23, item 54).

## 12. URL and domain input

Two components share one behavior: `UrlInput` (a page URL, for target URLs) and `DomainInput` (a host, for competitors and projects). Both live in `components/app/forms/` because they call `packages/contracts` and `@/lib/format`; they render the `Input` and Field primitives from `components/ui`.

| Attribute | Value |
|---|---|
| `type` | `text` (not `url`: `type="url"` rejects "example.com" without a scheme) |
| `inputMode` | `url` |
| `autoComplete` | `off` (a tracked site is not personal data, WCAG 1.3.5 does not apply) |
| `spellCheck`, `autoCapitalize` | `false`, `none` |
| Font | `type-body` (URLs are not Geist Mono) |
| Width | `w-90` |

**Normalization preview.** Below the control, in place of the helper text while the value is valid, a `type-meta` line shows what will be stored: "Will track: example.com/pricing" (value in `text-foreground`). The preview comes from `normalizeTrackedUrl` or `normalizeDomain` in `packages/contracts`, the same functions the API uses, and is displayed through `displayUrl` and `displayDomain` from `@/lib/format`. Normalization: add `https://` when no scheme is given, lowercase the host, drop `www.`, remove fragments, tracking parameters and the trailing slash. `DomainInput` drops any path and says so: "Will track: example.com (path /pricing ignored)". The preview updates on change (debounced 150 ms) because it is feedback, not an error.

Validation messages (shown after blur, section 18):

| Input | Message |
|---|---|
| Empty (required) | "Enter a domain, for example example.com" |
| Contains spaces | "Remove the spaces from the URL" |
| Unparseable host | "Enter a valid domain, for example example.com" |
| `ftp:`, `mailto:` and other schemes | "Use a URL that starts with http or https" |
| IP address, `localhost`, private range (server `422 url_not_allowed`) | "Local and private addresses cannot be tracked" |
| Target URL on another domain | "Enter a URL on example.com, the project domain" |
| Duplicate competitor (server `409 duplicate`) | "example.com is already a competitor" |

## 13. Settings forms

### 13.1 Layout

Settings pages use a 200 px local navigation and a form column of `max-w-form` (640 px) ([05-layout-grid.md](05-layout-grid.md)). The page title is the settings area ("Budgets"); sections inside are `h2` with `type-section-title`, separated as in section 3. Labels are above controls. Read-only facts (plan, created date, IDs) are listed in a `dl` at the top of the relevant section (section 20).

### 13.2 Save bar

A settings page whose fields are saved together uses one react-hook-form form and a `SaveBar`. Booleans in such a form are checkboxes, never switches (section 8).

```
 +-----------------------------------------------------------------+
 | 2 unsaved changes                        [Discard] [Save changes] |
 +-----------------------------------------------------------------+
```

| Aspect | Spec |
|---|---|
| Visibility | Rendered while `formState.isDirty` is true. Reverting every edit hides it again |
| Position | `sticky bottom-0` inside the content scroll container, `z-(--z-sticky)`, spanning the content area; its contents align to the 640 px form column |
| Surface | `min-h-save-bar` (56 px, `--size-save-bar`; taller only when the summary wraps on a narrow screen), `bg-surface border-t border-border px-5` (the 20 px page gutter). It is a `role="group"` named by its summary |
| Left | "{n} unsaved changes" (count of dirty fields, `formatInteger`) in `type-body text-foreground-secondary` |
| Right | "Discard" (`ghost`) then "Save changes" (`primary`), `md` (36 px), `gap-2`. "Save changes" is the submit button of the form (`type="submit"`, with the `form` attribute when the bar is rendered outside the `<form>`), so Enter in a field and a click on it do the same thing |
| Motion | Fades in over 150 ms (`starting:opacity-0`); leaves at once; instant under reduced motion |
| Space | The form reserves the bar's height (`pb-save-bar`, 56 px) and the scroll container sets `scroll-padding-bottom` to `var(--size-save-bar)`, so the bar never hides the focused field (WCAG 2.4.11) |
| Save | Validates everything (section 18). On success, `reset()` with the saved values hides the bar and a polite live region says "Changes saved". No toast |
| Failure | The bar stays; field errors are mapped (section 23); focus moves to the first error or the error summary |
| Discard | Resets to the last saved values immediately, without confirmation |
| Focus | When the bar leaves while one of its buttons has focus (after a save or a discard), focus moves to the first field of the form, so it is never lost to the page |
| Leaving | In-app navigation while dirty opens a dialog: "Discard unsaved changes?", body "Your changes to Budgets will be lost.", buttons "Keep editing" (`secondary`, initial focus) and "Discard changes" (`destructive-solid`). Closing the tab triggers the browser's `beforeunload` prompt |

Dialog forms (sections 25.1 and 25.2) do not use a save bar; their footer holds the actions.

### 13.3 Auto-save switches

The switch moves immediately (optimistic) and the mutation starts. After 400 ms pending, the switch sets `aria-busy` and ignores further toggles. Success shows nothing more, and no toast: the switch position is the confirmation. On failure the switch reverts and an error line appears under the row in `type-meta text-negative-text` ("Could not turn on weekly digest. Try again."), announced through a polite live region and cleared on the next toggle.

## 14. Secret input (tokens and API keys)

Two components, because entering a secret and showing a newly created one are different tasks.

**`SecretInput`** (entering a provider token, for example a Cloudflare API token):

| Aspect | Spec |
|---|---|
| Font | `type-mono` (Geist Mono), `w-full` |
| Masking | `type="password"`; trailing `icon-xs` `ToggleButton` with `Eye`, label "Show token" (`aria-pressed`) that switches to `type="text"` |
| Password managers | `autoComplete="off"`, `data-1p-ignore`, `data-lpignore="true"`, `spellCheck={false}` |
| Paste | Always allowed. Leading and trailing whitespace is trimmed by the schema |
| Pre-fill | **Never.** A saved secret is never sent to the browser. The saved state is shown as a read-only line: "Token saved · ends in 4f2a · Added Sep 12, 2026" with a `secondary sm` "Replace token" button that reveals an empty `SecretInput` |
| Verification | A `secondary` "Verify token" button beside or below the field calls the provider check; the result replaces the helper text ("Token valid. 3 zones available." or an error that names the missing permission) |
| Copy | Not offered: copying back what the user just pasted has no use and widens exposure |

**`SecretReveal`** (a secret shown once, for example a new API key): the full value in a read-only `type-mono` box (`bg-surface-subtle rounded-md px-3 py-2 select-all`), a labeled `CopyButton` "Copy" ([09-buttons-controls.md](09-buttons-controls.md) section 9.1), and a warning banner above it: "This key is shown once. Store it before closing." Closing the dialog removes the value from memory and the query cache ([20-frontend-specification.md](../20-frontend-specification.md) section 5.19).

## 15. File and CSV import

### 15.1 Dropzone

```
 +- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -+
 |  ⤒  Drop a CSV file here or [Choose file]                      |
 |     CSV or TSV, UTF-8, up to 50 MB and 10,000 rows             |
 +- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -+
```

| Aspect | Spec |
|---|---|
| Box | `flex h-24 items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-subtle px-4`. 96 px tall: a target, not a hero |
| Content and drag over | `Upload` icon 16 px, `type-body` sentence, `secondary sm` "Choose file", constraints in `type-meta`. Drag over: `border-primary-border bg-primary-subtle`, text "Drop to upload" |
| Keyboard | The dropzone itself is not focusable; "Choose file" is a real button that opens a hidden `<input type="file" accept=".csv,.tsv,text/csv">`. Drag and drop is an enhancement |
| Selected file | A one-line row replaces the dropzone: name, size, parsed row count, `icon-xs` "Remove file" |
| Errors | Below the dropzone as field errors: "This file is larger than 50 MB. Split it into smaller files.", "This file is not UTF-8. Export it again as CSV UTF-8.", "Only CSV and TSV files can be imported." |
| Paste alternative | A "Paste" tab next to "Upload file" holds a textarea (one row per line, tab-separated columns allowed) |

### 15.2 Steps

Imports run as a four-step `StepperDialog` (720 px) over Rank Tracker; the route `rankings/import` renders Rank Tracker with this dialog open ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) sections 1.1 and 4.6, which own the container and the stepper). Steps: Upload, Map columns, Review, Confirm.

1. **Upload**: dropzone or paste.
2. **Map columns**: a compact table with one row per file column: "Column in file" (`type-body`), "Sample values" (first 3 values, `type-meta`, truncated), "Maps to" (`Select` `sm`: Keyword, Location, Language, Device, Tags, Target URL, Ignore). Columns are auto-mapped from headers; required targets (Keyword) that are unmapped show a group error "Map a column to Keyword". Two columns mapped to one target is an error on both rows.
3. **Review**: counts as a segmented filter over the preview table (New 1,204 · Duplicate 38 · Variant 6 · Conflict 2 · Invalid 11 · Over quota 0), and a preview table of the first 20 rows of the selected status with a "Reason" column ([08-seo-keyword-system.md](../08-seo-keyword-system.md) section 3.3 for cases and default actions). Device "Both" shows as two rows.
4. **Confirm**: the primary button states the result: "Import 1,204 keywords". Pressing it closes the dialog; the page header shows `CollectionProgress` for the import job, and a toast with "View report" appears on completion ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 4.6).

"Back" (`secondary`) keeps every earlier choice (WCAG 3.3.7). The preview and mapping tables follow [12-tables.md](12-tables.md).

## 16. Inline compact forms

Short edits inside a table toolbar or a table cell: bulk "Set priority", "Add tags to 12 keywords", renaming a group.

| Aspect | Spec |
|---|---|
| Controls | `sm` (32 px): `h-control-sm`, `px-2` |
| Labels | Present but visually hidden (`Field.Label className="sr-only"`); the toolbar context and placeholder make the purpose visible. The placeholder never replaces the accessible label |
| Layout | Horizontal, `gap-1.5`, replacing the toolbar's bulk actions while open |
| Actions | "Apply" (`primary sm`) and "Cancel" (`ghost sm`). An open inline form is its own region, so this is the one place a primary button appears in a table toolbar |
| Keys | Enter applies; Escape cancels and returns focus to the control that opened the form |
| Cell edit | Enter or blur commits a valid value; Escape cancels. An invalid value keeps the editor open with `border-negative-solid` and the message in a non-modal popover anchored below the cell, referenced by `aria-describedby` |
| Errors | Validated on submit only; inline forms are too short for blur validation to help |

## 17. Search field

`SearchInput` (`components/ui/search-input.tsx`) is used for page and table search. It is the only search field component, used by table toolbars and [13-filters-search.md](13-filters-search.md) section 6 alike ([25-component-inventory.md](25-component-inventory.md) section 23, item 18). Filter-bar integration is in [13-filters-search.md](13-filters-search.md).

```
 ┌──────────────────────────────────────┐
 │ ⌕  Search keywords               [/] │    empty, not focused
 └──────────────────────────────────────┘
 ┌──────────────────────────────────────┐
 │ ⌕  crm software                  [×] │    with value
 └──────────────────────────────────────┘
```

| Aspect | Spec |
|---|---|
| Element and size | `type="search"` in `InputGroup`, WebKit cancel button hidden; `md` (36 px) `w-90` on pages, `sm` (32 px) `w-60` in table toolbars |
| Leading icon | `Search`, 16 px (`md`) or 14 px (`sm`), `text-foreground-muted`, 8 px from the left edge; text starts at 32 px (`pl-8`) |
| Placeholder | "Search {objects}", naming what is searched, in `foreground-tertiary` |
| Clear | `icon-xs` `X` "Clear search" at 4 px from the right, only while there is a value; focus returns to the input |
| Shortcut hint | On table pages, "/" focuses the table search when focus is not in another input, and that field shows `Kbd` "/" at the right while empty and not focused. On other pages "/" opens the command palette in search mode ([20-accessibility.md](20-accessibility.md) section 14), so page-level search fields show no "/" hint. The shortcut can be turned off with the "Single-key shortcuts" switch in Settings > Preferences (WCAG 2.1.4); the hint is hidden while it is off |
| Behavior | Results update as the user types (250 ms debounce), query in the URL (`q`), no submit button. Escape clears the value, or blurs when empty. Page-level search sits in a named `<search>` landmark. `autoComplete="off"` |

## 18. Validation timing

| Moment | What is validated | What is shown |
|---|---|---|
| Typing before the first blur | Nothing | Nothing |
| First blur of a field | That field | Its error, if the field has been changed (`isDirty`) |
| Typing after an error is shown | That field, on every change | Error updates or clears as the user fixes it |
| Submit | Every field | All errors; focus moves (below) |
| Server response | Server rules | Field and form errors (section 23) |

Configuration: `useForm({ mode: 'onTouched', reValidateMode: 'onChange', shouldFocusError: true })`. `FormField` decides what is shown: an error appears when the field loses focus after the user changed it (`isDirty` at that blur), and from then on it follows every change, also when the field is emptied again; a submit shows every error; an error set by the server shows at once. So tabbing through an empty required field shows nothing, and nothing appears while the user is still typing, also in a field that was only tabbed through before. A reset (`reset()` or `reset(values)`) starts every field over. A step of a multi-step dialog validates with the `handleSubmit` of that step: errors set by `trigger()` alone are shown only on fields the user has edited.

**Focus on failed submit.** Forms with up to 6 fields and one section move focus to the first invalid field (react-hook-form `shouldFocusError`; every control takes the field's `ref`, and a group control takes it as `focusRef`, which focuses its chosen or first option). Longer forms render an `ErrorSummary` at the top of the form and move focus to it:

```
 +------------------------------------------------------------+
 | (x) Fix 2 fields to save                                   |
 |     Monthly limit  Enter an amount from $1.00 to $100,000.00|
 |     Soft limit  Enter a percentage from 1 to 100            |
 +------------------------------------------------------------+
```

The summary is a region banner ([18-notifications-alerts.md](18-notifications-alerts.md) section 4: `rounded-md border border-negative-border bg-negative-subtle py-2 px-3`, `CircleX` 16 px `text-negative-text`), heading `type-subsection-title` with `tabIndex={-1}`, and one link per error that focuses its field: the whole line is the link, with the field's label in `type-body-strong text-link`, underlined, followed by the message. No punctuation joins the two, so the line needs no translation rule. If the target cannot take focus the link still scrolls to it. It is not a live region, because moving focus to it already causes it to be read; announcing it twice is noise. It disappears once all listed errors are fixed.

**Asynchronous checks** (uniqueness of a name or domain) run on blur, never per keystroke; the server check on submit remains authoritative.

## 19. Error messages

Messages are specific, neutral and say how to fix the problem. They are written once in the shared zod schemas (section 22) so the client and the API produce identical text.

| Rule | Write | Do not write |
|---|---|---|
| Say what to do | "Enter a keyword" | "Keyword is required" |
| Include the constraint | "Enter an amount from $1.00 to $100,000.00" | "Invalid amount" |
| Name the format with an example | "Enter a date as YYYY-MM-DD, for example 2026-09-29" | "Wrong date format" |
| Neutral, no blame, no codes | "This keyword is longer than 700 characters. Shorten it." | "You entered too many characters", "url_not_allowed" |
| Name the conflict | "hubspot.com is already a competitor" | "Duplicate" |
| No "invalid", "oops", "please" or exclamation marks; sentence case | "Enter a domain, for example example.com" | "Oops! Invalid Domain!" |
| Numbers through `@/lib/format` | "Select at most 1,000 keywords" | "Select at most 1000 keywords" |

Form-level errors (quota, permission, conflict) name the limit and the way out: "This adds 240 keywords, but only 96 are left in your plan. Remove 144 keywords or archive unused ones."

## 20. Disabled and read-only

| | Disabled | Read-only |
|---|---|---|
| Meaning | Editable in principle, not right now | Shown for reference; not editable here |
| Examples | "Language" until a location is chosen; replicates while a run is in progress | Keyword text after creation (identity is immutable), project slug for editors, workspace ID |
| Rendering | The control with disabled styles ([09-buttons-controls.md](09-buttons-controls.md) section 2.4 and section 4 here) | `ReadOnlyField`: a `dt` label in `type-label` and a `dd` value in `type-body text-foreground` on `bg-surface-subtle rounded-md px-3 min-h-control flex items-center`, selectable, with a `CopyButton` where the value is an ID |
| Focus | Not focusable, except with a reason tooltip when the reason is not visible nearby | Value text is selectable; not a tab stop unless it has a copy button |
| Submitted | No | No |
| Explanation | Helper text or tooltip says why ("Choose a location first") | Helper text only when the reason is not obvious ("The keyword text cannot change. Add a new keyword instead.") |

Users without write permission see settings as read-only fields, not as disabled controls, and the save bar never appears ([20-frontend-specification.md](../20-frontend-specification.md) section 3.9).

## 21. Autocomplete attributes

WCAG 1.3.5 requires the purpose of fields about the user to be programmatically determinable.

| Field | `autoComplete` |
|---|---|
| Full name | `name` |
| Email (sign-in, invite, profile) | `email` (plus `type="email"`) |
| Current password | `current-password` |
| New password | `new-password` |
| One-time code (TOTP) | `one-time-code` (plus `inputMode="numeric"`) |
| Company in onboarding | `organization` |
| Project's own website in onboarding | `url` |
| Keywords, prompts, domains, competitor names, tags, search, numbers, dates | `off` |
| Provider tokens | `off` (section 14) |

Password fields allow paste and password managers (WCAG 3.3.8).

**`PasswordInput`** (`ui/password-input.tsx`) is the field for a password of the user's own account: an `InputGroup` with a trailing `icon-xs` button that shows or hides the password. The button is named by what it will do ("Show password", then "Hide password"), so it has no pressed state; `autoComplete` is a required prop (`current-password` or `new-password`). A shown password is never spell-checked or capitalized. A provider token is not a password and uses `SecretInput` (section 14).

**`OtpField`** (`ui/otp-field.tsx`, Base UI `OTPField`) is the field for a one-time code: six 40 px cells (`size-control-lg`, `gap-2`, tabular figures), digits only. Typing moves to the next cell, Backspace to the previous one, and a pasted code fills every cell, spaces ignored. The first cell carries `autocomplete="one-time-code"`; the group is named by the `FieldLabel` of its `Field`.

## 22. react-hook-form and zod integration

1. **One schema, two consumers.** Form schemas live in `packages/contracts/src/forms/` and are built from the API request schemas with `.pick`, `.extend` and `.transform`. The web app never redeclares a constraint (length, range, regex) that the contract already has.
2. **Field names equal API body paths** (`limit_usd`, `soft_limit_pct`), so 422 error paths map to fields without a translation table.
3. **Input and output types differ where the API wire format differs.** A money field is a `number` in the form and a decimal string on the wire; the schema's `.transform` produces the request body.

```ts
// packages/contracts/src/forms/budget.ts
import { z } from 'zod';
import { BudgetCreate } from '../budgets';

export const BudgetForm = z
  .object({
    workload: BudgetCreate.shape.workload,
    limit_usd: z
      .number({ error: 'Enter a monthly limit' })
      .min(1, { error: 'Enter an amount from $1.00 to $100,000.00' })
      .max(100_000, { error: 'Enter an amount from $1.00 to $100,000.00' }),
    soft_limit_pct: z
      .number({ error: 'Enter a percentage' })
      .int({ error: 'Enter a whole percentage' })
      .min(1, { error: 'Enter a percentage from 1 to 100' })
      .max(100, { error: 'Enter a percentage from 1 to 100' }),
    action_on_hard: BudgetCreate.shape.action_on_hard,
  })
  .transform((v): z.input<typeof BudgetCreate> => ({ ...v, limit_usd: v.limit_usd.toFixed(2) }));

export type BudgetFormValues = z.input<typeof BudgetForm>;
export type BudgetCreateBody = z.output<typeof BudgetForm>;
```

```tsx
// apps/web/src/features/costs/budget-form.tsx
'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { BudgetForm, type BudgetCreateBody, type BudgetFormValues } from '@contracts/forms/budget';
import { applyServerErrors } from '@/lib/forms';
import { isApiProblem } from '@/lib/api';
import { toBudgetFormValues, useCreateBudget } from './budget-api';

export function BudgetFormView({ defaultValues }: { defaultValues: BudgetFormValues }): React.ReactElement {
  const form = useForm<BudgetFormValues, unknown, BudgetCreateBody>({
    resolver: zodResolver(BudgetForm),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    defaultValues,
  });
  const createBudget = useCreateBudget();

  const onSubmit = form.handleSubmit(async (body) => {
    try {
      const saved = await createBudget.mutateAsync(body);
      form.reset(toBudgetFormValues(saved));
    } catch (error: unknown) {
      if (!isApiProblem(error) || error.code !== 'validation_failed') throw error;
      const rest = applyServerErrors(form, error.errors ?? [], { fields: ['workload', 'limit_usd', 'soft_limit_pct', 'action_on_hard'] });
      setFormError(rest[0]?.message ?? null);   // shown in a FormAlert
    }
  });

  return (
    <form noValidate onSubmit={onSubmit}>
      {/* FormField per field; SaveBar bound to form.formState */}
    </form>
  );
}
```

Rules: `'use client'` only on the form component; data fetching for defaults stays in the server component above it. `defaultValues` come from the API resource, never from local storage. Unknown response errors are rethrown to the route's error boundary.

## 23. Server errors mapped to fields

RFC 9457 problems ([19-api-specification.md](../19-api-specification.md) section 2.7) reach a form in two steps.

**Step 1, field errors.** `applyServerErrors(form, items, { fields, messages })` in `lib/forms/apply-server-errors.ts` takes the `errors[]` of a `422 validation_failed` and returns the items that belong to no field of the form:

| Item | Handling |
|---|---|
| `location: "body"` and a path that is one of `fields` or lies under one (`items.3.keyword` under `items`) | `form.setError(field, { type: 'server', message })` on the field with that exact path, or else on the longest listed field the path lies under, because that is what the form renders. A field keeps the first error it gets. The message is the client copy for the item's `code` when `messages` has one, else the server `message`. The first such field takes focus |
| A body path the form does not render, or `location` `query`, `path` or `header` | Returned, in order. The form shows these in a `FormAlert` above the footer or save bar; nothing is dropped |

`fields` is the list of field names the form renders. It is passed explicitly, because react-hook-form has no public way to ask which fields are mounted.

**Step 2, the problem as a whole.** The form's submit handler decides by `code` before or after step 1. This part is `applyProblem(form, error, { fields, messages, codeToField, alertCodes })` in `lib/forms/apply-problem.ts`, typed with `ApiProblem`; it returns `fields`, `alert`, `conflict` or `fresh-session` and rethrows anything else. It is built and tested for the resource forms of the later plans (projects, members, workspace settings), which have form-level codes and the conflict dialog. The account and auth forms of the foundation do not use it: they have neither, a failed save there keeps the form and shows its own sentence instead of reaching the route's error boundary, and `useFreshSession` handles `fresh_session_required` before the form sees it:

| Response | Handling |
|---|---|
| Code tied to one field (`409 duplicate`, `422 url_not_allowed`, `422 keyword_too_long`, `422` with `slug_reserved`) | Mapped to its field through a per-form `codeToField` map, then as step 1 |
| Form-level codes (`422 quota_exceeded`, `422 competitor_limit`, `422 budget_exceeded`) | `FormAlert` with the limit and the way out (section 19) |
| `409 conflict` | A lock timeout: nothing was written, and one retry is safe ([19-api-specification.md](../19-api-specification.md) section 2.7). The query client has already retried once when the wait was short; if it still fails, the form treats it as the row below |
| `412 precondition_failed` | A stale edit, once the API sends `If-Match`. Not a form error: the conflict dialog with "Reload" ([20-frontend-specification.md](../20-frontend-specification.md) section 3.7) |
| `403 fresh_session_required` | Re-authentication dialog, then one automatic retry |
| Anything else | The caller rethrows to the route's error boundary |

After mapping, focus is on the first field with a server error (or on the error summary in long forms). A server error clears when the user changes that field, because the schema is checked again on every change.

## 24. Accessibility

| Requirement | Implementation |
|---|---|
| Label association (1.3.1, 4.1.2) | `Field.Label` is a `<label>` tied to the control by Base UI; visually hidden labels in inline forms still exist |
| Descriptions | Helper text and error are `Field.Description` and `Field.Error`, referenced by `aria-describedby` |
| Invalid state | `aria-invalid="true"` from `Field.Root invalid`; the `negative-solid` border is not the only cue (icon and text accompany it) |
| Required | `aria-required="true"`; optional fields say so in the label text |
| Groups | `fieldset` and `legend` (Base UI `Fieldset`) for radio groups, checkbox groups, segmented controls and date From/To pairs |
| Error identification (3.3.1) | Every error is text, next to its field, naming the field's problem |
| Error suggestion (3.3.3) | Every message states the fix or the constraint (section 19) |
| Error announcement | On submit, focus moves to the first error or the summary, which reads it. Field errors that appear on blur are read when the field is focused again. Only the auto-save failure and the "Changes saved" confirmation use a polite live region |
| Redundant entry (3.3.7) | Multi-step flows keep earlier answers; "Add keywords" remembers the last location, language and device for the session |
| Accessible authentication (3.3.8) | Paste and password managers allowed; no cognitive tests |
| Input purpose (1.3.5) | Section 21 |
| Focus not obscured (2.4.11), target size (2.5.8) | `scroll-padding` for the save bar; controls at least 24 px |
| Label in name (2.5.3) | Visible label text starts the accessible name |

## 25. Examples

### 25.1 Add keywords (dialog, 560 px)

```
+------------------------------------------------------------------+
| Add keywords                                                 [x] |
|                                                                  |
| Keywords                                                         |
| +--------------------------------------------------------------+ |
| | crm software                                                 | |
| | best crm for small business                                  | |
| | hubspot alternatives                                         | |
| +--------------------------------------------------------------+ |
| One keyword per line. 3 keywords, 1 already tracked.             |
|                                                                  |
| Location                             Language                    |
| [United States               v]      [English         v]         |
|                                                                  |
| Device                                                           |
| [ Desktop | Mobile | Both ]                                      |
|                                                                  |
| Target URL (optional)                                            |
| [example.com/crm                         ]                       |
| Will track: example.com/crm                                      |
|                                                                  |
| Tags (optional)                                                  |
| [ [brand x] [q4 x]  Add tags            ]                        |
|------------------------------------------------------------------|
| 1,204 of 2,000 keywords used              [Cancel] [Add 2 keywords]|
+------------------------------------------------------------------+
```

Keywords: `Textarea`; the helper counts lines and known duplicates as the user types. Location: async `Combobox` (`w-90`). Language: `Select` (`w-60`), defaulted from the location. Device: segmented `RadioGroup`; Both changes the button to "Add 4 keywords" and the helper to "Both adds two tracked keywords for each keyword". Tags: creatable `MultiSelect`. The quota line is `type-meta num`. Larger lists use the import route (section 15).

### 25.2 Add competitor (dialog, 560 px)

```
+------------------------------------------------------------------+
| Add competitor                                               [x] |
|                                                                  |
| Domain                                                           |
| [https://www.hubspot.com/products/crm    ]                       |
| Will track: hubspot.com (path /products/crm ignored)             |
|                                                                  |
| Name                                                             |
| [HubSpot                      ]                                  |
|                                                                  |
| Track                                                            |
| [x] SEO rankings                                                 |
| [x] AI visibility                                                |
|                                                                  |
| Aliases (optional)                                               |
| [ [HubSpot CRM x]  Add alias                         ]           |
| Other names AI answers use for this brand.                       |
|                                                                  |
| (i) Adding a competitor changes share of voice for all entities  |
|     from today. SEO history is backfilled from stored snapshots. |
|------------------------------------------------------------------|
| 4 of 10 competitors                     [Cancel] [Add competitor] |
+------------------------------------------------------------------+
```

The name is suggested from the domain once and left alone after the user edits it. Track is a `CheckboxGroup` with the group error "Select at least one". The banner uses `info-subtle`. `422 competitor_limit` becomes a `FormAlert`; `409 duplicate` maps to Domain.

### 25.3 Integration configuration (settings page, Cloudflare)

```
 Integrations / Cloudflare
 +---------------------------------------------------------------+
 | Connection                                                    |
 |                                                               |
 | API token                                                     |
 | Token saved · ends in 4f2a · Added Sep 12, 2026 [Replace token]|
 |                                                               |
 |   after "Replace token":                                      |
 | [••••••••••••••••••••••••••••••••••••••••        ] [Show]     |
 | Create a token with Analytics Read on the zones to sync.      |
 | [Verify token]   Token valid. 3 zones available.              |
 |---------------------------------------------------------------|
 | Zones                                                         |
 | [x] example.com                                               |
 | [x] shop.example.com                                          |
 | [ ] staging.example.com                                       |
 |---------------------------------------------------------------|
 | Sync                                                          |
 | Backfill                                                      |
 | [Last 30 days          v]                                     |
 | Sync time        02:00 Europe/Berlin                          |
 |---------------------------------------------------------------|
 | Disconnect                                                    |
 | Stops syncing. Imported data is kept unless you delete it.    |
 | [Disconnect Cloudflare]                                       |
 +---------------------------------------------------------------+
 | 1 unsaved change                    [Discard] [Save changes]  |
 +---------------------------------------------------------------+
```

Zones are listed after a successful verification. Sync time is a `ReadOnlyField`. "Disconnect Cloudflare" is a `destructive` button outside the form that opens a confirmation dialog; the save bar does not include it.

### 25.4 Budget settings (settings page)

```
 Budgets / AI prompts
 +---------------------------------------------------------------+
 | Workload         AI prompts                                   |
 | Scope            Project: Acme US                             |
 |---------------------------------------------------------------|
 | Monthly limit                                                 |
 | [$  2,000.00 ]                                                |
 | Month to date: $1,284.10 (64.2%)                              |
 |                                                               |
 | Soft limit                                                    |
 | [  80      %]                                                 |
 | Alert at $1,600.00.                                           |
 |                                                               |
 | When the hard limit is reached                                |
 | +-----------------------------------------------------------+ |
 | | (o) Pause new runs                                        | |
 | |     Scheduled and manual runs for this workload are       | |
 | |     blocked until next month or until the limit is raised.| |
 | +-----------------------------------------------------------+ |
 | +-----------------------------------------------------------+ |
 | | ( ) Alert only                                            | |
 | |     Runs continue. Admins receive an alert.               | |
 | +-----------------------------------------------------------+ |
 +---------------------------------------------------------------+
 | 2 unsaved changes                   [Discard] [Save changes]  |
 +---------------------------------------------------------------+
```

Workload and scope are `ReadOnlyField` rows because they cannot change after creation. The limit helper shows month-to-date spend with `formatCurrency` and `formatPercent`; the soft-limit helper recomputes the alert amount as the user types. The schema is the one in section 22.
