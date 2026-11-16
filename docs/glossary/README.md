# idraft glossary

The glossary is the one list of words the whole app uses: each term, what it means, what it never means, and the exact
text of its info ("i") button. A word that is not here is not final.

Status: decided 2026-11-16 (Group by the owner, the rest by taking the session's recommendations), except D17, D18 and
D20. Nothing is applied yet: the real app and the preview keep their current words until the pass in
`application-plan.md` runs. See `final-list.md` and `decisions-for-owner.md`.

## The one rule

**A term changes here first.** Nobody renames a visible word in `apps/web/messages/en.json`, the design preview, a spec
or a test unless the glossary row changed first, in the same commit or an earlier one. A pull request that changes a
visible word and does not touch `docs/glossary/terms.md` is unfinished.

## Files

| File | What it holds | Who reads it |
|---|---|---|
| `final-list.md` | One page: the word to use and the word never to use, for every concept, plus the decisions taken and the three still open | Everyone, while writing a string |
| `terms.md` | One row per term: the label (singular, plural, casing), the one-sentence definition, what it is not, banned synonyms, where it is used, the info text in two parts, translation notes | Everyone who writes or reviews a visible string |
| `decisions-for-owner.md` | The open choices, with options, reasons, how each model voted and the recommendation. Deleted from the proposal once the owner has decided, and each answer is copied into `terms.md` | The owner |
| `application-plan.md` | For each term, the exact edits needed in the real app, the design preview and the parity registers, in order, with sizes | The session that applies the glossary |
| `research/` | The evidence behind the choices (inventory, competitor wording, model proposals) | Anyone who asks why |

## How a visible word is written

1. Look the concept up in `terms.md`. Use its label exactly: casing, singular or plural, abbreviation.
2. A banned synonym never appears in a visible string, an aria label, a tooltip, an error message, an export header,
   an email, a help page or a screenshot. It may appear in code, API field names, database columns, comments and
   internal docs, because those are not visible words. The code name and the visible word may differ on purpose.
3. If the concept has an info text, copy it from `terms.md`. Do not write a second version in a component.
4. Put the string in `apps/web/messages/en.json`. A visible word is never hard-coded in a component.
5. Numbers that change with the data never go inside an info text. The text must be true for any scope.

## How the glossary changes

1. Open a change to `terms.md` that edits the row (label, definition, banned synonyms, info text) and adds a line to the
   "Change log" at the end of that file: date, term, old, new, reason.
2. If the change renames a visible label, the same change lists the `en.json` keys and the preview files it touches, so
   the application is mechanical.
3. The owner approves a rename of a canonical label. A fix to a definition or an info text that keeps the label may be
   approved by the reviewer of the change.
4. After approval, apply it with the recipe in `application-plan.md` ("How to apply one rename"), then run the
   word-check below.

## The word-check (to build in the application pass)

A small script, `scripts/check-glossary-words`, reads the banned synonyms of `terms.md` and fails when one appears in a
visible string of `apps/web/messages/en.json` or in a string literal of `apps/web/design-preview`. It runs with the web
lint. It is described in `application-plan.md`, section "Guard". It is not built in this session.

## Style of every definition and info text

- Plain words, one idea per sentence, no em-dashes or en-dashes, no figure that changes with the data.
- A definition is one sentence that starts with the term's category, not with the term. Write "The share of valid
  answers that...", not "Mention rate is...".
- An info text has two parts, in this order. **What it shows**: one sentence. **How it is counted**: the method, then
  what it leaves out.
- Never define a term with its own banned synonym.
- Say "you" and "your brand" only in info texts and empty states that speak to the reader. Table headers and filters
  use the neutral term.

## Translation

Every row has a note for translators. The rule behind it: a label is a noun that works alone in a column header, and a
sentence is built around the label with a variable, never by gluing label fragments. Plural forms go through ICU plural
rules in `en.json`.
