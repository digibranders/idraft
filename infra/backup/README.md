# PostgreSQL Backup and Disaster Recovery Runbook

This directory contains the backup, encryption, and restore drill automation for `app.idraft.ai`. The primary specification is in `docs/23-backup-disaster-recovery.md`.

## Security and Key Custody

Encrypted backups use `age` encryption (X25519 public key cryptography).

### Age Key Custody Rules

1. **Private Identity (`AGE-SECRET-KEY...`):**
   * Generated offline by the repository owner on an air-gapped or secure machine:
     ```bash
     age-keygen -o recovery.key
     ```
   * Stored securely in the team password manager and one encrypted offline archive.
   * **NEVER committed to git and NEVER stored on the production server.**
2. **Public Recipient (`age1...`):**
   * Extracted from the identity:
     ```bash
     age-keygen -y recovery.key > backup-recipients.txt
     ```
   * Deployed to the production host at `/etc/idraft/backup-recipients.txt`.
   * Public recipients can only encrypt backups; they cannot decrypt them. If the server is compromised, attackers cannot read existing backups.

### Key Rotation Procedure

Rotate the backup recipient key annually or immediately if a private key is exposed:

1. Generate a new keypair offline:
   ```bash
   age-keygen -o recovery-new.key
   age-keygen -y recovery-new.key > backup-recipients-new.txt
   ```
2. Update `/etc/idraft/backup-recipients.txt` on the host with the new public recipient key.
3. Trigger an immediate backup:
   ```bash
   sudo systemctl start idraft-backup.service
   ```
4. Confirm that the new dump decrypts with `recovery-new.key`.
5. Keep the old private key in the password manager for at least 30 days until all backups encrypted with it have reached their R2 expiration date.

## Nightly Backup Architecture

The backup script `infra/backup/pg-backup.sh` runs nightly at 01:30 UTC via systemd timer `idraft-backup.timer`:

1. **Consistent Snapshot:** Connects to PostgreSQL as user `backup` and exports a snapshot using `pg_export_snapshot()`.
2. **Manifest Checksumming:** Executes `backup-checks.sql` inside the snapshot transaction to compute row counts and MD5 table checksums.
3. **Encrypted Streaming:** Runs `pg_dump` with custom zstd format inside the snapshot, piping through `age -R /etc/idraft/backup-recipients.txt`.
4. **Staging Protection:** Streams encrypted bytes to `seo-backups/staging/` via `rclone`. A truncated or interrupted upload is never visible under `daily/`.
5. **Globals Dump:** Runs `pg_dumpall --globals-only --no-role-passwords` and encrypts with `age`.
6. **Promotion & Manifest:** Validates file sizes and SHA-256 hashes, promotes objects from `staging/` to `daily/`, and uploads the signed manifest JSON last.
7. **Healthchecks Monitoring:** Reports success, exit code, and log output to Healthchecks.io.

## Monthly Restore Drill

The restore drill script `infra/backup/pg-restore-drill.sh` executes monthly or on demand by an operator:

1. Connects to R2 using the read-only `restore-reader` token.
2. Identifies the newest manifest in `seo-backups/daily/`.
3. Downloads the encrypted dump and verifies its SHA-256 matches the manifest.
4. Decrypts the archive using the recovery identity file (`AGE_IDENTITY_FILE`).
5. Starts an isolated scratch PostgreSQL container on a non-conflicting port (never touching the live database).
6. Restores the database with `pg_restore --exit-on-error`.
7. Executes `backup-checks.sql` on the scratch database and asserts that row counts and checksums match the manifest exactly.
8. Destroys the scratch container and pings Healthchecks.io with the drill result.

### Running a Manual Restore Drill

On a machine with Docker and the recovery key:

```bash
export AGE_IDENTITY_FILE="$HOME/secure/recovery.key"
export SRC="r2-backups:seo-backups/daily"
sudo ./infra/backup/pg-restore-drill.sh
```

## Bucket Retention and Lifecycle

Cloudflare R2 bucket `seo-backups` enforces automatic object lifecycle per `lifecycle-seo-backups.json`:

* `staging/`: Expiration after 2 days (cleans up any stranded failed uploads).
* `daily/`: Expiration after 30 days (maintains a rolling 30-day restore window).
* Multipart Uploads: Incomplete uploads aborted after 24 hours.
