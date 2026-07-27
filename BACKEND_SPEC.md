# AchieveMate — Backend Specification (Supabase)

Version 1.0 — Backend authority document. This spec is written to be executed **step-by-step, in order** by a code model in Cursor. Do not skip phases, do not reorder them, and do not invent tables, columns, or policies that are not in this file.

**Stack:** Supabase Free Tier — Auth (email + password), Postgres (with Row Level Security), Storage (private bucket for proof files). Frontend stays a static vanilla-JS site (no bundler, no framework, no server). Total infrastructure cost: **$0**.

**Companion documents:** `DESIGN_SYSTEM.md` (UI spec). The current client state lives in `app.js` (`window.AchieveMateApp.state`) and persists to `localStorage`. This spec replaces `localStorage` as the source of truth with Supabase, keeping `localStorage` as a write-through cache.

---

## 0. Current client data model (what the backend must support)

Read before writing any SQL. This is the exact shape produced by `app.js`, `cv-builder.js`, and `cv-preview.js` today:

```js
state = {
  personalInfo: { name: "", phone: "", email: "" },
  achievements: [{
    id: "ach-1712-x8k2",          // client-generated string id
    title: "Dean's List Award",
    date: "May 2025",              // free text, NOT a real date
    description: "line\nline",     // newline-separated bullets, no glyphs
    showDescription: true,
    fileName: "transcript.pdf",    // proof attachment metadata
    fileType: "application/pdf",
    fileData: "data:application/pdf;base64,...."  // ← base64 in localStorage. MUST move to Storage.
  }],
  cvLayout: [                      // ordered; array order IS the document order
    { id: "blk-1", type: "heading", title: "Awards" },
    { id: "blk-2", type: "achievement", achievementId: "ach-1712-x8k2" }
  ],
  cvPreviewEdits: { personal: {}, items: {} },   // sanitized-HTML overrides keyed by path
  cvSettings: { fontFamily, baseFontSize, nameFontSize, headingFontSize,
                headingDivider, textColor, accentColor, lineHeight,
                sectionGap, itemGap, pageMargin, autoFit },
  exportHistory: [{                // newest first, client caps at 20
    id: "exp-...", fileName: "Jane_CV.pdf", exportedAt: "ISO",
    snapshot: { personalInfo, cvLayout, cvPreviewEdits, cvSettings }  // no file data inside
  }]
}
```

### Mapping decision (fixed — do not change)

| Client state | Backend home | Why |
|---|---|---|
| `personalInfo` | `public.profiles` (1 row/user) | Small, structured, queried on boot. |
| `achievements[]` | `public.achievements` (1 row each) | Real entities; per-row RLS; proof file references. |
| `achievements[].fileData` | **Storage bucket `proofs`** (never the DB) | Base64 in Postgres would burn the 500 MB DB quota ~33× faster than Storage's 1 GB. |
| `cvLayout`, `cvPreviewEdits`, `cvSettings`, custom defaults | `public.cv_documents` (1 row/user, `jsonb` columns) | These change together on nearly every interaction; one debounced upsert per save beats 3 normalized tables. The client is the only reader — no server-side querying into these blobs is ever needed. |
| `exportHistory[]` | `public.export_history` (1 row each, server-trimmed to 20) | Needs server-side cap so no client bug can grow it unbounded. |

---

## 1. Free-tier budget and the rules that protect it

Supabase Free Tier limits (as of 2026): **500 MB database**, **1 GB storage**, **5 GB egress/month**, **50,000 MAU**, project **pauses after ~7 days of no API activity**, built-in email limited to a few auth emails per hour.

Hard rules derived from those limits — every later phase enforces at least one of them:

