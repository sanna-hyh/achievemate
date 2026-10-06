# AchieveMate architecture audit

Audience: the product owner. Technical names are kept, with a short plain-language gloss the first time they matter.

Scope: this is a read of the repository as of `main` (12 commits, latest `77bc24f` on 2026-10-05) plus a check of the live site `https://achievemate.vercel.app`. A second pass pressure-tests the UX teammate’s risks and open questions against the code. No product features were changed.

---

## 1. Executive summary

**What the app is.** AchieveMate is a personal CV workshop for job seekers, built as Sanna’s portfolio and as a tool she can use. The locked direction is Studio-first: the CV canvas is home, sections are added and edited on that page, a star or a drag saves a block into the Library, Design controls density, and Export downloads a PDF. The logbook is a side journal behind `ENABLE_LOGBOOK`. The live site is a static website: the browser downloads HTML, CSS, and JavaScript and does the work itself. There is no application server in this repository.

**How that direction shows up in code.** Home is the canvas (`workspace-tabs.js`, `#/`). Export is not behind a login (`cv-preview.js` never calls `requireAuth`). Login is not optional-on today; it is absent, because the account UI was removed. The proposed typed blocks (Experience, Education, Skills, Summary, Free text) and the density presets 0.5 / 0.65 / 0.75 / 1.0 are not in the code. Section 11 is the pressure test.

**Overall maturity.** The editing experience is ahead of the platform around it. The CV canvas, library, undo, auto-fit, and PDF export are a real product. Accounts and cloud save were designed and partly built, then deliberately unplugged on 2026-10-05 so the running app keeps data only in the browser. Treat this as a strong single-browser prototype, not yet a multi-device product.

**Top 3 strengths**

- One shared memory model. `app.js` holds a single `state` object, and almost every edit goes through `saveState()`. The other files talk to it through `window.AchieveMateApp`. That is easy to follow.
- The CV editor is carefully built. Drag-and-drop, a 60-step undo stack, zoom, “fit on one page,” and a PDF exporter live in dedicated files. User-typed formatting is passed through a small HTML cleaner before it is shown again.
- The database design, sitting unused, is disciplined. SQL migrations turn on row-level security (database rules that limit each person to their own rows), cap file sizes, and keep proof files out of the database.

**Top 3 risks**

- A CV exists only in that browser’s `localStorage` (a small private notepad the site can use). Clearing site data, switching computers, or attaching one large proof file can drop the work. `saveState()` does not catch a “storage full” error.
- Cloud code is still in the repo and still publicly downloadable, and it no longer matches the product. The Library (`cvLibrary`) is not in the database schema. Plugging the old script tags back in would not safely restore sync.
- The whole repository is the website. Vercel serves internal docs, SQL, the Supabase public key, and a 16 MB image the app never displays. There is no test suite and no continuous integration.
- The number on the Design slider, the type on the page, and the type in the PDF are three different values once Auto-fit runs. Auto-fit can shrink body text far below a 10pt applicant-tracking floor, and the export file name ignores the name typed on the page. Details are in section 11.

---

## 2. Tech stack and runtime

| Layer | What actually runs | Where it lives |
|---|---|---|
| Page | One HTML file, hand-written CSS, classic JavaScript (no React, no bundler, no `package.json`) | `index.html`, `styles.css`, `app.js`, `cv-*.js` |
| PDF | jsPDF 2.5.1 from a public CDN, plus a Traditional Chinese font fetched from jsDelivr when the text needs it | `index.html` script tag; `cv-pdf.js` |
| Fonts | Google Fonts (Fraunces, Inter, JetBrains Mono) | `index.html` |
| Data, today | Browser `localStorage` | `app.js` keys `achievemate-data`, `achievemate_cv_settings`, `achievemate_custom_defaults`; view key in `workspace-tabs.js` |
| Data, designed but not loaded | Supabase (hosted Postgres database, email/password accounts, private file storage) via `@supabase/supabase-js` from a CDN | `supabase-config.js`, `supabase-client.js`, `auth.js`, `sync.js`, `guest-migration.js`, `supabase/migrations/` |
| Hosting | Vercel static hosting. `vercel.json` sets an empty build and publishes the repository root | `vercel.json` |
| Feature switch | `window.ENABLE_LOGBOOK = true` | `features.js` |

There is no Node server, no API framework, and no background jobs. The live homepage HTML (18,210 bytes, served by Vercel with HTTPS) loads the same script list as `index.html`: `features.js`, jsPDF, `app.js`, `cv-history.js`, `drag-preview.js`, `cv-builder.js`, `cv-pdf.js`, `cv-preview.js`, `cv-layout-panel.js`, `sidebar.js`, `workspace-tabs.js`. It does not load the Supabase files.

A React helper, `hooks/useAuth.js`, imports React. Nothing in the live page uses it, and there is no React install in the repo. The comment at the top of that file (“the live app uses auth.js”) is out of date.

---

## 3. High-level architecture

The running app is one page with two views. A hash in the URL picks the view (`workspace-tabs.js`):

- `#/` or a bare visit opens the CV canvas (called Studio in the code, “CV maker” in the menu).
- `#logbook` opens the logbook. Older links such as `#profile` and `#achievements` are rewritten to `#logbook` while the feature flag is on.

