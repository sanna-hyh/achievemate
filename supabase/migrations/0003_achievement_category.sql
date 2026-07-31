-- Achievement category for logbook cards (education, leadership, etc.)
alter table public.achievements
  add column if not exists category text not null default 'others'
  check (category in ('education', 'leadership', 'competition', 'internship', 'volunteering', 'others'));
