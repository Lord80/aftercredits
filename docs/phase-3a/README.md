# Data Vault

Open **Data Vault** in the screening room footer. **Export** makes a portable JSON backup or a spreadsheet. **Import** compares a file with this browser. **Recovery** lets you inspect and restore an earlier local snapshot. All three work offline once the application is open.

[Desktop vault](desktop-vault.webp) · [Phone vault](phone-vault.webp) · [Merge preview](merge-preview.webp) · [Phone conflict review](phone-merge.webp) · [Restore confirmation](restore-preview.webp)

## Back up or transfer a journal

1. Choose **Download JSON backup**. Check your browser’s downloads and keep a copy outside the browser profile. The export date records file generation. Only the browser or operating system knows whether you kept the file.
2. On the destination device, open the vault and choose **Import → Choose JSON file**. Check the counts and inspect any conflicts. **Confirm merge** adds new titles and applies only the file versions you selected.
3. To reproduce the file exactly, choose **Restore**. Download the separate recovery JSON, check it is available, acknowledge replacement, and choose **Confirm replacement**. An empty backup can intentionally restore an empty collection.

JSON stores the original artwork paths. Viewing an uncached poster or backdrop later requires access to the image CDN. Ratings, dates and stored metadata can be reconstructed entirely from the JSON file.

## Portable JSON format

Files are UTF-8 and use UTC timestamps in filenames, for example `aftercredits-backup-2026-05-22T10-00-00.000Z.json`. A complete one-entry export looks like this.

```json
{
  "application": "AFTERCREDITS",
  "backupVersion": 1,
  "exportedAt": "2026-05-22T10:00:00.000Z",
  "entryCount": 1,
  "collection": {
    "version": 2,
    "entries": [
      {
        "id": "legacy-1",
        "mediaType": "movie",
        "tmdbId": null,
        "title": "Morning Rail",
        "rating": 8.5,
        "added": "2025-02-01T10:23:00.000Z",
        "metadata": null
      }
    ]
  }
}
```

| Field | Contract |
| --- | --- |
| Envelope | Application identifier and both versions must match. The declared count must match the array length. The export date must be a valid ISO date or timestamp. An empty entries array is valid. |
| Identity | Stable nonblank string ID, `movie` or `tv`, plus a positive safe integer TMDB ID or `null`. Manual entries use a normalized, case-insensitive title within their section. The original display text travels verbatim. |
| Personal fields | Title, finite rating from 1 through 10 in half steps, and valid ISO date or timestamp added. No timezone conversion, rounding or trimming is applied to stored strings. |
| Metadata | Manual entries normally have `null`. Catalog records may contain title, original title, overview, release or first-air date, original language, genres with numeric IDs, and relative artwork paths. Bounded optional JSON fields on records and metadata survive round trips. |
| Validation limits | 16 MiB per file, 50,000 records, 512 code units per local ID, 65,536 per title, 262,144 per other text value, 128 genres. Optional data is limited to depth 12, 128 fields per object, 128 code units per field name, and 2,048 items per nested array. |
| Older files | A raw v2 storage envelope, an original v1 array, or a v1 envelope with an entries array can be imported. Legacy entries retain their ID, date and rating and enter Movies as manual titles. The normal in-browser v1 migration still preserves its original bytes. |

The file reader bounds size before decoding and checks UTF-8, calendar dates, types, artwork paths, nested values, identities and versions. Repeated local IDs or media identities inside one file make the import invalid. The preview counts invalid rows and describes the first five. It can show counts for readable rows alongside errors. One invalid row blocks the entire apply. An unreadable envelope produces a file-level error before counts are available.

**CSV** includes title, media type, personal rating, TMDB ID, release year, release or first-air date, genres, original language and date added. It uses UTF-8 with a byte-order mark, CRLF records and quoted cells. Embedded quotes are doubled and embedded newlines are preserved. Formula-like prefixes and leading tab or line-break characters are neutralized with a leading apostrophe. CSV is for analysis. Use JSON for restoration.

## How a merge decides

| Incoming record | Result |
| --- | --- |
| Neither local ID nor title identity matches | Add the entry with its original ID, rating, date and metadata. |
| Same title identity and equal content, including optional fields | Count a duplicate and keep the existing record. Different local IDs alone do not create a conflict. |
| Same record, different rating, title, date, metadata or extension fields | Count a conflict. Keep the local version by default. Expand **Compare changed fields** to inspect both values. Selecting **Use the file’s version** replaces that record’s content and retains the destination’s stable local ID. |
| Same stable manual ID with a renamed title in the same section | Offer the same explicit conflict choice. |
| An ID is reused for a different catalog identity, or multiple records claim the same destination | Report the conflict and protect the local records in Merge. Review and correct the source file, or use a full Restore if that file is authoritative. |