```
Browser
  index.html
    ├─ features.js          feature flag
    ├─ app.js               state + logbook + save to localStorage
    ├─ cv-history.js        undo / redo (memory only)
    ├─ cv-builder.js        left rail: blocks + Library
    ├─ cv-preview.js        the A4 page, editing, export modal, export history
    ├─ cv-pdf.js            turns the page model into a PDF
    ├─ cv-layout-panel.js   Design drawer (fonts, spacing, colors)
    ├─ sidebar.js           ☰ menu
    ├─ workspace-tabs.js    which view is showing + “Saving…/Saved” chip
    └─ drag-preview.js      picture that follows the cursor while dragging

Not loaded by the page (present on disk and on the public URL):
    supabase-config.js, supabase-client.js, auth.js, sync.js, guest-migration.js
```

**How the files cooperate.** Each UI file is an immediately-run function that expects `window.AchieveMateApp` to exist already. `index.html` therefore loads `app.js` before the CV files. They call back through globals such as `window.AchieveMateCvPreview`, `window.AchieveMateCvBuilder`, `window.AchieveMateCvHistory`, `window.AchieveMateViews`, and `window.AchieveMateToast`. There is no import graph for the live app. Order in `index.html` is the architecture.

**Request / data flow for a normal edit**

1. The person types on the CV, drags a block, or edits a logbook card.
2. The responsible file mutates `window.AchieveMateApp.state`.
3. It calls `saveState()`, which writes the whole state object to `localStorage` under `achievemate-data`.
4. `workspace-tabs.js` flips the chip to “Saving…” and back to “Saved”. That chip means “the browser notepad write finished,” not “a server accepted it.”
5. No network call is made.

**Boot flow**

1. Vercel returns the static files.
2. `app.js` reads `localStorage`, fills `state`, paints the logbook, and exposes `window.AchieveMateApp`.
3. The CV scripts attach their listeners and draw the page.
4. `finishLogbookLoading()` runs immediately at the bottom of `app.js`. The cloud boot path in `sync.js` (which was meant to delay that until the server answered) never runs.

---

## 4. Domain model and data layer

### What the product stores

The in-memory model is the object at the top of `app.js`:

| Piece | Meaning | Saved today |
|---|---|---|
| `personalInfo` | Name, phone, email shown on the CV | Inside `achievemate-data` |
| `achievements` | Logbook entries: title, free-text date, category, starred flag, description, and an optional proof file | Same blob. The file itself is stored as `fileData`, a base64 text copy of the bytes |
| `cvLibrary` | Reusable CV snippets (title, subtitle, date, location, description) | Same blob |
| `cvLayout` | Ordered blocks on the page: `heading` or `cv-item` | Same blob |
| `cvPreviewEdits` | Text typed directly on the page, including limited bold/italic/underline HTML | Same blob |
| `cvSettings` | Font, sizes, colors, spacing, margins, auto-fit | Also copied to `achievemate_cv_settings` |
| Custom defaults | “Save as default” in the Design drawer | `achievemate_custom_defaults` |
| `exportHistory` | Up to 20 past CV snapshots so a person can restore one | Inside `achievemate-data` |

IDs such as `ach-…` and `lib-…` are created in the browser (`createId` in `app.js`). Dates on achievements are labels (“May 2025”), not real calendar values, and are sorted with a hand-written month list.

**Two content models now sit side by side.** The logbook is a journal of achievements. The CV is built from Library items and blocks on the page, edited in place. On first load, if an older save has achievements and no library, `loadState()` copies those achievements into library entries. After that, starring or dragging on the CV updates the library (`cv-builder.js`, `cv-preview.js`), not automatically the logbook. That split is the main product-model change since the database spec was written.

### Database (designed, not used by the live page)

Four SQL files in `supabase/migrations/` describe a Postgres schema:

- `0001_schema.sql` — `profiles` (one row per account), `achievements` (one row per logbook entry, with a `client_id` so old `ach-…` ids survive), `cv_documents` (one JSON row per account for layout, preview edits, settings, and defaults), `export_history` (snapshots, trimmed to 20 by a database trigger). A signup trigger creates the empty profile and CV row. Text length and JSON size are capped in the database.
- `0002_rls_storage.sql` — row-level security forced on every table, policies limited to the signed-in owner, and a private Storage bucket `proofs` (5 MB, PDF/PNG/JPEG/WebP/Word only). File paths must start with that user’s id.
- `0003_achievement_category.sql` — category constrained to education, leadership, competition, internship, volunteering, others.
- `0004_achievement_starred.sql` — `starred` boolean.

This repo does not show whether those files have been applied in the Supabase dashboard. The SQL is the source of truth only if someone ran it there.

### Where the database design and the app have drifted

`BACKEND_SPEC.md` still describes the older shape: CV blocks point at achievements, and `fileData` must move to Storage. The running app has since added:

- `cvLibrary`, which has no column. `sync.js` writes `layout`, `preview_edits`, `settings`, and `custom_defaults` only. A second device would not receive the Library.
- CV blocks of type `cv-item` with their own fields, rather than `type: "achievement"` plus an `achievementId` (the example in `BACKEND_SPEC.md`).
- `previewHtml` inside export snapshots (`buildHistorySnapshot` in `cv-preview.js`). Restore does not read that field. It only adds weight. The database cap on a snapshot is 128 KB, so a fat HTML copy could make a future cloud insert fail.

`sync.js` does know about `category`, `starred`, and `proofPath`. Those later columns were kept in step. The Library was not, because cloud sync was removed in the same period the Library shipped (`012d9dd`, `c5c4be7`).

---

## 5. API / server boundaries

**There is no custom API.** The live app does not call a backend.

The unplugged cloud layer would talk to Supabase’s auto-generated REST API (PostgREST) and Storage API from the browser, using the public anon key. `sync.js` is that client:

