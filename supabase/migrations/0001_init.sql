-- ============================================================
-- 0001_init.sql — ShelfSense initial schema
-- ============================================================

-- ── Enum ─────────────────────────────────────────────────────
create type public.pantry_status as enum (
  'fresh',
  'use_soon',
  'likely_expired',
  'consumed'
);

-- ── Tables ───────────────────────────────────────────────────

create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz default now() not null
);

create table public.receipts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  file_path   text        not null,
  ocr_text    text,
  uploaded_at timestamptz default now() not null,
  status      text        not null default 'pending'
    check (status in ('pending', 'ocr_done', 'parsed', 'failed'))
);

create table public.pantry_items (
  id                      uuid           primary key default gen_random_uuid(),
  user_id                 uuid           not null references auth.users(id) on delete cascade,
  receipt_id              uuid           references public.receipts(id) on delete set null,
  name                    text           not null,
  normalized_name         text,
  category                text,
  quantity                numeric,
  unit                    text,
  purchased_at            date           not null default current_date,
  estimated_expiration_at date,
  status                  pantry_status  not null default 'fresh',
  created_at              timestamptz    default now() not null
);

create table public.meal_suggestions (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users(id) on delete cascade,
  title               text        not null,
  ingredients_used    jsonb       not null,
  missing_ingredients jsonb,
  reason              text,
  created_at          timestamptz default now() not null
);

create table public.shelf_life_rules (
  id           serial  primary key,
  category     text    unique not null,
  default_days int     not null,
  storage      text    check (storage in ('pantry', 'fridge', 'freezer'))
);

-- ── RLS ──────────────────────────────────────────────────────

alter table public.profiles         enable row level security;
alter table public.receipts         enable row level security;
alter table public.pantry_items     enable row level security;
alter table public.meal_suggestions enable row level security;
alter table public.shelf_life_rules enable row level security;

create policy "own profile"
  on public.profiles for all
  using (auth.uid() = id);

create policy "own receipts"
  on public.receipts for all
  using (auth.uid() = user_id);

create policy "own pantry"
  on public.pantry_items for all
  using (auth.uid() = user_id);

create policy "own meals"
  on public.meal_suggestions for all
  using (auth.uid() = user_id);

-- shelf_life_rules: reference data. Any authenticated user can read.
-- No write policies → only the service role (which bypasses RLS) can seed/modify.
create policy "read shelf life rules"
  on public.shelf_life_rules for select
  using (true);

-- ── Indexes ──────────────────────────────────────────────────

-- pantry hot paths: filtering by status and sorting by expiration
create index idx_pantry_items_user_status
  on public.pantry_items (user_id, status);

create index idx_pantry_items_user_expiration
  on public.pantry_items (user_id, estimated_expiration_at);

-- receipts hot path: listing a user's receipts newest-first
create index idx_receipts_user_uploaded_at
  on public.receipts (user_id, uploaded_at desc);

-- meal suggestions hot path: listing a user's suggestions newest-first
create index idx_meal_suggestions_user_created_at
  on public.meal_suggestions (user_id, created_at desc);

-- foreign key index: pantry_items joining back to receipts
create index idx_pantry_items_receipt_id
  on public.pantry_items (receipt_id);

-- ── Auto-create profile on signup ────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
