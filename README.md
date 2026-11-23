# AFTERCREDITS

A personal cinema journal for the films you’ve watched. Add a title and a rating from 1 to 10 in half-point steps. Search the archive, sort it by date, title, or rating, and revisit your entries to edit or remove them. The overview shows the total film count and the average rating across your entire collection.

## Publish with GitHub Pages in Chrome

1. Merge the website branch into `main` on GitHub.
2. Open the repository’s **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose **main** and **/ (root)**, then click **Save**.
5. When the Pages deployment finishes, use **Visit site** in Pages settings. For the standard repository domain, the address is `https://lord80.github.io/aftercredits/`.

Subsequent changes merged into `main` deploy through the same configuration. All scripts, fonts, and images use repository-relative paths. The site needs no build step, credentials, environment variables, or external services.

## Preview in a development workspace

From the repository root, run:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Open port 8000 with your workspace’s HTTP preview. Use an HTTP server so the browser can load the ES modules.

## Your collection

The first visit opens an empty journal. Your browser stores titles, ratings, and dates added in LocalStorage under `aftercredits.collection.v1`. Reloading the page or reopening the site in the same browser profile restores your films. Other tabs on the same origin receive updates automatically.

Each browser profile and site origin has its own storage. Private browsing may discard the archive when the session ends. Clearing site data removes it. If storage is blocked or full, a notice appears and the current tab keeps working in memory. When reading damaged storage, the app retains valid records and explains any recovery in the interface.

Title comparisons normalize Unicode, case, and repeated whitespace. Editing a movie preserves its original date. Delete requires confirmation. Native dialogs, labeled controls, visible focus, keyboard-operable ratings, and reduced-motion support are included.

## Source

- `index.html` contains the semantic page and native dialogs.
- `css/site.css` defines the editorial layout, responsive styles, typography, and micro-interactions.
- `js/collection.js` handles validation, persistence, search, and sorting.
- `js/views.js` builds movie rows and empty states.
- `js/app.js` connects input, forms, and collection updates.
- `js/motion.js` handles entrances, list transitions, dialogs, and statistics.
- `assets/` holds the original projector and celluloid illustrations, self-hosted fonts and their licenses, the reel favicon, and GSAP 3.15.1.

The typefaces are Instrument Serif, DM Sans, and IBM Plex Mono. GSAP is distributed under the [GSAP Standard License](https://gsap.com/standard-license/).
