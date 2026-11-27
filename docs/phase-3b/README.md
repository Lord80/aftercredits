# Private cloud archives

Phase 3B introduced the storage and synchronization architecture described below. Phase 4A.1 moved sign-in into the main interface and made guest import optional after sign-in. Use the current guide for account onboarding, email and rollout settings. [Current account guide](../phase-4a-1/)

AFTERCREDITS opens the guest journal immediately. Connecting a private Supabase account adds a separate archive that can travel between devices. The Account panel lives in **Data Vault** in the screening room footer. The repository ships with cloud access switched off.

## Deploy from a browser

1. Create a Supabase project for this journal. Select a region and keep the database password in your password manager. The migration targets PostgreSQL 16 or later with UTF-8 and ICU. The integration tests use PostgreSQL 17.
2. In **Authentication → Sign In / Providers**, enable **Email** and turn off **Allow new users to sign up**. Leave anonymous sign-ins disabled. In **Authentication → Users → Add user → Create new user**, enter your email and a strong password and select **Auto Confirm User**. Use the same procedure for each person who should have a separate archive. The frontend only offers sign-in.
3. In **Authentication → URL Configuration**, set the **Site URL** to the exact HTTPS Pages address, including the repository path and trailing slash. For this repository it is `https://lord80.github.io/aftercredits/`. If you add a redirect URL for this deployment, use that same address. The app accepts recovery codes typed into the Account panel.
4. In **Authentication → Email Templates → Reset password**, use a subject such as “Your AFTERCREDITS recovery code” and save the template below. In **Authentication → SMTP Settings**, configure your mail provider when delivery beyond the project's built-in email limits is required. Supabase’s built-in sender may only deliver to your project's authorized team addresses. Keep the SMTP credentials in Supabase. Retain refresh-token rotation in the session settings. To use multiple devices together, keep single-session enforcement off.

   ```html
   <p>Enter this code in AFTERCREDITS → Data Vault → Account to reset your password.</p>
   <p><strong>{{ .Token }}</strong></p>
   <p>If you did not request this change, you can ignore this email.</p>
   ```

5. Open the migration on GitHub, select **Raw**, and copy the complete SQL. In the Supabase **SQL Editor → New query**, paste and run it as the project migration owner. Its transaction creates the private tables, constraints, policies and two public RPCs. You can rerun the same migration with existing data. Keep the Data API enabled with `public` exposed. Keep `aftercredits_private` outside the exposed schemas. The SQL files under `tests/` belong only in disposable test databases. [Database migration](../../supabase/migrations/001_private_archive.sql)
6. In the project's **Connect** dialog or **Settings → API Keys**, copy the **Project URL** and the **Publishable key** beginning with `sb_publishable_`. In the GitHub web editor, put these two public values in the quoted strings in the config file. Use the standard `https://<project-ref>.supabase.co` project URL. Database passwords, JWT signing secrets, `sb_secret_` and service-role keys belong outside the frontend. [Public configuration](../../js/cloud-config.js)
7. Commit the configuration through your repository's review workflow. Under **GitHub → Settings → Pages**, deploy from **main / (root)**. After deployment, open your usual journal URL and choose **Data Vault → Account**. With both values configured, the sign-in form appears. If an older installed copy is still open after deployment, close the site's tabs and reopen the Pages URL online.

## First connection and device verification

1. On device A, download an independent JSON from **Data Vault → Export**. Sign in under **Account** and choose **Compare collections**. The preview shows the cloud count, new guest titles, duplicates and conflicts. The guest collection and its recovery history stay under their original keys.
2. To bring guest titles into the account, select **Copy new guest titles into this account**. Exact duplicates keep the cloud copy. For a conflicting title, expand its comparison and choose the guest version only if you want its rating, dates and metadata. Ambiguous overlapping identities stay in the guest journal for manual review. Guest records with an already-deleted cloud ID stay local.
3. Choose **Download guest recovery JSON**, verify the download, then **Confirm connection**. Leaving the copy box unchecked opens the existing cloud archive. A changed source or cloud revision invalidates the preview. A saved account copy can resume after interruption. Returning to a connected account on the same device reuses its pending edits.
4. On device B, use a separate browser profile, sign in to the same account and review the connection. Leave the copy box unchecked to open device A's archive. Add a disposable title on A. Choose **Sync now** on both devices and compare its rating and original date. Edit it on B and repeat in the other direction. Deleting the disposable title also synchronizes.
5. Once the Account panel says **Offline opening is ready**, disconnect A and reopen the site at the same URL. Change a rating and confirm the local save. Change the same title differently on B, then reconnect A and choose **Review sync conflicts**. Inspect both versions, select the version to keep for each group and confirm. The next successful sync brings B up to date.
6. **Forgot password?** sends an email code. Enter the code, email and new password in the same recovery form, then sign in. **Sign out** returns the current browser to its guest journal. Pending edits and recovery copies stay associated with that account for its next sign-in.

