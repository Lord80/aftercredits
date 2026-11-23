# AFTERCREDITS

A personal watch journal for movies and TV series. The static frontend runs on GitHub Pages. A small Cloudflare Worker handles optional TMDB catalog requests. Collection data stays in the browser.

## What works

| Capability | Availability |
| --- | --- |
| Separate Movies and TV Series collections, manual entry, half-point ratings, editing, confirmed deletion, search, four sort orders, totals and average rating | Available on first visit |
| Migration from the original film journal, persistent personal ratings, cached title details, cross-tab updates | Available without an API connection |
| Live catalog search, exact-title selection, official posters, and richer detail views | Connect the included Worker to TMDB as described below |
| Filtering by genre, year, language, and rating | Planned. The data model already retains the relevant fields. |

Choose **Movies** or **TV Series**, then **Add a title**. With the catalog connected, search by title, choose the correct poster and year, set your rating, and save. Anime films and series use the same two TMDB catalogs and can be searched by their original or translated names. **Enter manually** also works without TMDB. Open a saved card for its description, genres, release or first-air date, language, backdrop, and personal rating when available. The collection totals cover both sections.

## Publish the frontend in Chrome

1. Merge the website branch into `main`.
2. In the GitHub repository, open **Settings → Pages**, choose **Deploy from a branch**, and select **main → / (root)**.
3. Save and wait for the Pages deployment. Open **Visit site** from the Pages settings. The standard repository address is `https://lord80.github.io/aftercredits/`.

No frontend build or dependency installation is needed. For a development preview, run `python3 -m http.server 8000 --bind 0.0.0.0` from the repository root and open port 8000. Use the same origin and browser profile as your earlier journal to migrate it.

## Connect live TMDB search from a browser

1. Sign in to TMDB and register for API access in **Account Settings → API**. Copy your **API Read Access Token** for Bearer authentication. Review the API terms for your intended use. [TMDB API settings](https://www.themoviedb.org/settings/api)
2. In the Cloudflare dashboard, open **Workers & Pages**, create a Worker such as `aftercredits-catalog`, and deploy the starter. Open its code editor, replace the starter module with the entire contents of [worker/index.mjs](worker/index.mjs), and deploy the update. It uses the Worker runtime’s built-in Web APIs.
3. In the Worker’s **Settings → Variables and Secrets**, add **TMDB_READ_TOKEN** as a **Secret** with the TMDB read token. Add **ALLOWED_ORIGINS** as a text variable containing the frontend origin, e.g. `https://lord80.github.io`. Use a comma-separated list for additional origins. Include the scheme and any port. Omit repository paths and trailing slashes. Save and deploy the bindings. For a CLI deployment, the same Worker entry point and production origin are declared in [worker/wrangler.toml](worker/wrangler.toml).
4. Copy the deployed Worker’s public HTTPS **origin**. In GitHub, edit [js/config.js](js/config.js) and set `catalogOrigin` to that origin. For example, if your Worker address ends in `.workers.dev`, paste that complete HTTPS origin between the quotes. This field contains only a public address. The TMDB credential belongs exclusively in the Worker Secret.
5. Commit the public URL through your usual review flow. After Pages redeploys, open **Add a title → Search TMDB**. Verify a known movie and a TV series, confirm the year and poster, save one, and reload. The Worker’s bare URL expects a catalog route and an allowed browser origin.

The Worker accepts GET requests to `/search?type=movie&q=…` and `/details?type=tv&id=…` for the two supported media types. It constructs requests to fixed TMDB endpoints, validates input, applies a timeout, and returns selected metadata fields. It sends the Bearer token only to TMDB. Official images load from `image.tmdb.org`. The origin allowlist controls browser access. A public endpoint still consumes the owner’s TMDB quota, and requests can be throttled. The UI reports rate limits and supports retry or manual entry.

## Data, migration, and offline behavior

The current LocalStorage key is `aftercredits.collection.v2`. Its envelope contains `version: 2` and an `entries` array.

| Entry field | Purpose |
| --- | --- |
| `id` | Stable local identity for edits and deletes |
| `mediaType`, `tmdbId` | Movie or TV identity. The TMDB ID is null for manual and legacy entries. |
| `title`, `rating`, `added` | Personal display title, half-point rating, and original timestamp |
| `metadata` | A snapshot of the catalog title, original title, release or first-air date, genre IDs and available names, original language, overview, and poster/backdrop paths. Manual entries have null metadata. |

On first use with an existing v1 archive, the app writes a v2 copy. Original IDs, titles, timestamps, and ratings carry over into Movies. The original v1 value remains available as a backup. Subsequent visits use v2, including after you delete the last entry. If the stored data is damaged or uses an unsupported version, the app protects the stored bytes and lets you work with readable entries in memory for the current session.

The combination of media type and TMDB ID identifies a catalog entry. Remakes can share a title, and a film and a series can share a numeric ID. Manual entries use normalized, case-insensitive title comparison within their section. Editing the personal display title preserves the original metadata snapshot and added date.

Browsing, searching, editing, rating, and deleting saved entries work when TMDB is offline. If the details request fails after a successful catalog search, you can save the returned search record. Artwork falls back to a media-type illustration when the image is missing or unreachable. The app stores artwork paths, so viewing uncached images requires a connection. Browser profiles and origins have separate journals. Clearing site data removes the archive. Blocked or full storage switches the current tab to memory with a visible notice.

## Implementation and verification

- `js/collection.js` owns versioning, migration, validation, identity, and sorting.
- `js/catalog.js` calls the proxy and builds allowlisted image URLs. `js/picker.js` manages debouncing, cancellation, selection, and partial detail recovery.
- `js/app.js`, `js/views.js`, and `js/motion.js` connect the UI, poster cards, dialogs, and reduced-motion-aware transitions.
- `worker/index.mjs` implements the proxy and maps TMDB’s movie and TV fields into a common shape.
- Run `node --test tests/*.test.mjs` with Node 22.7 or newer for the storage and Worker contract tests. Test fixtures are isolated from the application and require no credential.

Browser validation covered migration, CRUD in both sections, reload and full browser restart, cross-tab updates, failed artwork, unavailable storage, keyboard dialogs, and layouts from 320 to 1440 pixels. The search and details flow was tested through the Worker with an isolated upstream test fixture. Wrangler packaged the Worker successfully. Live TMDB verification requires the deployment and secret described above.

The rain-washed morning railway and spring ticket illustration are original artwork created for AFTERCREDITS. The site self-hosts Instrument Serif, DM Sans, IBM Plex Mono, and GSAP. Font licenses are in `assets/fonts`. [GSAP license](https://gsap.com/standard-license/)

This product uses the TMDB API but is not endorsed or certified by TMDB. Catalog artwork and metadata are supplied by TMDB and the respective rights holders. The interface includes the TMDB mark and attribution in its footer. [TMDB](https://www.themoviedb.org/)
