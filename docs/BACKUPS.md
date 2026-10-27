# Encrypted application snapshots

The trusted backup CLI creates an AES-256-GCM encrypted snapshot of ordinary, non-system MongoDB application collections. A single read-only snapshot transaction reads their documents; strict EJSON preserves BSON types, including Dates, integer/double distinctions, long integers, decimals and binary data. Collection options and index specifications are included. Collection/index metadata is checked again after the transaction; schema changes during the read cause the backup to fail for retry. The utility rejects unsupported views/time-series collections instead of silently omitting them.

This is an application snapshot utility, not offsite storage, point-in-time recovery or a certified disaster-recovery service. The default plaintext limit is 100 MiB and transaction reads have the application's 30-second bound. Larger datasets need an operator-managed MongoDB backup solution. The original SQLite migration backup is never changed by these commands.

## Protected configuration

Daily backups are **disabled by default**. No automatic key is generated and no unencrypted snapshot is written.

| Setting | Purpose |
| --- | --- |
| `BACKUPS_ENABLED` | Set to literal `true` only after configuring and verifying backup storage/key access. |
| `BACKUP_DIRECTORY` | Writable encrypted-file destination; default `.data/backups/encrypted`. Use a durable protected volume for containers. |
| `BACKUP_KEY_FILE` | File containing a base64-encoded 32-byte key, readable only by the worker/operator identity. |
| `BACKUP_ENCRYPTION_KEY` | Alternative protected environment source. Configure exactly one key source. Never log its value. |
| `BACKUP_MAX_BYTES` | Plaintext snapshot cap; defaults to 104857600, permitted range 1–512 MiB. |

Key files must have owner-only permissions on Unix. On Windows, `scripts/create-backup-key.ts` creates a new file without overwriting any existing one, removes inherited ACLs and grants the current Windows identity access. It does not print the key. Choose a protected parent directory and configure `BACKUP_KEY_FILE` through the environment before invoking it:

```powershell
npm run backup:key
```

Keep a separate protected recovery copy of the key, away from the encrypted snapshots. Losing it makes these backups unusable. Rotating the configured key does not re-encrypt older files; retain the corresponding old key securely until those files are retired. Do not put key material in source, command arguments, reports or public environment variables. The command removes its newly created file if securing permissions fails.

Production Compose gives only the worker backup configuration and mounts the durable `encrypted_backups` volume at `/var/lib/urbankare-backups`. The image creates that directory with mode 0700 and ownership for its non-root `node` user. The web container receives neither the backup key nor that volume. The host-local `BACKUP_DIRECTORY` setting is intentionally replaced with this container path. Existing volumes must retain correct ownership, and deleting the Compose volume deletes its snapshots; do not use `down --volumes` as routine shutdown.

Supply `BACKUP_ENCRYPTION_KEY` through the worker's deployment secret environment, or provide a protected read-only key-file mount in an operator-owned Compose override. For the file option, set the worker's `BACKUP_KEY_FILE` to the **container** path and leave `BACKUP_ENCRYPTION_KEY` empty. A host file path is not automatically mounted. For example, the following override contains no key value:

```yaml
services:
  worker:
    environment:
      BACKUP_KEY_FILE: /run/urbankare-secrets/backup.key
      BACKUP_ENCRYPTION_KEY: ""
    volumes:
      - type: bind
        source: ${BACKUP_HOST_KEY_FILE:?Set a protected host key-file path}
        target: /run/urbankare-secrets/backup.key
        read_only: true
        bind:
          create_host_path: false
```

The file must remain owner-only and readable by the worker identity (UID 1000 in the supplied Linux image). Configure host/service account permissions before enabling the schedule, and validate the chosen secret mount on the deployment host. Do not print resolved Compose configuration containing secrets; use `docker compose ... config --quiet`. This local durable volume does not supply an offsite copy or survive host loss.

## Manual snapshot and restore verification

Run with the intended MongoDB and protected backup configuration available. These CLIs load environment files using the same production-first precedence as the protected administration commands.

```powershell
npm run backup
npm run backup:verify -- <encrypted-snapshot.ukbackup>
```

The first command reports only the path, counts, encrypted size and checksum. The second authenticates/decrypts the file in memory, verifies its manifest hashes, then restores into a generated `urbankare_backup_verify_*` database. It refuses a target that already contains collections and never accepts an existing application database as a restore destination. It compares document counts, canonical BSON/EJSON hashes and recreated index specifications. TTL indexes are created after document verification so their normal expiry behavior does not invalidate the data comparison.

The generated verification database is removed after the attempt, guarded by its exact generated name and ownership marker. The source database is not overwritten. Verification requires credentials permitted to create and drop that isolated QA database; use an appropriately authorized operator connection, preferably on an isolated verification deployment. No live restore-overwrite command is provided.

## Daily worker schedule and retention

When `BACKUPS_ENABLED=true`, the existing worker checks after each maintenance cycle. A completed snapshot satisfies that UTC calendar day. A MongoDB lease allows only one worker/manual backup at a time; it lasts 30 minutes and is renewed during execution. A crashed worker's lease can expire for recovery. Lease loss prevents a normal success record; inspect the destination for an orphan encrypted file if a failure occurred after writing.

Backup status and the latest encrypted-file checksum/counts are recorded in `backup_state`. Failures are logged generically without keys or document content, and the worker retries on a later cycle. The normal disabled state performs no backup work. There is no automatic deletion/retention job; monitor capacity and set an explicit retention policy before enabling a continuous schedule.

On 25 October 2026 at 15:16 UTC, the expanded application's encrypted snapshot of `urbankare_mongo` completed with **49 collections, 179 documents and 199,771 encrypted bytes**. Restore verification matched documents and recreated indexes, then removed its generated QA database. The file is `.data/backups/encrypted/mongodb-urbankare_mongo-2026-10-25T15-16-52-844Z-240d64fb-06c8-4355-8f99-53d8c93dca52.ukbackup`, with SHA-256 `d523831ef8485b2b37272fb039cf26266eeb3de5b6007600deb6d25fcc5f78c3`. Evidence: `artifacts/backup-acceptance.log` and `artifacts/backup-verify-acceptance.log`.

The earlier 12:54 UTC snapshot remains retained: 44 collections, 176 documents, 191,723 encrypted bytes; file `.data/backups/encrypted/mongodb-urbankare_mongo-2026-10-25T12-54-02-406Z-767cc6cf-c4e5-4372-9f4c-5f49391f9945.ukbackup`, SHA-256 `fa75ef20d1e14ec41344ab344e9f03ed0dd5d1d12bc72dfbb28ddc2011997228`. The earlier 43-collection/173-document snapshot also remains retained. These counts describe individual snapshots, not current live data.

The protected local configuration enables the schedule. The earlier local worker was stopped during resource-intensive acceptance. Runtime metadata for the handoff worker is recorded in `artifacts/local-worker-status.json`; `.data/worker.pid`, `.data/worker.log` and `.data/worker-error.log` are private operational files. The process checks approximately every 60 seconds; the verified snapshot satisfies today's UTC backup schedule. Check the recorded process and current logs rather than assuming an earlier PID is still running.

This local process is **not an operating-system startup service**. Continuous execution requires the computer, Docker data services and worker to remain available; use a supervised service/container on the deployment host, and restart the local worker with `npm run worker` after shutdown. Check the recorded PID's command before starting another copy or stopping a process. The source example and production Compose default remain disabled until explicitly configured. This local check does not certify an external production deployment, retention policy or offsite recovery.