| Action | Call |
|---|---|
| Boot | Parallel reads of `profiles`, `achievements` (ordered by `position`), `cv_documents`, and the latest 20 `export_history` rows |
| After edits | Debounced by 1.2 seconds, then update profile, upsert/delete achievements, update the CV document |
| Proof file | Upload to `proofs` at `{userId}/{achievementId}/{timestamp}_{name}`, open later with a signed URL that lasts 120 seconds |
| Export history | Insert and delete rows. No update policy exists in SQL, so history rows are append-only |

`guest-migration.js` is a one-time copy from the browser notepad into those same tables, including turning old base64 proofs into Storage uploads.

**The hook the spec requires is missing.** `BACKEND_SPEC.md` says `saveState()` should call `window.AchieveMateSync.queuePush()`. `app.js` `saveState()` only writes `localStorage`. It also ignores the `{ skipSync: true }` flag that `sync.js` and `guest-migration.js` pass. Even if the script tags were restored, edits would not sync until `app.js` is changed, and a naive change that always calls `queuePush()` could loop, because loading server data also calls `saveState()`.

`pushToServer()` in `sync.js` returns immediately if a save is already in flight and does not schedule another attempt. A fast second edit during that window can be left only on the device until something else changes.

---

## 6. Auth, authorization, and security posture

### What the live site does

The running site has no sign-in. Commit `c5c4be7` (“Use localStorage-only Studio flow…”) removed the account panel, the log-out button, and these script tags from `index.html`:

- `supabase-config.js`
- `supabase-client.js`
- `guest-migration.js`
- `auth.js`
- `sync.js`

`auth.js` still knows how to open a sign-in / create-account dialog (`supabase.auth.signInWithPassword` / `signUp`), keep a session, and on log-out wipe app data and reload. The buttons it looks up (`saveAccountBtn`, `signOutBtn`, `sidebarAccountStatus`) are no longer in `index.html`, so that file cannot attach to the current page.

Sessions, if the module were loaded, would be handled by the Supabase client: PKCE (a safer login redirect style), persisted session, automatic token refresh. The app does not store passwords itself.

### Secrets

`supabase-config.js` commits the project URL and the **anon** key, and says the service-role secret must never be committed. The key’s payload is the public `anon` role, not `service_role`. That pattern is normal for Supabase **only when row-level security is on**. A search of the repo shows no service-role key.

Because `vercel.json` publishes the repository root, that file is on the public internet at `https://achievemate.vercel.app/supabase-config.js` (HTTP 200), together with `auth.js`, `sync.js`, `BACKEND_SPEC.md`, and `supabase/migrations/0001_schema.sql`. Anyone can see the project id. They can talk to that Supabase project with the anon key. What they can read or write depends entirely on policies in the hosted database, which this repo cannot prove are applied.

### Other security notes

- **Rich text.** `sanitizeRichText` in `cv-preview.js` keeps only `b`, `strong`, `i`, `em`, `u`, and `br`, and strips attributes. Logbook titles and descriptions go through `escapeHtml` in `app.js`. This is a reasonable cleaner for a personal editor. It is not a vetted sanitizer library, and it only runs in the browser.
- **Proof files.** The live path stores the file inside the JSON notepad and opens it with `window.open(achievement.fileData)`. The 5 MB and MIME checks in `app.js` are courtesy checks in the browser. Nothing server-side sees them while sync is off.
- **`localStorage` is not private from other scripts on this origin.** Any script the page loads (including the jsPDF CDN script) runs with access to that notepad. There is no Content-Security-Policy header on the live response. Vercel does send HSTS (browsers must use HTTPS). `access-control-allow-origin: *` on the static HTML is normal for a file host and does not, by itself, leak the notepad.
- **Clickjacking and XSS headers** such as `X-Frame-Options` were not present on the homepage response. Low practical impact for a personal editor, worth adding when headers are next touched.
- **Supply chain.** The page trusts cdnjs for jsPDF, Google for fonts, and (only if sync is reattached) jsDelivr for Supabase. `cv-pdf.js` also downloads a font from jsDelivr at export time when the CV contains characters outside basic Latin, including Chinese.

### Dormant footguns

- `guest-migration.js` exposes `verifyDataMigration()` on `window.AchieveMateMigration`. If that file is loaded while someone is signed in, calling it writes a dummy achievement into their account.
- Sign-in migration is implemented in more than one place (`auth.js`, `sync.js` `handleBoot`, and `attachAuthMigrationListener`). Turning all of them on together can run the copy twice.
- `hooks/useAuth.js` would also migrate on sign-in. It is unused.

---

## 7. Frontend architecture

**Routing.** Hash routing only, in `workspace-tabs.js`. Two views, both already in the HTML. The menu in `sidebar.js` calls `AchieveMateViews.setActiveView`. There is no router library and no per-view code splitting (the CV code downloads even if you only open the logbook).

**State.** One mutable object in `app.js`. UI code reads and writes it directly. Undo (`cv-history.js`) keeps up to 60 copies of layout, library, preview edits, and personal info in memory. Undo does not cover logbook achievements or Design settings. Refreshing the page reloads from `localStorage` and starts a new undo stack.

**Components.** There are no components in the framework sense. Each file owns a region of the page:

