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
