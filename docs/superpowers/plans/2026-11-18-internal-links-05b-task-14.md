# Internal links 05, Task 14 in step form: alert rules

Expands Task 14 of `2026-11-16-internal-links-05-web-slices-2-3.md` (an outline) against the screens on
`feat/internal-links-web` at 22985e24. Spec 7.10 "Alert rules"; mock `il-dialogs.js` and `il-settings.js` (the
`ALERT_*` constants and the Alerts block of the crawl settings); API doc 19 section 4.8.

## What the real code already has (so what changes)

- The project settings screen (`features/project-settings/internal-links-screen.tsx`) holds `Edits`, builds a patch of
  the changed members only, saves it through the save bar (`PATCH settings { internal_links }`), guards leaving, and
  writes the answer into the `linkSettingsQuery` cache entry. The Alerts section joins that form: no second Save.
- `AlertSettings` and `AlertSettingsPatch` are generated types (`lib/internal-links/types.ts`). The mock settings
  handler merges `alerts` member by member and refuses `email` and `slack` with a 422 (reason in `errors[0].message`).
  Bounds in the handler and the API: `max_position` 1 to 8, `threshold` 1 to 50.
- Dialogs of the Internal links screen (`RulesDialog`, `ImportDialog`) are mounted in `internal-links-screen.tsx` and
  opened from screen state. The Changes tab reaches the screen through `LinksTabContext`.
- `alertTierText` (with the `tierPair` and `tierRange` words of `internalLinks.context`) words "T1", "T1 and T2",
  "T1 to T4". `reasonOf` (`rules/problem-reason.ts`) gives the first field message, else detail, else title.
- The Changes banner reads `alert.delivery_state`, which the API derives from the saved channel; invalidating
  `changesSummaryQuery` after a save is what keeps the delivery line true.

## Decisions

- **Two hosts, one form.** `AlertFields` is a controlled form body (draft in, `onChange` out) with the pure helpers
  `checkThreshold`, `alertPatch`, `tierChoices`, `draftOf`. The settings screen feeds it from its own edits and its save
  bar. `AlertRulesDialog` (the Changes tab) owns a draft, a Save button in the dialog footer and the dirty guard.
- **Tier choices follow the workspace.** The plan's "T1 only / T1 and T2" is stale: the API accepts 1 to 8. The select
  offers 1 up to the number of tiers the workspace has (at most 8), and always the saved value. Labels: "T1 only",
  then `alertTierText` ("T1 and T2", "T1 to T3", ...).
- **Channels.** "In the app" selectable; "Email" and "Slack" listed disabled with the reason as the option description
  (alerts service, WP-47). They are never selectable.
- **Threshold** is a text input with `inputMode="numeric"`; `checkThreshold` refuses anything but a whole number from
  1 to 50 before a request is made. The server's 422 reasons show in a form alert via `reasonOf`.
- **Viewers** (no `projects:write`) read the values as text (`ReadOnlyList`); no Save, and the Changes banner has no
  "Change alert rules" action (`openAlertSettings` is `null` in the context).
- On success: success toast, the `linkSettingsQuery` entry is set from the answer, and `linkSettingsQuery`,
  `changesSummaryQuery` (through `internalLinksKeys`) are invalidated. The dialog closes; focus returns to the opener
  (the Dialog primitive restores it).
- When alerts are switched off the API sends no alert, so the banner (and its action) disappears; the project settings
  section stays the way back.

## Files

- Create `apps/web/src/features/internal-links/settings/alert-settings.tsx` (+ `alert-settings.test.tsx`): pure helpers
  and `AlertFields`.
- Create `apps/web/src/features/internal-links/settings/alert-rules-dialog.tsx` (+ `alert-rules-dialog.test.tsx`).
- Modify `features/internal-links/tabs.ts` (context gets `openAlertSettings: (() => void) | null`),
  `internal-links-screen.tsx` (state, dialog, context), `changes/changes-tab.tsx` (banner action),
  `features/project-settings/internal-links-screen.tsx` (Alerts section in the form and patch), their tests,
  `apps/web/messages/en.json` (`internalLinks.alerts`).

