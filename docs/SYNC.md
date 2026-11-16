# Private Tasks and Notes sync

Tasks and Notes save locally first. Every server save is an atomic encrypted file write. An independent host sync worker detects new revisions and uploads them to a private Cloudflare Worker/D1 service. Paired browser/Android clients also encrypt and sync directly to that service, so an online Android device does not need the host PC to upload Tasks or Notes. Both paths retry failed requests without requiring an AI agent. Closing the editor never deletes local data.

## Storage and recovery

- Browser/Android local storage retains all task and note records, unsent changes, their last acknowledged revision, and the merge baseline.
- The host stores encrypted current snapshots and encrypted revision history under `.context/todo/`.
- Cloud content is compressed and then encrypted with a separate AES-256-GCM recovery key **before** uploading. Large encrypted snapshots are split into database chunks below the provider?s row-size limit. The service only sees opaque document IDs, encrypted snapshots and revision metadata.
- The cloud API requires a high-entropy bearer secret. The master secret stays on the host. Each paired session gets a separate durable device capability limited to its own Tasks and Notes documents; Disconnect revokes that capability immediately, including while the host app is closed. Already downloaded local copies remain local. No keys, user data, recovery bundles or deployment-specific identifiers belong in Git.
- A compare-and-swap revision prevents an older device from replacing newer cloud data. Retried uploads are idempotent.
- Independent field changes merge. When both devices edit the same field, the newer record is retained and the other edit is preserved as a clearly named recovery copy. Deletion wins for the original ID; simultaneous edited content is retained under a new recovery ID rather than resurrecting the original.
- Cloud and local history retain the latest 100 revisions per workspace plus one revision per day for the last 30 days. Current snapshots and recovered edit records are never removed by history retention. This is a recovery mechanism in addition to synchronization.

A private recovery bundle is stored in `.context/sync/recovery.json`. **Copy it to a separate secure location.** It contains the cloud access token, encryption key and document namespace needed after losing the original host. Losing both the host and this key makes the encrypted cloud contents unrecoverable. Never post the bundle, email it to strangers, or commit it.

## Offline behavior

`/open-todo-zero/offline.html` opens the same Tasks and Notes editors using permanent local copies. The Android companion pins the static assets listed by `offline-assets.json` to app-private files, and uses this shell when the host is unavailable. Both datasets hydrate after pairing, even before their tabs are visited. Offline edits set durable dirty markers. If internet access is available, the client encrypts and uploads them directly even when the host is off; otherwise it retries after reconnecting. Closing and reopening retains local records, the acknowledged cloud baseline, and pending edits.

AI, calendar writes and provider operations need the connected host. Offline editing does not pretend these operations succeeded. Android must have paired and downloaded its offline assets at least once. Clearing Android app data/browser storage or uninstalling removes that device's local copy; use the encrypted host/cloud backup to recover.

## Run your own private service

1. Install Wrangler and sign in to your Cloudflare account.
2. Create a separate D1 database: `wrangler d1 create onea2o-private-sync`.
3. Copy `apps/sync-worker/wrangler.example.jsonc` to a **private**, ignored configuration file, fill in your database ID, and set its `main` path relative to that file.
4. Run `wrangler d1 execute onea2o-private-sync --remote --file apps/sync-worker/schema.sql --config <private-config>`.
5. Create a random 32-byte bearer secret and set it using `wrangler secret put SYNC_TOKEN --config <private-config>`. Never put secrets directly into a command argument or source file.
6. For a hosted HTTPS app, configure `vars.CLIENT_ORIGINS` with its exact origin (or comma-separated exact origins). Loopback origins used by the desktop and native Android transport are accepted automatically; arbitrary web origins are rejected. Deploy with `wrangler deploy --config <private-config>`.
7. Use `node scripts/sync/configure.mjs --url https://your-worker.workers.dev` to generate an independent content key and configure your host. This command reads the bearer secret securely from standard input and writes an encrypted runtime configuration plus a private recovery bundle.
8. Run `node scripts/sync/worker.mjs --once` to perform the initial backup. The local launcher starts the long-running worker whenever encrypted sync configuration exists.

The host sync process polls local revisions every two seconds and checks cloud revisions at least every 15 seconds while running. Browser clients debounce uploads by 500 ms and check cloud revisions every 15 seconds. Network failures keep local copies and retry automatically. "Saved on device and in private cloud" is shown only after successful cloud acknowledgment of the current data. Cloud and host revision baselines are separate, so a stale host cannot overwrite newer direct Android edits. When the host returns, it imports and reconciles the cloud changes. A host must still be running for mail/messaging provider operations, AI and calendar integrations; Tasks and Notes use their permanent local copies and direct encrypted cloud connection independently.

To recover on a replacement host, run `node scripts/sync/configure.mjs --recovery <private-bundle>` with that host's normal local encryption configuration, then start the sync worker. A missing local document is restored from the decrypted cloud head. Existing local documents are merged rather than overwritten. Keep the recovery bundle after restoring.

## Design references

Notion's engineering write-ups describe durable local records, queued operations and revision-based reconciliation: [offline architecture](https://www.notion.com/blog/how-we-made-notion-available-offline), [record/transaction model](https://www.notion.com/blog/data-model-behind-notion). This implementation keeps every task and note locally instead of applying a cache-eviction policy. It preserves conflicting content rather than claiming a full collaborative text CRDT implementation.

## Validation

- `node --test scripts/sync/core.test.mjs scripts/sync/browser-crypto.test.mjs scripts/sync/worker-api.test.mjs`: encryption/tamper checks, WebCrypto/Node wire compatibility, concurrent local file locking, conflict preservation, scoped device capabilities and revocation, compare-and-swap, idempotency, large snapshots, bounded history and CORS.
- `node scripts/sync/offline-browser-test.mjs`: cold offline startup at a nested app URL, editing Tasks and Notes, and retaining edits after reload while all host APIs fail.
- `node scripts/sync/direct-cloud-browser-test.mjs`: an isolated fictional workspace on the configured private service; all host APIs return 503, direct encrypted edits reach cloud, a fresh browser retrieves both workspaces, and revoked clients cannot upload while their rejected edit remains local.
- `node scripts/sync/live-test.mjs`: verifies actual local/cloud encrypted snapshots agree, then tests history and fresh-host recovery using a separate synthetic document. Live checks require private host configuration; they never edit real task/note content.
