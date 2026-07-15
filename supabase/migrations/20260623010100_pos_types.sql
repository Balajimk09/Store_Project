create table if not exists public.pos_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pos_key text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pos_types_pos_key_unique_idx
on public.pos_types(pos_key);

create index if not exists pos_types_is_active_idx
on public.pos_types(is_active);

insert into public.pos_types (name, pos_key, sort_order)
values
  ('Verifone', 'verifone', 10),
  ('Clover', 'clover', 20),
  ('NCR', 'ncr', 30),
  ('Square', 'square', 40),
  ('Other', 'other', 999)
on conflict (pos_key) do nothing;