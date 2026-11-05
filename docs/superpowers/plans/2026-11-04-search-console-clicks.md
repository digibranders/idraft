# Search Console clicks and impressions, and the grouped Keywords view

Decision of 2026-11-04: the Clicks and Impressions columns of the Rankings table come from Search Console, never from an
estimate (doc 18 section 4.9). This plan says what is built, what the owner has to provide, and the order of the rest.

## State today

| Part | State |
|---|---|
| `include=gsc` on the tracked keyword list: `gsc { state, clicks, impressions, window }`, and the sorts `gsc_clicks`, `gsc_impressions` | Built (steps 3 and 4): `not_connected`, `pending` and `ok` from the stored numbers |
| `include=ranking_urls` (pages that rank for a keyword) | Built and committed (72bc44c) |
| Storage for connections, queries and daily numbers (`fp.connections`, `fp.integrations`, `fp.gsc_queries`, `fp.gsc_search_analytics`) | Built (step 1, migration 0015) |
| Connect with Google, choose the property, disconnect | Built and tested against a fake Google, no web screen yet (step 2) |
| The pull (backfill and daily sync) | Built (step 3): the `gsc_sync` job, tested against a fake Google; not yet run against the real one |
| The reading side that fills `gsc` from stored numbers, and the sorts `gsc_clicks`, `gsc_impressions` | Built (step 4); the export columns are built in the web, not here |
| Grouped view, new column order, header changes in the app | Waiting for the design preview to settle (the owner is updating it) |

## What the owner provides (nothing here can be done from the code)

1. **A Google Cloud project** with the Search Console API enabled.
2. **An OAuth consent screen** with the scope `https://www.googleapis.com/auth/webmasters.readonly`.
   - While the app is in Testing status Google expires refresh tokens after 7 days and allows 100 named test users,
     which is fine for Eventus and Fynix but not for customers. Production needs Google's verification of the scope.
3. **An OAuth client** of type Web application with the redirect URI `https://app.idraft.ai/api/v1/oauth/google/callback` (the route in docs/19). For local work add `http://localhost:3000/api/v1/oauth/google/callback`.
4. The client id and secret, put in `/etc/idraft/api.env` and `worker.env` as `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET` by the owner (never pasted in a chat), with `SECRETS_ENCRYPTION_KEY` (base64 of 32
   random bytes; required in production; never changed once an account is connected) in the same files.
5. **Access to the property** in Search Console for the Google account that connects, and which property type
   (domain or URL prefix) Eventus uses.

## Order of work

| Step | What | Done when |
|---|---|---|
| 1 | Migration for the `fp` tables of doc 18 section 12 that the clicks need: `connections`, `integrations`, `gsc_queries`, `gsc_search_analytics` (monthly partitions), with the least-privilege grants and their tests | Migration applies and rolls back; grant tests pass |
| 2 | Connect flow: start, callback (state and PKCE), token stored encrypted in `ops.secrets`, property list, property choice for a project | A connection row exists after a test sign-in against a fake Google |
| 3 | The pull: a Search Console client with the rate limits of doc 18 section 4.5, shape B of section 4.2, last 28 days first then 16 months, final data only (section 4.4), as a worker job | A fixture run fills `fp.gsc_search_analytics` and is idempotent |
| 4 | The reading side: the join of doc 18 section 4.9 (normalized query, country, device) replacing `gsc_repository.gsc_of`; the sorts; clicks and impressions in the export | `gsc` states `ok`, `pending`, `not_connected` from stored rows, with tests |
| 5 | Settings, Integrations screen (connect, choose property, state, disconnect) | A person can connect from the app |
| 6 | Rankings: Clicks and Impressions cells (value, 0, Pending, Not connected), the group sums | The columns show stored numbers |

Steps 1 to 4 need no UI. Step 2 needs items 1 to 4 above before it can be tried against Google; it can be built and tested
against a fake Google before that.

## The grouped Keywords view in the app

Built from the design preview (`design-preview/kw-grouped*.js`) once the owner has settled it. What is known now:

- A view switch in the table toolbar, By group and All keywords; group rows in the same columns as the keywords, with
  "n in top 10", sums for volume, clicks and impressions, an average CPC, the count cited in AI Overview, the latest check.
- Columns by view: the lists in the owner's brief of 2026-11-04 (By group leaves out KD, Intent, SERP features, Trend,
  Tags; All keywords keeps them, with CPC after AI Overview).
- Group numbers follow the device control; keywords with no group are listed as Not grouped.
- The country choice and a search box in the top bar (the search is interface only for now).
- Group actions: Check now, Add keywords, Rename, Export this group, Delete group.
- Everything the app already has stays: DataTable column types and widths, the design system, no em-dashes.

Open: whether the country picker belongs in the shell's top bar for every page or only on pages that have a country scope.

### Adding keywords in several countries (owner decision of 2026-11-04, from the audit session)

The mock and docs/design-system/08 section 3.1.1 hold the design. For the build:

- Add keywords gets a Countries multi-select (search, chips, at most 10 per add). Each keyword is tracked once per country
  and once per device, as separate tracked keywords. There is no "Global".
- Before Add the dialog shows keywords x devices x countries = checks a day, the estimated cost (about $0.0066 a check, per
  day and per month) and the plan use before and after. It refuses what would pass the quota with the existing
  `422 quota_exceeded` figures, where requested = keywords x devices x countries.
- The top-bar country lists only the countries the project has keywords in, plus "All countries" when there are several, and
  is a plain label with one. The Filter gets Country with several values. A Country column shows when more than one country
  is in view. In By group a group's count is distinct keywords, with "n countries" beside it.
- API: the list needs the countries in use and a filter that takes several country ids; the add sends one item per country.