1. **No base64 in Postgres.** Proof files go to Storage. The DB stores only `proof_path` / `proof_name` / `proof_type` strings. (Enforced: schema has no bytea/data column.)
2. **Proof files ≤ 5 MB, whitelisted MIME types only.** 1 GB ÷ 5 MB = 200 proofs/user worst case — fine for a single-user-scale free project. (Enforced: bucket `file_size_limit` + `allowed_mime_types` in Phase 3.)
3. **Debounced writes.** The client batches state changes and writes at most once per 1200 ms of quiet (Phase 5). Typing in a textarea must not produce a request per keystroke.
4. **One row, not many, for hot data.** `cv_documents` is a single upserted row per user, so slider-dragging in the Style drawer costs one small UPDATE, not a fan-out.
5. **Server-side caps.** `export_history` is trimmed to 20 rows/user by a trigger; `jsonb` columns have `pg_column_size` CHECK guards so a runaway client cannot store megabyte blobs.
6. **Signed URLs, short TTL (120 s), generated on click only.** Never pre-generate proof URLs for the whole list — that is free egress waste and a security smell.
7. **No Realtime, no Edge Functions, no cron.** Nothing in this product needs them; every feature is client ↔ PostgREST/Storage.
8. **Pause awareness.** Free projects pause after ~1 week idle. The client's boot-time fetch is enough to count as activity for any real user; document (Phase 7) that a paused project is restored from the dashboard with zero data loss.

Security rules (non-negotiable):

- **RLS enabled and FORCED on every `public` table.** Every policy is owner-only (`auth.uid()` match) and scoped `to authenticated`. The `anon` role can see nothing.
- **The `anon` (publishable) key ships in client JS — that is by design and safe** *only because* of RLS. The `service_role` (secret) key must never appear anywhere in this repo. If a step seems to need `service_role`, the step is wrong.
- **Storage bucket is private**; object paths are namespaced `<user_id>/...` and policies check the first path folder against `auth.uid()`.
- All user-generated HTML (`cvPreviewEdits`) is already sanitized client-side by `sanitizeRichText` in `cv-preview.js`; the DB additionally length-guards it. Rendering always goes through the existing sanitizer — the backend never serves it as trusted HTML.

---

## 2. Phase 1 — Supabase project setup (human + dashboard, ~5 min)

> This is the only phase requiring the dashboard UI. Everything after is SQL and JS.