## What the status means

| Account status | Meaning |
| --- | --- |
| Local only | The guest journal is active. Using the screening room requires no Supabase account. |
| Pending changes | A working copy is saved on the device and a cloud update is pending. |
| Syncing | This browser is checking or applying changes. The screening room stays usable. |
| Synced | The last exchange completed and this device's queue was empty at that point. The panel displays the time. |
| Offline | The browser reports no network. Local edits are queued. |
| Conflict | An incoming version overlaps a local change. Review is required before upload resumes. |
| Error | A request or local write failed. The message gives context. Use **Sync now** after reconnecting or correcting the issue. |

Saving in the active tab, reconnecting, returning to the tab and manual sync trigger checks. Transient failures retry up to five times with increasing delays. Other devices pick up changes on their next check. JSON/CSV export, backup reminders, merge, restore and recovery remain available. A restore or recovery that removes titles queues the corresponding deletions.

## Data integrity and access boundaries

- **On disk.** Guest entries remain under `aftercredits.collection.v2`. Account state is namespaced by project hostname and verified user UUID. One atomic LocalStorage write holds the last server snapshot, pending differences, local ordering, in-flight request, cursor and any incoming conflict. Backup receipts and recovery history have separate per-account keys. Collection writes and sync acknowledgements share a Web Lock. Network waits use a separate lock so offline edits can continue.
- **In PostgreSQL.** The database stores one head per owner, an entry or deletion marker for each stable ID and a receipt for each committed operation. PostgreSQL assigns revisions and modification/deletion timestamps. An entry's JSONB payload retains the original date string, personal rating, complete metadata and supported extension fields. JSON object key order and whitespace may change. Indexes enforce media type plus TMDB ID or the normalized manual title. Server normalization applies NFKC, whitespace folding and root-locale lowercase.
- **Authorization.** GoTrue authenticates the account. PostgREST verifies the session token. Each database function derives the owner from `auth.uid()`. Every owner-scoped table has RLS, client roles have no direct table writes, and the two authenticated RPCs run with a fixed search path and qualified references. Only the migration owner or another trusted project administrator should be able to modify these functions. Public sign-up is an operator setting.
- **Writes and retries.** The client saves an immutable operation ID, expected head and exact batch before transmission. The server locks the owner's head and checks the receipt and request fingerprint before checking that revision. A lost response can therefore be replayed even after another device has committed. Acknowledgement rebases any later local edits. Import, restore and recovery use the same atomic batch path. A confirmed database rejection leaves local edits available for repair.
- **Reads and conflicts.** Each pull fetches up to 100 current rows, including tombstones, after a cursor. Subsequent pages pin the observed head. A changed head restarts the pull. An interrupted read leaves the durable cursor untouched. Three-way comparison uses the stable ID and title identity from the base, working and incoming copies. Independent changes to separate titles combine automatically. Divergent edits to one title, concurrent creation with overlapping identities, and edit-versus-delete require a choice. Each comparison shows the earlier, device and cloud versions, including metadata. The chosen version is checked against the server revision again.
- **Differences from the Phase 3A proposal.** A validated JSONB record and expression indexes preserve the original entry and extension fields without maintaining duplicate representations. Writes compare an owner-wide revision and commit a whole batch. Rows still carry individual revisions for paginated reads. A concurrent unrelated update causes a rebase. Tombstones and operation receipts remain for the lifetime of the archive so long-offline devices can reconnect safely. [Original proposal](../phase-3a/phase-3b.md)

## Privacy, offline use and limits

Account separation protects normal app use. LocalStorage is readable by scripts on the same origin and by someone with access to the browser profile. Use a trusted browser profile and a trusted Pages origin. Other Pages projects under the same hostname share that origin. A dedicated domain can provide a separate origin. Supabase authentication and RLS protect remote access. They do not encrypt the device cache or hide records from the database administrator.