| File | Lines | Job |
|---|---|---|
| `cv-preview.js` | 3,731 | The document, inline editing, drag-and-drop on the page, zoom, auto-fit, export modal, export history |
| `styles.css` | 4,686 | All visual design |
| `app.js` | 1,946 | State, logbook cards (cover-flow and timeline), proof files, toasts |
| `cv-pdf.js` | 761 | PDF layout, including a Unicode font path |
| `cv-builder.js` | 633 | Palette, Library, “remove all items” |
| `workspace-tabs.js` | 323 | Views and the Saved chip |
| `cv-layout-panel.js` | 257 | Design drawer |
| `drag-preview.js` | 373 | Drag ghost |
| `cv-history.js` | 222 | Undo / redo |
| `sidebar.js` | 113 | Menu drawer |

**UX-critical flows**

- **Compose a CV.** Drag “Section heading” or “CV item” from the rail onto the white page, or star/drag a Library item. Double-click text to edit. Enter moves between fields. Design opens a drawer of type and spacing controls. Auto-fit shrinks type and gaps until the preview fits one A4 page, and the PDF uses that fit (`cv-preview.js` `applySmartLayout`, `cv-pdf.js`).
- **Export.** Export opens a small dialog for the file name, then builds the PDF in the browser. Empty placeholder lines are left out of the published PDF. History of the last 20 exports sits in the Design drawer; restore puts layout, edits, and settings back.
- **Logbook.** Add / edit / star / categorize / delete an achievement. Delete and “remove all CV items” ask for a second click (“Sure?”) instead of a browser alert. Proof chips open the stored data URL.
- **Identity.** Name and contact are edited on the CV page itself. `personalForm` is still referenced in `app.js`, and the sidebar still has a function for an identity summary, but those elements are gone from `index.html`. The functions no-op. That is leftover from the older “identity card on the logbook” layout described in `DESIGN_SYSTEM.md`.

**Cache busting.** Script and CSS URLs use hand-bumped query strings (`styles.css?v=111`, `cv-preview.js?v=65`). A forgotten bump ships an old file to people with a cached copy.

---

## 8. Quality and operability

| Practice | Status |
|---|---|
| Automated tests | None. No `package.json`, no test files |
| Continuous integration | No `.github` workflows |
| README | None. `BACKEND_SPEC.md` and `DESIGN_SYSTEM.md` are the docs, and both describe an older app in places (landing-page parallax, a profile form, sync already hooked into `saveState()`) |
| Environment variables | No `.env` usage. The public Supabase values are hard-coded. `.gitignore` correctly ignores `.env` and `.pem` files |
| Error handling | JSON parse failures are caught and logged. Toasts cover bad proof files and a missing PDF library. `saveState()` does not try/catch `localStorage.setItem`. There is no global error handler |
| Observability | No analytics, no error reporting service. Failures show up as `console.warn` and toasts |
| Deploy | Pushing the repo is the release. Vercel serves it with `max-age=0, must-revalidate`, so HTML updates quickly. There is no build step to fail a bad release |
| Live check | Homepage returns 200 from Vercel and matches this `index.html`. Unused files also return 200, including `designpage.png` (16,476,410 bytes) |

**Operability for the owner.** If the site is up, Vercel is up. If a person’s CV “disappears,” the usual cause will be a different browser, cleared data, or a full notepad — not a server outage. The paused-project messages in `supabase-client.js` (`describeSupabaseOutage`) only matter after sync is reconnected. Supabase’s free tier also pauses idle projects; that behavior is documented in `BACKEND_SPEC.md` and is currently irrelevant to the live site.

---

## 9. Maintainability and scalability

**What is in good shape for a student project**

- The folder is small and the names match the product: logbook, library, preview, PDF, design drawer.
- Persistence is funneled through a few functions (`saveState`, `saveCvSettings`, `saveCustomDefaults`).
- The database spec shows real restraint: one row for the hot CV document, debounced writes, size caps, private files, no extra backend services.
- A single feature flag (`features.js`) can hide the logbook without deleting it.

**What will hurt the next change**

- `cv-preview.js` is the product. At 3,731 lines it owns editing, drag-and-drop, zoom, layout math, history, and export. A change to bullet editing can break PDF export because both paths live in the same file and there are no tests around them.
- Globals plus load order replace modules. A script moved above `app.js` silently does nothing, because it exits when `window.AchieveMateApp` is missing (`cv-builder.js`, `cv-layout-panel.js`).
- Dead and live architecture are mixed. `auth.js`, `sync.js`, `guest-migration.js`, `hooks/useAuth.js`, and `BACKEND_SPEC.md` look authoritative. The page that ships does not use them, and `saveState()` does not match the spec. The next coding session can easily “finish” sync by re-adding script tags and lose the Library.
- Docs drift. `DESIGN_SYSTEM.md` still mentions `parallax.js`, a boat landing, and assets to delete. Several of those images are still in the repo and still deployed.
- Deploy weight. Images the page actually uses include `ocean_dark_background.png` (background), `logo.png`, `import_data_icon.png`, and `leadership.png` (logbook cover art). Also published, and not referenced by HTML/CSS/JS: `designpage.png` (16 MB), `sky.png`, `ocean.png`, `boat.png`, `clouds.png`, `mountain_left.png`, `mountain_right.png`, `avatar_icon.png`, `document_icon.png`. That costs bandwidth and makes the repo noisy.
- Scale ceiling, by design. This shape is right for one person and a short CV. It is the wrong shape for shared accounts, realtime collaboration, or many large proofs. `localStorage` is typically about 5 MB for the whole site. One 5 MB proof becomes roughly 6.7 MB of base64 text, so a single allowed attachment can exceed the notepad and throw out of `saveState()`, taking the rest of the save with it. Cloud Storage was the intended fix and is not connected.

**Scalability that does *not* need work yet.** Traffic, caching, and database indexing are not the bottleneck. The achievements index and the export-history trim trigger are enough for a free-tier, one-user-per-account product. Do not add a server, realtime, or a framework until cloud save is a product decision.