Movie and TV titles can share a TMDB number. Remakes with different TMDB IDs can share a title. Merge places additions in file order before the existing entries and keeps the order of existing entries. Restore takes the entire order and stable IDs from the file. Previews, cancellation, validation errors and no-op merges leave the primary bytes intact.

## Persistence, recovery and privacy

The journal still lives under `aftercredits.collection.v2`. Two auxiliary keys belong to the vault.

- `aftercredits.vault.recovery.v1` keeps at most three pre-import snapshots, newest first. Recovery uses the same validation, preview, download and confirmation as Restore. Recovering an earlier journal makes a snapshot of the journal it displaces.
- `aftercredits.vault.status.v1` records the most recent full JSON export generated here and tracks collection changes. A small indicator appears on the footer control after five tracked changes. Dismissal waits for another five. CSV, recovery downloads, browsing and unchanged edits leave the full-backup date alone. Quota or permission issues may prevent the receipt from being recorded even when the file was generated.

Each import acquires the same origin-scoped Web Lock as ordinary edits. It reads the collection again, checks the preview against the current contents and validates both sides before writing. Changes in another tab refresh the preview and reset replacement consent. A queued import can be cancelled while waiting for the lock. Browsers without Web Locks can export files, but importing requires the HTTPS site in a browser that can coordinate the write.

A local checkpoint must persist before the atomic write of the primary storage value. When space is tight the vault tries fewer historical copies, always retaining the immediate pre-import checkpoint. If the primary write fails, the vault attempts to reinstate the old history. An interruption between the two writes leaves the previous archive and a usable checkpoint. A failed bookkeeping write cannot undo a successful collection write. An already protected or session-only archive allows export of readable entries and blocks replacement of stored bytes.

Files are generated locally from the collection. Import never contacts TMDB, follows an artwork URL from the file, or executes file content. The screening room builds official CDN URLs from validated image paths when displaying an imported title. Known credential and unsafe object keys are rejected. Keep personal information you type into titles or metadata in mind when sharing a backup. JSON, CSV and local snapshots are unencrypted. Browser-data deletion, profile loss and device loss can remove the journal and all local snapshots together.

## Implementation and verification

Shared identity and validation rules live in [validation.js](../../js/validation.js). The existing archive store owns normal persistence and the collection lock. File serialization, import planning, protected storage operations and the dialog each have their own module. The vault controller is loaded on first use. [Collection persistence](../../js/collection.js) · [File formats](../../js/backup.js) · [Conflict resolution](../../js/import-plan.js) · [Recovery storage](../../js/vault-store.js) · [Vault UI](../../js/vault.js)

All 19 Node tests passed. The picker, motion, screening-room finish and Data Vault browser suites passed in Chromium. The export, merge and replacement panes had zero axe violations in the desktop scans, and the phone export scan also passed. Layout checks covered 320, 360, 390, 430, 768 and 1440 CSS pixels. The automated checks use local fixtures and disposable Chromium profiles. They cover JSON round trips, both sections, manual titles, Unicode, full metadata and extensions, a 6,000-title archive, half-point scores, exact dates, invalid files, CSV readback, duplicate and conflicting identities, quota failures, cancellation and local recovery. A two-tab test queues an ordinary save ahead of a confirmed import and verifies that the stale import cannot overwrite it. A second case cancels a confirmed import while the lock is held.

The existing performance harness ran five alternating loopback pairs against the merged Phase 2E build in Chromium 156 at 1152 × 760. Median cold collection readiness was 267.3 ms for Phase 2E and 283.4 ms for Phase 3A. Warm readiness was 33.0 and 34.6 ms. Sorting 300 records took 35.0 and 45.7 ms. Median 95th-percentile frame intervals during browsing were 16.8 and 16.8 ms. These are local browser measurements with the vault closed. The sort was slower in this comparison. Individual runs varied.

The desktop and mobile captures above show the actual running journal using isolated records and original AFTERCREDITS illustrations. Existing regression coverage exercises catalog search, title saving, stage motion and focus restoration. Production Worker access from this environment was denied before reaching Cloudflare. The catalog integration was exercised through the checked-in Worker with a controlled upstream. Physical-device Safari and Excel/Google Sheets rendering were outside this run. Chromium downloads were read back and the CSV was parsed with Python.

```sh
node --test tests/*.test.mjs
python3 tests/picker.browser.py
python3 tests/motion.browser.py http://localhost:3000/
python3 tests/finish.browser.py http://localhost:3000/
python3 tests/vault.browser.py http://localhost:3000/
```

[Proposed Phase 3B PostgreSQL architecture](phase-3b.md)
