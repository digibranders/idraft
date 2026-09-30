# ADR-013: Nightly pg_dump with age encryption to R2; pgBackRest for PITR later

Status: Accepted, amended by ADR-022 (2026-09-30)
Date: 2026-09-29

## Context
No paid DO backups. Need off-host, encrypted, tested backups. WAL-G `wal-push` currently hangs against R2 (open issue, 2026-09-10).

## Decision
Nightly `pg_dump -Fc` with zstd, encrypted with age to two public recipients, uploaded with rclone to R2; GFS retention 14 daily, 8 weekly, 12 monthly; R2 bucket lock on the backup prefix; weekly automated restore test; Healthchecks dead-man pings. PITR via pgBackRest with WAL archiving when RPO below 24 hours is required (this needs a custom Postgres image with pgBackRest installed; V1 runs the stock `postgres:18` image).

Keys (doc 23 section 5, doc 24 section 5.1): the server holds only the public recipients (`/etc/seo-platform/backup-recipients.txt`) and can never decrypt a backup. The `recovery` identity (post-quantum hybrid) is kept offline by two custodians and rotated when a custodian leaves or on suspicion. A separate `restore-test` identity (X25519) exists only as the GitHub Actions environment secret `restore-test`, restricted to `main` and to the weekly restore workflow, which runs off the droplet on a disposable runner; it is rotated yearly and immediately on suspicion.

## Alternatives considered
DO backups (excluded); WAL-G (R2 bug); Barman (weak S3-compatible support); no encryption.

## Consequences
RPO 24 h in V1; simple and tested restore path. Whoever can read the `restore-test` secret and the read-only R2 token can decrypt backups; access to that GitHub environment is reviewed at each quarterly game day.

## Revisit trigger
External SaaS launch, contractual RPO below 24 h, nightly dump longer than 60 minutes, or restore phase of the weekly test longer than 90 minutes (doc 23 section 13.2).

## Amendment (2026-09-30)
Changed by [ADR-022](ADR-022-python-backend-simplified-platform.md):

- Retention: 30 days, enforced by an R2 lifecycle rule on `seo-backups/daily/`. The GFS rotation (14 daily, 8 weekly, 12 monthly) is removed.
- DigitalOcean weekly droplet backups are enabled ($4.80/month) as a second, host-level copy. This reverses "No paid DO backups" and "DO backups (excluded)" above.
- Restore testing: a scripted restore drill (`restore-verify.sh` into a temporary container) is run monthly and the result recorded. It replaces the weekly automated restore test.
- Removed: the R2 bucket lock, the CI restore workflow, and the `restore-test` identity with its GitHub Actions environment secret. Dumps are age-encrypted to one offline recipient pair (the `recovery` identity); the server still holds only the public recipient. The Consequences sentence about the `restore-test` secret no longer applies.
- Unchanged: nightly `pg_dump -Fc` with zstd, rclone to R2, Healthchecks dead-man pings, RPO 24 h and RTO 4 h. PITR via pgBackRest remains the trigger-based later step, and the revisit triggers apply to the monthly drill in place of the weekly test.