Session material persists in a separate local key. Refresh rotation is serialized across tabs. Sign-out clears the local session immediately and attempts server revocation for that session. Offline sign-out cannot confirm remote revocation. Issued access tokens can remain valid until expiry. Clearing site data removes pending work, local backups and the cached shell. Export an independent JSON before clearing storage or changing projects. Passwords, session tokens, sync receipts and cached images are excluded from the archive download.

A scoped service worker installs the public app shell after account connection. It caches a fixed list of first-party assets and the scenery used by the current viewport. Auth requests, RPC responses, TMDB traffic and journal contents bypass the shell cache. An initial online visit, HTTPS, service-worker support and enough device storage are needed for offline reopening. Open tabs can still edit during an outage. A fresh device needs connectivity to sign in and retrieve its first copy. New imagery and TMDB searches require their respective services. When publishing changes to cached shell files, bump the release identifier in the worker. [Offline shell](../../offline.js)

Large archives are limited by the browser's storage quota, which also covers pending edits and recovery history. Failed durable writes leave the previous collection in place and report the failure. The server accepts up to 50,000 active entries per account. JSONB excludes NUL and unpaired surrogate characters. The cloud path reports these or reserved ownership/revision fields before queueing an incompatible record. The guest copy remains available for export. Cloud sync propagates deliberate restores and deletions to other devices. Keep independent JSON backups. [Backup format and recovery guide](../phase-3a/)

## Verification

The cloud browser suite creates disposable PostgreSQL, Supabase Auth, PostgREST and Mailpit containers, provisions two temporary users, and opens isolated Chromium profiles. It serves the frontend under a repository subpath. A test gateway forwards requests to the real services and can interrupt a response after the database commits. All fixture credentials are generated at run time.

- Run `node --test tests/*.test.mjs` for collection, Worker, Vault and cloud-state regressions.
- With Docker, Python Playwright and Chromium available, run `python3 tests/cloud.browser.py`. To write captures, pass an output directory. Set `AXE_JS` to a local axe-core script to include the mobile account-dialog accessibility check. The suite applies the migration twice and runs the SQL security assertions inside a rolled-back transaction.
- For guest-mode regression checks, run the picker suite and the motion, finish and vault suites against a local preview as described in the project README. These developer tools are optional for deploying from the dashboards.

### Recorded results

| Check | Observed result |
| --- | --- |
| Node regressions | All 26 passed. Coverage includes Unicode/title identity, exact rating and date retention, CSV, recovery, malformed storage, Worker behavior, in-flight edits and deletion conflicts. |
| Guest Chromium regressions | Picker, motion, finish and Vault suites all passed. The unconfigured Account tab opened without loading the auth module or contacting Supabase. |
| SQL permissions and integrity | Migration applied twice. Anonymous RPCs and direct authenticated writes were denied. An account could not see another owner’s rows, including under a temporary grant used to exercise RLS. Invalid batches rolled back. Replaying an accepted operation returned its existing receipt. |
| Real service integration | Two disposable users exercised password sign-in, SMTP recovery codes, password change, refresh rotation, offline sign-out, revoked refresh tokens across tabs, account switching and queue resumption. |
| Offline and concurrent use | Independent Chromium profiles synchronized movies, series, exact timestamps, optional metadata and changes from Vault merge, restore and recovery. Tests covered offline reload, lost acknowledgements, quota failures and explicit rating conflict resolution. A stale migration preview was rejected, and repeating migration from another device preserved both records without another upload. |
| Pagination | A 205-title archive required three pages. Interrupting the second page left the local cursor at zero. Concurrent writers at the same revision produced one commit and one stale response. A fresh pull converged on all 205 titles. |
| Interface | Captured the actual 1440 × 960 desktop and 390 × 844 phone layouts. The connected phone dialog had no page overflow or axe-core WCAG A/AA violations in the automated check. |

The integration run used self-hosted Supabase Auth 2.177.0, PostgREST 12.2.3 and PostgreSQL 17. A managed Supabase project, public Pages release, production SMTP delivery and physical mobile devices were outside this isolated test. The network proxy returned HTTP 403 on the live TMDB Worker check. The existing catalog and Worker regression suites passed with controlled responses.

[Desktop account](account-desktop.webp) · [Phone account](account-mobile.webp) · [Migration preview](migration-desktop.webp) · [Rating conflict](conflict-desktop.webp)
