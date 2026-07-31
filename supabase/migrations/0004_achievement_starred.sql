alter table public.achievements
  add column if not exists starred boolean not null default false;