---

## 10. Prioritized recommendations

Effort hints: **small** means a focused change in a few files; **medium** means a careful multi-file change that should be tested by hand on two browsers; **large** means a restructuring. None of these are feature requests done inside this audit.

Process that matches how this product is shipping: one fix per pull request, check the Vercel preview, then merge. Keep each cloud-agent change narrow. Do not bundle a data-model migration with a star-icon tweak.

### P0 — data loss and a false sense that cloud save is ready

1. **Give the CV a way out of the browser.**  
   Why: the only copy is `localStorage`. A new laptop, a cleared cache, or a private window looks like an empty product.  
   What: a “Download backup” / “Restore backup” of the JSON state (without requiring Supabase). Show a clear sentence in the menu: “Saved on this browser only.”  
   Effort: small.

2. **Stop a large proof file from breaking the save.**  
   Why: `validateProofFile` allows 5 MB, then `readFileAsDataUrl` stores it inside the same JSON blob `saveState()` writes. `saveState()` does not catch quota errors, so the failure can abort the click handler after the on-screen edit.  
   What: catch `QuotaExceededError`, toast a plain explanation, and refuse the attachment instead of keeping a base64 copy that cannot be saved.  
   Effort: small.

3. **Keep guests first. Do not turn the old sync scripts back on until the data model is updated, and do not gate Export.**  
   Why: the product decision is optional login and an ungated PDF. The live page already matches that. `auth.js` still contains the copy “Sign in to export,” which would fight that decision if the file is loaded again. `cvLibrary` is not in `cv_documents`. `saveState()` does not call `queuePush()` and ignores `skipSync`. `pushToServer()` can drop a save that overlaps another. Re-adding the script tags from commit `c5c4be7` would look like progress and then drop or stale the Library.  
   What: leave Export on the canvas with no account check. If cloud save comes back, it should be an optional “save to account” merge (guest notepad → that user’s rows), with the Library included, and a real `skipSync` guard. Until that is a dedicated PR, move `auth.js`, `sync.js`, `guest-migration.js`, and `hooks/useAuth.js` to a clearly named `archive/` folder so the next change does not wire them by accident.  
   Effort: medium if you restore optional sync; small if you archive it.

4. **Confirm the hosted Supabase project, or pause it.**  
   Why: the anon key and project URL are public at `/supabase-config.js`. Safety depends on row-level security actually being applied in the dashboard. This repository cannot see that dashboard. An unused free project is also an idle signup and storage surface.  
   What: in the Supabase dashboard, confirm the four migrations are applied and RLS is forced, or pause the project until recommendation 3 is done on purpose.  
   Effort: small (dashboard only).

### P1 — confirmed UX risks, one pull request each

These are the pressure-test items that are real in the current code (section 11). Ship them as separate previews.

5. **Show the type size the PDF will use, and stop Auto-fit from going under a floor.**  
   Why: with Auto-fit on, `shrinkPdfModelToOnePage` may scale body type down to 8% (`minScale = 0.08` in `cv-pdf.js`). A 9pt body can become well under 1pt. The Design slider still says “auto” (`cv-layout-panel.js`). With Auto-fit off, the page clips at one A4 (`overflow: hidden`) while the PDF may add pages.  
   What: one PR that picks a floor (the UX note says about 10pt), shows that fitted size in the drawer, and makes the screen and the PDF follow the same page rule.  
   Effort: medium.

6. **Name the PDF from the name on the page.**  
   Why: `getDefaultExportBaseName()` reads `state.personalInfo.name`, and nothing in the app assigns that field anymore. The typed name lives in `cvPreviewEdits` under `personal.name`. The dialog also resets on every open, so it ignores `lastExportFileName`.  
   What: one PR. Default the file name from the canvas name.  
   Effort: small.