1. Create a project at [database.new](https://database.new) → name `achievemate`, choose the region closest to users, generate a strong DB password (store in a password manager; the app never uses it).
2. In **Project Settings → API**, copy two values:
   - `Project URL` (like `https://abcdefgh.supabase.co`)
   - `anon` `public` API key
3. In **Authentication → Providers → Email**: keep **Email** enabled, leave **Confirm email** ON. Disable every other provider.
4. In **Authentication → URL Configuration**: set *Site URL* to where the app is hosted (e.g. `https://<user>.github.io/achievemate/`), and add `http://localhost:5500` (or whatever local static-server port is used) to *Redirect URLs*.
5. Do **not** create tables or buckets in the UI — all of that is SQL in Phases 2–3 so it is reviewable and repeatable.

**Verify:** you can open the SQL Editor in the dashboard and run `select 1;`.

---

## 3. Phase 2 — Database schema (SQL migration 1)

Run the following as **one script** in the Supabase SQL Editor (or save as `supabase/migrations/0001_schema.sql` if using the Supabase CLI). It is idempotent-ish for a fresh project; on re-run, drop the tables first.

```sql
-- ============================================================
-- AchieveMate schema — migration 0001
-- All tables: owner-only via RLS. All timestamps: timestamptz.
-- ============================================================

-- ---------- shared trigger: keep updated_at honest ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------- profiles ----------------------------
-- 1 row per auth user. Mirrors state.personalInfo.
-- contact_email is the CV display email (free text), distinct
-- from the auth email.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '' check (char_length(full_name) <= 120),
  phone         text not null default '' check (char_length(phone) <= 40),
  contact_email text not null default '' check (char_length(contact_email) <= 160),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- --------------------- achievements -------------------------
-- 1 row per logbook entry. client_id preserves the ids already
-- referenced by cvLayout ("ach-...") so no layout rewriting is
-- needed at migration time. date_label is deliberately free text.
-- proof_* are Storage references only — never file bytes.
create table public.achievements (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  client_id        text not null check (char_length(client_id) <= 64),
  title            text not null default '' check (char_length(title) <= 200),
  date_label       text not null default '' check (char_length(date_label) <= 60),
  description      text not null default '' check (char_length(description) <= 4000),
  show_description boolean not null default true,
  proof_name       text not null default '' check (char_length(proof_name) <= 200),
  proof_type       text not null default '' check (char_length(proof_type) <= 100),
  proof_path       text not null default '' check (char_length(proof_path) <= 300),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, client_id)
);

-- The one hot query is "all achievements for me, in order":
create index achievements_user_position_idx
  on public.achievements (user_id, position);

create trigger achievements_set_updated_at
  before update on public.achievements
  for each row execute function public.set_updated_at();

-- --------------------- cv_documents -------------------------
-- Exactly 1 row per user (PK = user_id). Holds everything that
-- changes together during composition. jsonb size guards keep a
-- buggy client from storing megabytes (free-tier protection).
create table public.cv_documents (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  layout          jsonb not null default '[]'::jsonb
                    check (pg_column_size(layout) <= 65536),
  preview_edits   jsonb not null default '{"personal":{},"items":{}}'::jsonb
                    check (pg_column_size(preview_edits) <= 131072),
  settings        jsonb not null default '{}'::jsonb
                    check (pg_column_size(settings) <= 8192),
  custom_defaults jsonb not null default '{}'::jsonb
                    check (pg_column_size(custom_defaults) <= 8192),
  updated_at      timestamptz not null default now()
);

create trigger cv_documents_set_updated_at
  before update on public.cv_documents
  for each row execute function public.set_updated_at();

-- --------------------- export_history -----------------------
-- Snapshots restore past CV states. Snapshots contain NO file
-- data (layout + edits + settings + personalInfo only).
create table public.export_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  file_name   text not null check (char_length(file_name) <= 160),
  snapshot    jsonb not null check (pg_column_size(snapshot) <= 131072),
  exported_at timestamptz not null default now()
);

create index export_history_user_recent_idx
  on public.export_history (user_id, exported_at desc);

-- Server-side cap: keep only the newest 20 per user, no matter
-- what the client does.
create or replace function public.trim_export_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.export_history
  where user_id = new.user_id
    and id not in (
      select id from public.export_history
      where user_id = new.user_id
      order by exported_at desc, id desc
      limit 20
    );
  return new;
end;
$$;

create trigger export_history_trim
  after insert on public.export_history
  for each row execute function public.trim_export_history();

-- ------------- auto-provision rows on signup -----------------
-- Every new auth user gets a profile + an empty cv_document, so
-- the client can always assume both exist (no create-if-missing
-- branches in JS).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  insert into public.cv_documents (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Verify Phase 2:** in the SQL Editor run
`select table_name from information_schema.tables where table_schema = 'public';`
→ must list exactly `profiles`, `achievements`, `cv_documents`, `export_history`.

---

## 4. Phase 3 — Row Level Security + Storage (SQL migration 2)

Run as one script (`supabase/migrations/0002_rls_storage.sql`). Nothing is readable by anyone until this completes; that is correct ordering (deny-first).

```sql
-- ============================================================
-- AchieveMate RLS + Storage — migration 0002
-- Pattern: every table is FORCEd RLS, owner-only, authenticated
-- only. anon gets nothing. There are no public reads anywhere.
-- ============================================================

-- ------------------------ profiles --------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT/DELETE policies: rows are created by the signup
-- trigger and removed by the auth.users cascade. The client can
-- never create or destroy a profile row directly.

-- ---------------------- achievements ------------------------
alter table public.achievements enable row level security;
alter table public.achievements force row level security;

create policy "achievements_select_own" on public.achievements
  for select to authenticated using (user_id = (select auth.uid()));

create policy "achievements_insert_own" on public.achievements
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "achievements_update_own" on public.achievements
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "achievements_delete_own" on public.achievements
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------- cv_documents ------------------------
alter table public.cv_documents enable row level security;
alter table public.cv_documents force row level security;

create policy "cv_documents_select_own" on public.cv_documents
  for select to authenticated using (user_id = (select auth.uid()));

create policy "cv_documents_update_own" on public.cv_documents
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No INSERT/DELETE: provisioned by trigger, removed by cascade.

-- --------------------- export_history -----------------------
alter table public.export_history enable row level security;
alter table public.export_history force row level security;

create policy "export_history_select_own" on public.export_history
  for select to authenticated using (user_id = (select auth.uid()));

create policy "export_history_insert_own" on public.export_history
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "export_history_delete_own" on public.export_history
  for delete to authenticated using (user_id = (select auth.uid()));

-- No UPDATE policy: history entries are immutable.

-- ============================================================
-- Storage: private bucket for proof attachments
-- Path convention (enforced below):  <user_id>/<achievement_client_id>/<filename>
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proofs',
  'proofs',
  false,                -- private: access only via RLS + signed URLs
  5242880,              -- 5 MB per file (free-tier rule #2)
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);

-- Owner-only object access: first folder of the path must equal
-- the caller's user id.
create policy "proofs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'proofs'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "proofs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'proofs'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "proofs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'proofs'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "proofs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'proofs'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
```

**Verify Phase 3 (RLS proof):** in the SQL Editor run:

```sql
select tablename, rowsecurity
from pg_tables where schemaname = 'public';
-- every row must show rowsecurity = true

set local role anon;
select count(*) from public.achievements;  -- must ERROR or return nothing
reset role;
```

---

## 5. Phase 4 — Client foundation: config, Supabase client, auth UI

The site is static with no bundler, so `@supabase/supabase-js` loads as an ES module from a CDN. Three new files, one edit to `index.html`.

### 5.1 `supabase-config.js` (new)

```js
// Public values — safe to commit. Security lives in RLS, not in
// hiding these. NEVER put the service_role key in this repo.
window.ACHIEVEMATE_SUPABASE = {
  url: "https://YOUR-PROJECT-REF.supabase.co",
  anonKey: "YOUR-ANON-PUBLIC-KEY",
};
```

Replace both placeholders with the Phase-1 values.

### 5.2 `supabase-client.js` (new, ES module)

```js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { url, anonKey } = window.ACHIEVEMATE_SUPABASE;

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,        // survives reloads via localStorage
    autoRefreshToken: true,
    detectSessionInUrl: true,    // handles email-confirmation redirects
    flowType: "pkce",
  },
});