## Messages (`internalLinks.alerts`)

`title` "Alert rules", `description`, `section` "Alerts", `sectionHint`, `enabled` "Alert me when links to important
pages are lost", `enabledHint`, `important` "Important pages", `onlyT1` "T1 only", `threshold` "Lost links that raise
an alert", `thresholdHint` "From 1 to 50.", `thresholdError` "Enter a number from 1 to 50.", `channel` "Channel",
`app` "In the app", `email` "Email", `slack` "Slack", `unavailable` "Available when the alerts service ships", `on`,
`off`, `save`, `saved`, `savedText`, `saveFailed`, `readOnly`, `discardTitle`, `discardText`, `keepEditing`, `discard`,
`loading`, `loadFailed`, `loadFailedReason`; `changes.alertAction` "Change alert rules".

## Steps

- [ ] **Step 1: failing tests** (all run and seen failing before code exists)
  - `alert-settings.test.tsx`
    - `checkThreshold('1')`, `('50')`, `(' 7 ')` are `null`; `('0')`, `('51')`, `('')`, `('2.5')`, `('1e1')`, `('abc')`
      are `'range'`.
    - `alertPatch(saved, draft)` is `{}` for an untouched draft; only `max_position` when only it changed; threshold
      is a number; an invalid threshold text is left out.
    - `tierChoices(3, 2)` is `[1,2,3]`; `(null, 2)` is `[1,2]`; `(12, 2)` is `[1..8]`; `(2, 5)` includes 5.
    - `AlertFields` for `{ enabled: true, max_position: 2, threshold: 1, channel: 'app' }`: switch checked, select
      shows "T1 and T2", threshold field "1"; opening the channel select lists "In the app" and "Email" and "Slack"
      with the reason, the last two `aria-disabled`; the tier select offers "T1 only" and "T1 and T2" for 2 tiers and
      "T1 to T3" for 3; a typed 51 shows "Enter a number from 1 to 50." when `thresholdError` is set; read-only mode
      shows the values as text with no controls; "equity" never appears; axe in light and dark.
- [ ] **Step 2: implement the pure helpers and `AlertFields`**; run; green.
- [ ] **Step 3: failing tests for the dialog** (`alert-rules-dialog.test.tsx`, mock API, role editor)
  - opens with the saved values; changing the threshold and pressing Save sends one PATCH whose body is exactly
    `{ internal_links: { alerts: { threshold: 3 } } }`, shows the toast "Alert rules saved", closes, and the settings
    cache then holds 3; a changed channel is not offered (email cannot be chosen); an invalid threshold shows the
    field message and sends nothing; a 422 (server forced with `server.use`) shows `errors[0].message` inline and
    keeps the dialog open and the draft; Cancel on a dirty draft asks before closing; a viewer sees text and "Close"
    only; focus returns to the opener when it closes; save invalidates the changes summary (a second summary read is
    made).
- [ ] **Step 4: implement `AlertRulesDialog`**; run; green.
- [ ] **Step 5: failing tests for the hosts.** Changes tab (through the screen): the alert banner has a button
  "Change alert rules" for an editor and none for a viewer; pressing it opens the dialog "Alert rules"; saving
  updates the delivery line from the new summary; the project settings screen has an "Alerts" section, a changed
  threshold counts as one unsaved change and is sent as `{ internal_links: { alerts: { threshold } } }` through the
  existing save bar together with other changed members; a 422 shows its reason; a viewer sees text.
- [ ] **Step 6: wire the hosts**, messages in `en.json`; run the targeted checks; one commit naming its files.

Checks (owner rule, targeted only): prettier on changed code files and `en.json`, eslint on changed `.ts` and `.tsx`,
one typecheck, `vitest --maxWorkers=1` over `src/features/internal-links`, `src/features/project-settings`,
`src/lib/internal-links`, `src/mocks`, `src/i18n`, one `pnpm build`.

```bash
git add apps/web/src/features/internal-links apps/web/src/features/project-settings apps/web/messages/en.json
git commit -m "Internal links: alert rules in the Changes tab dialog and the project settings"
```