7. **Make a second star update the Library card, and make the outline visible.**  
   Why: `libraryEntryId` is saved (PR #5 did that). The star click still removes the card when it is already linked (`toggleLayoutItemInLibrary`), so the “update on restar” branch in `saveLibrarySnapshot` never runs from the button. The star is `opacity: 0` at rest, so a saved star vanishes when the pointer leaves, and the button’s own hover always draws the filled icon. Commit `77bc24f` landed after PR #5 and dropped the resting opacity.  
   What: one PR for star behavior (restar updates the linked card; dedupe stays). A separate PR only if the icon CSS needs a visual pass after the behavior is true.  
   Effort: small for the click path; small for the CSS.

8. **After adding a block, scroll it into view and focus its first field.**  
   Why: `insertLayoutItem` only flashes a CSS class (`flashSection`). The canvas is locked to 297mm with `overflow: hidden` whenever it has blocks, including when Auto-fit is off. A new block at the end can be clipped off the page.  
   Effort: small.

9. **Protect canvas delete the same way “Remove all” is protected.**  
   Why: “Remove all” and logbook delete ask for a second click. The section × button and a drag off the page delete immediately. Undo exists, but only in memory, only for the canvas/library/name, and it is discarded on refresh.  
   Effort: small.

### P1 — keep the next month of edits safe

10. **Add a few automatic checks around save/load and the script list.**  
   Why: there is no safety net. The highest-value checks are: `loadState()` round-trips library + layout + edits; `index.html` does not reference `supabase-client.js` while sync is meant to be off; `saveState()` still writes the library.  
   Effort: medium (a small test runner has to be introduced; the repo has none today).

11. **Publish only the website.**  
   Why: the live host serves SQL, the backend spec, auth code, and 16 MB of unused art. That widens what a stranger can read and wastes bandwidth.  
   What: put public files in a `public/` directory (or set Vercel to ignore docs, SQL, and unused images). Delete or stop deploying `designpage.png` and the other unreferenced images listed in section 9.  
   Effort: small.

12. **When you next touch the CV editor, split by job, not by a rewrite.**  
   Why: `cv-preview.js` is where regressions will come from.  
   What: peel export-history and the PDF model into the files that already own them (`cv-pdf.js` already exists) the next time those lines change. Leave a rewrite for later.  
   Effort: large if done alone; small if done as part of a change you are already making.

13. **Refresh the two spec docs in one sitting, or mark them historical.**  
   Also record the locked product rules: guest-first, Export never requires an account, Studio is home, Library is a copy-plus-link (not a live reference), and typed sections / density presets are future design, not current code.  
   Why: `BACKEND_SPEC.md` tells a future editor to hook `queuePush` into an app that has moved on. `DESIGN_SYSTEM.md` still describes a landing scene and a profile form that are gone. Stale specs are how student projects grow a second, conflicting architecture.  
   Effort: small.

### P2 — polish once P0 is calm

14. **A one-page README.** How to open the site locally (any static file server), which files are live, and which files are the dormant cloud design. Effort: small.

15. **A Content-Security-Policy** that allows only this origin plus the CDNs you actually use (cdnjs, fonts.googleapis.com, and jsDelivr for the PDF font). The tiny inline script in `index.html` that toggles `logbook-enabled` would need to move into `features.js` first. Effort: small.

16. **Replace hand-written `?v=` cache bumps** with the habit “change the query number whenever the file changes,” or a one-line build later. Effort: small.

17. **Leave the stack alone.** A React port, a custom server, or realtime sync would multiply moving parts without fixing data loss. `hooks/useAuth.js` can wait until a port is a real decision. Do not introduce Experience / Skills / Summary types, or density presets, until the single CV-item shell and the type-size source of truth are stable. Effort: none for the stack; the new types would be a later product PR.

---

## 11. UX pressure test

This section answers the UX teammate’s list from the code, not from the intended design. “Confirmed” means the current files do that. “Not in code” means the idea is only in the design conversation.

### What the product direction already matches

- **Studio-first home.** `workspace-tabs.js` treats an empty hash as the canvas. The menu label is “CV maker” (`index.html`).
- **Compose on the page.** New blocks are `heading` or `cv-item`, dropped onto `#cvPreview`. The old abstract builder tab is gone.
- **Star and drag into the Library.** `cv-preview.js` (`toggleLayoutItemInLibrary`, `acceptDocumentDropOnLibrary`) and `cv-builder.js` (`saveLibrarySnapshot`).
- **Guest-first, Export not gated.** The live `index.html` loads no auth script. `performPdfExport` does not check an account. That matches the advice. The dormant string in `auth.js` (“Sign in to export”) does not match it, and should not be revived as a gate.
- **Logbook flag.** `features.js` sets `ENABLE_LOGBOOK`. It is `true`, so the logbook is still in the ☰ menu. The demotion is a switch, not the live default.

### Risks checked against the code

**1. Edit affordance, and state vs presentation — confirmed.**  
Fields render with `contenteditable="false"` (`renderPersonalSection`, `renderCvItemSection`). A placeholder becomes editable on the first mousedown. Text that is already filled needs two clicks within 720ms and 16px, or a browser double-click (`detectEditDoubleClick`, `EDIT_DOUBLE_CLICK_MS`). That same mousedown also arms a drag (`sectionPointer`). The stored text is `state.cvPreviewEdits`. The layout block has its own fields too. `renderPreview` rebuilds the DOM from state, but refuses to rebuild while a field is focused, and `blur` writes the DOM back (`finishFieldEdit`). The page and the state can disagree until blur. There is no separate “edit mode” in the data; edit mode is a DOM attribute.

**2. Add item can land off-screen — confirmed.**  
`insertLayoutItem` in `cv-builder.js` appends the block and calls `render({ flashItemId })`. `flashSection` only adds `is-entering` / `is-dropped`. It does not scroll or focus. Once the canvas has any blocks, `applySmartLayout` adds `cv-preview-single-page` even when Auto-fit is off. That class is `height: 297mm; overflow: hidden` (`styles.css`). A block past the fold is clipped, and nothing moves the viewport to it.

**3. Library star — partly fixed, the reported bugs are not gone.**  
PR #5 (`7cc6a40`) did persist `libraryEntryId` on the layout block, and `saveLibrarySnapshot` can update that linked card when the text changed, or refuse an identical copy (`librarySnapshotKey`). That dedupe is real.  
What the star button does is different. `toggleLayoutItemInLibrary` **removes** the card when the link is already there. It never calls the update branch. Dragging onto the Library calls `saveLayoutItemToLibrary`, which returns “duplicate” immediately when the link exists and does not write the new text. So “edit, then star again” deletes the Library card instead of updating it. A later star creates a new card. Identical text will not duplicate; changed text will not update in place from the button.  
The outline is easy to miss, and a later commit made the saved state disappear at rest. `.cv-section-save` is `opacity: 0` until the section row is hovered or a field in it is focused. At rest, a saved star is invisible, because `.is-in-library` swaps in the filled icon but does not raise opacity. While the pointer is on the star itself, the CSS always shows the filled icon, saved or not, so the outline and the saved star look the same under the cursor. The outline only shows when the row is hovered and the item is not saved. Commit `77bc24f` put opacity back to 0 after PR #5 had given the star a resting opacity.  
Blur: the star’s mousedown calls `preventDefault` so the text field keeps focus (“so :focus-within doesn’t pin chrome open”). The save path commits that field first (`commit: true`). The remove path does not. `saveBtn.blur()` runs after the toggle. The field’s own `blur` listener also calls `finishFieldEdit`. The commit-before-save idea is in the save path only.

**4. Undo and delete — confirmed, uneven.**  
`cv-history.js` keeps 60 memory snapshots of layout, library, preview edits, and `personalInfo`. It does not include logbook achievements or Design settings. It is wiped on refresh. Keyboard undo is ignored inside a text field and ignored outside the studio view.  
“Remove all items” (`cv-builder.js`) and logbook delete (`app.js`) require a second click within 2 seconds. The canvas × button and a drag that ends outside the page call `removeSectionFromCv` immediately, then offer a toast Undo. Logbook undo restores the card and **clears the proof file** (`fileData` set to `""`).

**5. Hamburger vs left rail — two sidebars, plus a drawer.**  
The ☰ menu is `app-sidebar` in `sidebar.js`: CV maker, Logbook, Settings. It is an overlay. The left column on the canvas is `.studio-rail` in `index.html`: Blocks and Library, always in the grid (`styles.css` grid area `rail`). Under 900px that rail becomes an 88px horizontal strip. Design is a third surface: the top-bar button toggles `.studio-drawer` (`cv-preview.js`), and the form logic is `cv-layout-panel.js`. Settings in the menu only tells the person to open Design. Three files own “the thing on the side.”

**6. Design panel is one crowded form — confirmed.**  
`index.html` `#cvLayoutForm` stacks typography (font, three size sliders, two colors, divider), layout (line height, gaps, three margin presets, Auto-fit), Save as default / Reset, and the export-history list. There is no information architecture split. The density presets from the UX note (about 0.5 / 0.65 Standard / 0.75 / 1.0) do not exist. The only density words in code (`spacious`, `balanced`, `compact`) are internal labels on the Auto-fit search, not controls.

**7. Sample data on first load — not present.**  
A new browser gets empty arrays (`state` in `app.js`) and the empty line “Start your CV” (`renderDocumentEmptyState`). Nothing seeds a demo CV. The only automatic copy is legacy: if an old save has achievements and no `cvLibrary`, `loadState()` builds library cards from those achievements. That is migration, not sample content.

**8. Export file name ignores the current name — confirmed.**  
`openExportModal` sets the input from `getDefaultExportBaseName()`, which uses `state.personalInfo.name` or else `My_CV`. A repo search shows no `personalInfo.name =` assignment. Typing the name on the page writes `cvPreviewEdits` (`data-edit-key="personal.name"`) and does not copy it into `personalInfo`. `lastExportFileName` is stored after a download and then ignored the next time the dialog opens. If an old save still has `personalInfo.name`, the file name stays on that old value after the canvas name changes.

**9. Auto-fit vs the size on screen — no single source of truth.**  
Three layers:

| Layer | Where | What it claims |
|---|---|---|
| Slider | `state.cvSettings.baseFontSize`, HTML range 9–12 | The number in Design, or the word “auto” while Auto-fit is on (`updateOutputs` in `cv-layout-panel.js`) |
| Page CSS | `--cv-body-font` and sibling variables on `#cvPreview` | What you see. Manual mode clamps body type to 9–12pt (`manualTypographyFromBase`). Auto-fit then overwrites the variables from the PDF shrink (`writeFittedTypography`) |
| PDF shrink | `shrinkPdfModelToOnePage` in `cv-pdf.js` | A second measurement. `minScale = 0.08`, so type can fall far below 6pt and below the 10pt ATS note |

`buildPdfModel` reads the CSS variables, then, if Auto-fit left a `pdfFitOverride`, replaces the model with that override. Screen and PDF share numbers only after that copy. They are not one layout engine.

**10. One page on screen, extra pages in the PDF — confirmed when Auto-fit is off.**  
Auto-fit on: both the CSS search and `createCvPdf` try to force one page, at the cost of the shrink above.  
Auto-fit off: `applySmartLayout` still adds `cv-preview-single-page`, so the screen clips. `createCvPdf` does not shrink, and `renderCvPdf` calls `doc.addPage()` when the next block does not fit (`ensureSpace` / the block loop). Overflow rules are not the same object.

### Open architecture questions

**Where is the CV’s source of truth?**  
Today, the browser notepad. `saveState()` writes one JSON blob. Supabase is not in the page. A future optional login should treat that blob as the guest document and merge it once into that account (the intent of `guest-migration.js`), including `cvLibrary`. It should not become a second live document. `personalInfo` and `cvPreviewEdits.personal` are already two name stores; the file-name bug is that split leaking out. Cloud sync must not ship until Library and that name live in one payload.

**Polymorphic items vs ad-hoc DOM?**  
The code is ad-hoc, with a small type field. `createLayoutItem` makes `heading`, `cv-item`, or legacy `achievement`. A `cv-item` is always title, subtitle, date, location, description. There is no `sectionLabel`, no Experience vs Education type, no Skills list, no Summary singleton, no Free-text type. Section titles are heading blocks. The DOM is rebuilt from those objects plus `cvPreviewEdits`. Adding the UX shell (shared id, type, timestamps, star link, optional section label) would be a new model, not a rename. Do it in its own PR, after Auto-fit and Library behavior are stable, or the new types will be painted by the same 3,731-line renderer.

**Does the PDF share a layout engine with the canvas?**  
No. The canvas is CSS. The PDF is a jsPDF painter (`cv-pdf.js` `doc.text`). `buildPdfModel` in `cv-preview.js` is the bridge: it turns state into a plain model, then the painter measures again. Auto-fit is the only place that feeds the painter’s shrink result back onto the CSS. That is why the sizes drift. A shared engine would mean one model in, one set of point sizes out, both the page and the file consuming it. Until then, every typography change has to be checked twice.

**What does undo cover?**  
Canvas structure, library list, on-page edits, and the `personalInfo` object. Not Design settings, not logbook entries, not proof files, not the export-history list. It is not durable. “Remove all” is safer than a single-section delete because of the second click, not because undo is stronger.

**Is the Library its own store, or references into CV items?**  
Both, and the copy wins. `cvLibrary` is a separate array of field snapshots. The layout block may store `libraryEntryId`. Dropping a library card onto the page **copies** the fields into a new block (`seedLayoutItemFromLibrary`). Later edits on the page do not change the card, and other copies already on the page do not follow a library update. The link is an id for the star, not a live reference.

**Feature flags and dead routes.**  
`ENABLE_LOGBOOK` is the only flag, default on. `#logbook` is the logbook. `#profile`, `#achievements`, and `#viewlogbook` redirect there (`resolveRoute`). Unknown hashes redirect home. The old tab strip `#viewSwitcher` is still handled in JS and is not in the HTML. `personalForm` and the sidebar identity summary are still functions in `app.js` and are not in the page. The `achievement` block type is still rendered and exported for old saves. Those are the dead routes and leftovers. Hiding the logbook is flipping the flag, not deleting `app.js`.

**ATS: selectable text, size floor, one column.**  
The PDF path is real text (`doc.text` in `cv-pdf.js`), one column, full content width. Placeholders are omitted from the model (`exportFieldLines`). That part matches an ATS-friendly file. There is no 10pt floor. Auto-fit’s smallest scale is 0.08. The Design slider’s minimum is 9pt, not 10. If the Chinese font download fails, `createCvPdf` warns and non-Latin characters are omitted, which matters for names. Single-column is already true; the floor is not.

### What not to build next, from this pass

Do not add login as a wall in front of Export. Do not add four new block types in the same PR as a star fix. Do not treat `BACKEND_SPEC.md` as the map of the canvas; the canvas has moved on, and the spec has not. The next small PRs that match the risks are listed in section 10, items 5–9.

---

## Appendix — evidence index

| Claim | Evidence |
|---|---|
| Live site is static and matches this repo | `https://achievemate.vercel.app` HTML is 18,210 bytes and lists the same scripts as `index.html` lines 405–414. Response headers: `server: Vercel`, HSTS on, no Content-Security-Policy |
| Cloud scripts were removed on purpose | Commit `c5c4be7`, message “Drop account UI and client-side Supabase sync from the loaded app so data stays in localStorage.” |
| Save path is local only | `app.js` `saveState()` (around lines 262–266) writes `achievemate-data` and does not mention Supabase. `app.js` has no `queuePush` |
| Shared state | `app.js` `state` (around lines 66–81) and `window.AchieveMateApp` (around lines 1917–1942) |
| Database design | `supabase/migrations/0001_schema.sql` through `0004_achievement_starred.sql` |
| Public anon key, no service role | `supabase-config.js`. Repo search finds `service_role` only as a warning in comments and `BACKEND_SPEC.md` |
| Whole repo is publicly served | HTTP 200 for `/supabase-config.js`, `/auth.js`, `/sync.js`, `/BACKEND_SPEC.md`, `/supabase/migrations/0001_schema.sql`, `/designpage.png` |
| Library missing from cloud payload | `sync.js` `buildCvDocPayload` writes layout, preview edits, settings, custom defaults. Schema `cv_documents` has those columns and no library column |
| Proof size vs notepad | `MAX_PROOF_SIZE = 5242880` in `app.js`; file bytes stored on `achievement.fileData` |
| No tests or CI | No `package.json`, no `*test*` files, no `.github` directory |
| Export is not behind login | `cv-preview.js` `performPdfExport` has no auth check. `auth.js` still has the unused line “Sign in to export” |
| Export name ignores the canvas | `getDefaultExportBaseName()` uses `personalInfo.name`. No `personalInfo.name =` assignment exists. The page writes `cvPreviewEdits` via `data-edit-key="personal.name"` |
| Auto-fit can crush type | `cv-pdf.js` `minScale = 0.08` inside `shrinkPdfModelToOnePage`. Drawer shows “auto” in `cv-layout-panel.js` `updateOutputs`. Slider min is 9 in `index.html` |
| Screen clips, PDF can add pages | `applySmartLayout` adds `cv-preview-single-page` even when Auto-fit is off. `styles.css` sets `overflow: hidden` on that class. `renderCvPdf` calls `doc.addPage()` |
| Star removes instead of updating | `toggleLayoutItemInLibrary` calls `removeLibraryEntry` when `isLayoutItemInLibrary` is true. The update branch is in `saveLibrarySnapshot` and is not reached from that click |
| Star outline / saved state | `styles.css` `.cv-section-save { opacity: 0 }` until row hover or field focus. Button `:hover` always shows the filled icon. `.is-in-library` does not set opacity, so a saved star is invisible at rest |
| New block is not focused | `insertLayoutItem` → `flashSection` adds classes only. No `scrollIntoView` |
| Typed sections and density presets are not built | `createLayoutItem` returns `heading`, `cv-item`, or `achievement` only. No 0.5/0.65/0.75/1.0 controls |