// Expose for the existing non-module scripts (app.js etc. are
// classic scripts; they reach the client through window).
window.AchieveMateSupabase = supabase;
```

### 5.3 `auth.js` (new, ES module) — behavior spec

Implement a minimal auth gate styled with the existing `DESIGN_SYSTEM.md` tokens (surface-1 card, brass primary button, §3.3.2 input spec). Requirements:

1. On load, call `supabase.auth.getSession()`.
   - **No session** → hide both `main.view` elements, show a centered auth card with: email input, password input, primary button `Sign in`, ghost button `Create account`, and error text slot (`--signal-danger`, `body` type).
   - **Session exists** → dispatch `document.dispatchEvent(new CustomEvent("achievemate:authed", { detail: { user } }))` and remove the auth card.
2. `Create account` → `supabase.auth.signUp({ email, password })`. On success show: `Check your email to confirm your account.` (caption style). Passwords: rely on Supabase's server-side minimum; show returned error messages verbatim in the error slot — do not invent client-side password rules.
3. `Sign in` → `supabase.auth.signInWithPassword({ email, password })`. On success, same `achievemate:authed` event.
4. Subscribe to `supabase.auth.onAuthStateChange`; on `SIGNED_OUT`, reload the page (simplest correct state reset for a static app).
5. Add a `Sign out` item to the top bar (icon button, right group, per §3.2.2) that calls `supabase.auth.signOut()`.
6. Never store passwords or tokens yourself — supabase-js manages the session in localStorage.

### 5.4 `index.html` edit

Add before the existing classic scripts, in this order:

```html
<script src="supabase-config.js"></script>
<script type="module" src="supabase-client.js"></script>
<script type="module" src="auth.js"></script>
<script type="module" src="sync.js"></script> <!-- Phase 5 -->
```

**Verify Phase 4:** serve the folder over HTTP (e.g. `npx serve .` — `file://` breaks module CORS and auth redirects), create an account, confirm via email, sign in. In the Supabase dashboard **Table Editor**, `profiles` and `cv_documents` each show one row for the new user (proves the Phase-2 trigger works).

---

## 6. Phase 5 — Sync layer (`sync.js`): Supabase as source of truth

This is the core integration. Design: **read once at boot, write-through on change, debounced.** `localStorage` keeps its exact current schema and becomes an offline cache/fallback, which means zero changes to render logic.

### 6.1 Row ↔ state mapping (exact)

```text
profiles row            → state.personalInfo { name: full_name, phone, email: contact_email }
achievements row        → state.achievements[i] {
                            id:          client_id,        // NOTE: client keeps using client_id
                            title, date: date_label, description,
                            showDescription: show_description,
                            fileName: proof_name, fileType: proof_type,
                            proofPath: proof_path,         // NEW field replacing fileData
                          }
cv_documents.layout     → state.cvLayout
cv_documents.preview_edits → state.cvPreviewEdits
cv_documents.settings   → state.cvSettings   (merge over DEFAULT_CV_SETTINGS)
cv_documents.custom_defaults → custom defaults (getCustomDefaults/saveCustomDefaults)
export_history rows     → state.exportHistory [{ id, fileName: file_name,
                            exportedAt: exported_at, snapshot }]
```

`fileData` (base64) is **retired** from state for synced users. The proof chip click handler changes from `window.open(fileData)` to the signed-URL flow in 6.4.

### 6.2 Boot sequence (runs on `achievemate:authed`)

1. Fetch in parallel (one round each, 4 requests total):
   - `from("profiles").select("*").single()`
   - `from("achievements").select("*").order("position")`
   - `from("cv_documents").select("*").single()`
   - `from("export_history").select("*").order("exported_at", { ascending: false }).limit(20)`
2. **If the server has any achievements OR a non-empty layout** → server wins: overwrite `state.*` from rows (mapping 6.1), call `saveState()` (refreshes the localStorage cache), then `refreshPersonalForm()`, `renderAchievements()`, and re-render both CV surfaces.
3. **Else if server is empty AND localStorage has data AND `localStorage.getItem("achievemate-migrated-v1") !== "true"`** → run the one-time migration (Phase 6).
4. Any fetch error → toast `Couldn't reach the server — working offline` (danger tone, per §4.3) and continue on the localStorage cache. Retry the boot fetch once after 5 s.

### 6.3 Write path (replaces nothing, wraps everything)

`app.js` already funnels all persistence through `saveState()` / `saveCvSettings()` and signals `AchieveMateSaveStatus.markPending()/markComplete()`. Hook there:

1. In `sync.js`, expose `window.AchieveMateSync = { queuePush() }`.
2. Edit `app.js`: `saveState()` and `saveCvSettings()` additionally call `window.AchieveMateSync?.queuePush()` after writing localStorage.
3. `queuePush()` debounces **1200 ms** (free-tier rule #3), then pushes a diff:
   - `profiles`: `update({ full_name, phone, contact_email }).eq("id", user.id)` — only if changed since last push.
   - `achievements`: compute against the last-pushed snapshot: upsert changed/new rows with `upsert({ user_id, client_id, ...fields, position: index }, { onConflict: "user_id,client_id" })`, delete removed rows by `client_id`. `position` = index in `state.achievements`.
   - `cv_documents`: single `update({ layout, preview_edits, settings, custom_defaults }).eq("user_id", user.id)` — only if any of the four changed (compare `JSON.stringify`).
4. Save-status wiring: the Saved indicator (§3.2.4) now means *synced*. `markPending()` on queue, `markComplete()` only after the Supabase write resolves. On write failure: keep the indicator on `Saving…`, toast the error once, retry with backoff (5 s, 15 s, 60 s, then on next change).
5. Export flow: in `cv-preview.js`, `addExportHistoryEntry(fileName, snapshot)` additionally inserts `{ user_id, file_name: fileName, snapshot }` into `export_history` (fire-and-forget with error toast; the server trigger enforces the 20-row cap). `deleteExportHistoryEntry(id)` also deletes the server row.
6. Deleting an achievement (`removeAchievementById`) must also remove its proof object: `storage.from("proofs").remove([proofPath])` when `proofPath` is set. Run it after the DB delete succeeds; ignore not-found errors. The Undo flow re-inserts the achievement row but cannot restore the file — acceptable v1 trade-off; on Undo, clear `fileName/fileType/proofPath` and show the standard toast.

### 6.4 Proof files (Storage flows)

**Upload** (replaces `readFileAsDataUrl` in the edit-mode attach flow in `app.js`):

```js
// path convention MUST match the Phase-3 policies:
const path = `${user.id}/${achievement.id}/${Date.now()}_${sanitizedFileName}`;
const { error } = await supabase.storage.from("proofs")
  .upload(path, file, { contentType: file.type, upsert: false });
// on success: draft.fileName = file.name; draft.fileType = file.type;
// draft.proofPath = path; draft.fileData = "";
```

- `sanitizedFileName`: lowercase, `[a-z0-9._-]` only, others → `_`, max 100 chars.
- Client-side pre-check (mirrors bucket rules, better UX than a 400): reject files > 5 MB or outside the Phase-3 MIME list with toast `Proof must be a PDF, image, or Word file under 5 MB` (danger).
- Replacing a proof: upload the new file first, then `remove([oldPath])`, then update the row. Never orphan-then-upload.

**View** (proof chip click):

```js
const { data, error } = await supabase.storage.from("proofs")
  .createSignedUrl(proofPath, 120);           // 120 s TTL, on demand only
if (data) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
```

**Legacy fallback:** if an entry still has `fileData` (unmigrated/offline), keep the old `window.open(fileData)` path.

**Verify Phase 5:** sign in on browser A, add an achievement with a proof, edit settings; sign in on browser B → identical state appears, proof chip opens the file. In the dashboard, `achievements.proof_path` is set and `storage/proofs` contains the object under `<user_id>/...`. Watch the Network tab while dragging a style slider: at most ~1 request per 1.2 s.

---

## 7. Phase 6 — One-time localStorage → Supabase migration

Runs only when the 6.2 condition (server empty + local data + flag unset) holds. Implement in `sync.js` as `migrateLocalData()`:

1. Read `achievemate-data`, `achievemate_cv_settings`, `achievemate_custom_defaults` from localStorage (same parsing as `loadState()`).
2. Push `profiles` update from `personalInfo`.
3. For each achievement, **sequentially** (not Promise.all — avoids burst rate limits and makes partial failure resumable):
   a. If `fileData` is a data URL: `const blob = await (await fetch(fileData)).blob();` — skip the upload (keep metadata, clear proof fields) if the blob exceeds 5 MB or has a non-whitelisted type, and record the entry title in a `skipped` list.
   b. Upload per 6.4 path convention (the achievement's existing `"ach-..."` id is the `client_id` and path segment).
   c. Upsert the achievement row (`client_id` = existing id, `position` = array index, `proof_path` = uploaded path or `""`).
4. Update `cv_documents` with `layout` (unchanged — it already references the `client_id`s), `preview_edits`, `settings`, `custom_defaults`.
5. Insert up to 20 `export_history` rows (oldest first, so the trigger keeps the newest).
6. On full success: `localStorage.setItem("achievemate-migrated-v1", "true")`, strip all `fileData` strings from state, `saveState()`, toast `Your logbook is now synced to your account` (success). If any `skipped` entries: additionally toast `N proof file(s) were too large to sync and stayed on this device` (neutral).
7. On any hard failure: leave the flag unset (migration re-runs next boot; upserts make it idempotent) and toast the offline message.

**Verify Phase 6:** with pre-existing local data, sign up fresh → all entries, layout, settings, and history appear in the dashboard tables; proofs appear in Storage; the flag is set; a page reload does not re-migrate.

---

## 8. Phase 7 — Production hardening checklist

Dashboard settings (no code):

- [ ] **Auth → rate limits**: leave Supabase defaults (they are sane). Note: the built-in email sender allows only a handful of mails/hour — enough for a personal app; if this ever grows, plug in a custom SMTP (Resend free tier) in **Auth → SMTP**. Not required for v1.
- [ ] **Auth → Sessions**: defaults are fine (1-hour access token, refresh rotation is automatic).
- [ ] **Database → Backups**: free tier keeps daily backups for 7 days — no action, just awareness.
- [ ] **Project pausing**: free projects pause after ~7 days of zero API traffic. Restoring from the dashboard is one click and loses nothing. Do not add keep-alive cron hacks — they violate the spirit of the free tier and are unnecessary for an actively used app.

Code-level checks (the definition of done):

- [ ] `service_role` key appears nowhere in the repo (grep for `service_role` and for the key prefix `eyJ` outside `supabase-config.js`).
- [ ] Every `public` table shows `rowsecurity = true` **and** `forcerowsecurity = true` (`select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';`).
- [ ] Signed-in user A cannot read user B's rows: create two accounts, copy B's `client_id`, and from A's console run `supabase.from("achievements").select("*")` → only A's rows return; a direct `.eq("user_id", B_ID)` returns empty, not an error leak.
- [ ] A cannot fetch B's proof: `createSignedUrl` on B's path returns an error object, not a URL.
- [ ] Uploading a 6 MB file or an `.exe` fails at the client pre-check AND (if forced via console) at the bucket rules.
- [ ] Inserting 25 export-history rows leaves exactly 20 (trigger works).
- [ ] Typing continuously in a description textarea for 10 s produces ≤ 9 network writes (debounce works).
- [ ] With DevTools offline: the app still boots from the localStorage cache, shows the offline toast, and the Saved indicator stays on `Saving…` until connectivity returns and the retry lands.
- [ ] `state.achievements[*].fileData` is empty for every synced entry (no base64 lingering in the cache).

---

## 9. Explicit non-goals (v1)

Do not build any of the following; each is listed so the executing model does not "helpfully" add it:

- **No multiple CVs per user** — `cv_documents` is keyed by `user_id` alone. (The schema extends naturally later: new PK `id uuid` + `user_id` FK + a `name` column.)
- **No sharing/public CV links** — every policy is owner-only; there is intentionally no `anon` read path.
- **No Realtime subscriptions** — single-user data edited on one device at a time; boot-fetch + write-through is sufficient and free-tier-friendlier.
- **No Edge Functions / server-side PDF rendering** — PDF export stays client-side (`html2pdf` in `cv-preview.js`).
- **No storing the rendered PDF in Storage** — history stores JSON snapshots (already the current behavior); PDFs are regenerated on demand.
- **No custom password rules, captchas, or OAuth providers** — email + password with confirmation only.
- **No admin panel or service-role tooling** — the Supabase dashboard is the admin panel.

---

## 10. Execution order summary (for the implementing model)

| Step | Artifact | Depends on | Verify |
|---|---|---|---|
| 1 | Dashboard project + auth config (Phase 2 doc §2) | — | SQL editor reachable |
| 2 | Migration `0001_schema.sql` (§3) | 1 | 4 tables exist |
| 3 | Migration `0002_rls_storage.sql` (§4) | 2 | RLS true everywhere; anon blocked |
| 4 | `supabase-config.js`, `supabase-client.js`, `auth.js`, `index.html` script tags (§5) | 3 | Sign-up creates `profiles` + `cv_documents` rows |
| 5 | `sync.js` + hooks in `app.js` / `cv-preview.js` (§6) | 4 | Two-browser sync; debounce visible in Network tab |
| 6 | `migrateLocalData()` in `sync.js` (§7) | 5 | Existing local data lands in tables + Storage exactly once |
| 7 | Hardening checklist (§8) | 6 | Every checkbox ticked |

*End of specification.*
