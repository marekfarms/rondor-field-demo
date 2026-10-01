-- ============================================================================
-- Rondor Excavations field app — Supabase schema
-- Run this in the Supabase SQL editor (all at once). It is idempotent
-- for the extension; tables/policies are created fresh — run ONCE on a
-- new project.
-- ============================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- PROFILES: one row per auth user. Role is 'owner' or 'worker'.
-- New signups default to 'worker' (least privilege). The owner promotes
-- accounts from the app's Admin screen. Disable public signup in
-- Authentication > Settings and create worker users there instead.
-- --------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'worker' check (role in ('owner','worker')),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'worker');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the caller an owner? (security definer so it bypasses RLS)
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- Helper: is the caller assigned to this job?
create or replace function public.is_assigned(p_job uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.jobs
    where id = p_job and auth.uid() = any(assigned_worker_ids)
  );
$$;

-- Workers/owners may change only their own display name — never their role.
create or replace function public.set_my_display_name(p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set display_name = nullif(trim(p_name), '')
  where id = auth.uid();
end;
$$;

-- profiles RLS
create policy "profiles: user reads own"      on public.profiles for select using (auth.uid() = id);
create policy "profiles: owner reads all"     on public.profiles for select using (public.is_owner());
create policy "profiles: owner updates roles"  on public.profiles for update  using (public.is_owner()) with check (public.is_owner());
-- NOTE: no self-update policy on profiles — a worker must never be able to
-- change their own role. Display-name changes go through set_my_display_name().

-- --------------------------------------------------------------------------
-- CUSTOMERS (owner only)
-- --------------------------------------------------------------------------
create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id),
  name       text not null,
  phone      text,
  email      text,
  address    text,
  notes      text,
  created_at timestamptz not null default now()
);
alter table public.customers enable row level security;
create policy "customers: owner full" on public.customers for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- --------------------------------------------------------------------------
-- QUOTES. estimate = frozen line-item JSON, totals = frozen computed totals,
-- terms = frozen copy of the T&Cs at quote time, snapshot_html = frozen
-- customer-facing quote used for the PDF/print record.
-- --------------------------------------------------------------------------
create table public.quotes (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles(id),
  customer_id      uuid references public.customers(id) on delete set null,
  number           text not null,
  status           text not null default 'draft'
                     check (status in ('draft','sent','accepted','declined','expired')),
  work_date        date,
  frost_applies    boolean not null default false,
  estimate         jsonb not null,
  totals           jsonb not null,
  terms            text[] not null default '{}',
  snapshot_html    text,
  accept_token     text unique,
  accepted_at      timestamptz,
  accepted_by_name text,
  created_at       timestamptz not null default now()
);
alter table public.quotes enable row level security;
create policy "quotes: owner full" on public.quotes for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- Auto quote numbering: R-2026-0001, …
create table public.quote_counters (
  owner_id uuid not null references public.profiles(id),
  year     int  not null,
  last_num int  not null default 0,
  primary key (owner_id, year)
);
alter table public.quote_counters enable row level security;
create policy "counters: owner full" on public.quote_counters for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

create or replace function public.next_quote_number()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  y int := extract(year from now())::int;
  n int;
begin
  insert into public.quote_counters (owner_id, year, last_num)
  values (auth.uid(), y, 1)
  on conflict (owner_id, year)
  do update set last_num = quote_counters.last_num + 1
  returning quote_counters.last_num into n;
  return 'R-' || y || '-' || lpad(n::text, 4, '0');
end;
$$;

-- --------------------------------------------------------------------------
-- JOBS. Workers NEVER get direct table access — they only see the 4
-- non-financial columns through get_worker_jobs(). There are intentionally
-- no worker RLS policies on this table.
-- --------------------------------------------------------------------------
create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id),
  customer_id        uuid references public.customers(id) on delete set null,
  quote_id           uuid references public.quotes(id) on delete set null,
  name               text not null,
  address            text,
  status             text not null default 'active'
                       check (status in ('active','on_hold','complete')),
  assigned_worker_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now()
);
alter table public.jobs enable row level security;
create policy "jobs: owner full" on public.jobs for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- Worker-safe job list: id, name, address, status ONLY. No financials.
create or replace function public.get_worker_jobs()
returns table (
  id uuid, name text, address text, status text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select j.id, j.name, j.address, j.status, j.created_at
  from public.jobs j
  where auth.uid() = any(j.assigned_worker_ids)
  order by j.created_at desc;
$$;

-- --------------------------------------------------------------------------
-- CHANGE ORDERS (owner only via RLS; customers act through token functions)
-- --------------------------------------------------------------------------
create table public.change_orders (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  owner_id         uuid not null references public.profiles(id),
  description      text not null,
  price            numeric not null default 0,
  status           text not null default 'pending'
                     check (status in ('pending','approved','declined')),
  token            text unique,
  approved_at      timestamptz,
  approved_by_name text,
  created_at       timestamptz not null default now()
);
alter table public.change_orders enable row level security;
create policy "cos: owner full" on public.change_orders for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- --------------------------------------------------------------------------
-- ACTUALS — job costing inputs (owner only)
-- --------------------------------------------------------------------------
create table public.actuals (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id),
  category    text not null check (category in ('labour','materials','subtrades','equipment')),
  description text,
  amount      numeric not null default 0,
  hours       numeric,
  created_at  timestamptz not null default now()
);
alter table public.actuals enable row level security;
create policy "actuals: owner full" on public.actuals for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- --------------------------------------------------------------------------
-- PHOTOS. Workers may insert/select photos ONLY for jobs assigned to them.
-- Every row carries taken_at + lat/lng (the app burns the stamp into the
-- image too, so the evidence survives outside the database).
-- --------------------------------------------------------------------------
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id),
  worker_id    uuid references public.profiles(id),
  storage_path text not null,
  taken_at     timestamptz not null,
  lat          double precision not null,
  lng          double precision not null,
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.photos enable row level security;
create policy "photos: owner full" on public.photos for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());
create policy "photos: worker reads assigned" on public.photos for select
  using (public.is_assigned(job_id));
create policy "photos: worker inserts assigned" on public.photos for insert
  with check (public.is_assigned(job_id) and worker_id = auth.uid());

-- --------------------------------------------------------------------------
-- PRICE LISTS — owner's central editable rates (seeded from the workbook
-- defaults by the app on first run).
-- --------------------------------------------------------------------------
create table public.price_lists (
  owner_id   uuid primary key references public.profiles(id),
  prices     jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.price_lists enable row level security;
create policy "prices: owner full" on public.price_lists for all
  using (owner_id = auth.uid() and public.is_owner())
  with check (owner_id = auth.uid() and public.is_owner());

-- ============================================================================
-- CUSTOMER-FACING TOKEN FUNCTIONS (called by accept.html with the anon key).
-- SECURITY DEFINER, token-gated, and they return ONLY customer-safe data.
-- ============================================================================

-- Customer-safe view of a quote: one line per section, NO internal detail.
create or replace function public.get_quote_public(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  q record;
  cname text;
  out jsonb;
begin
  select * into q from public.quotes where accept_token = p_token;
  if not found then
    return null;
  end if;
  select name into cname from public.customers where id = q.customer_id;
  out := jsonb_build_object(
    'number',        q.number,
    'status',        q.status,
    'work_date',     q.work_date,
    'customer_name', coalesce(cname, ''),
    'job_lines',     q.totals -> 'jobLines',
    'admin_permits', q.totals -> 'adminPermitsTotal',
    'frost',         q.totals -> 'frostAmount',
    'total',         q.totals -> 'grandTotal',
    'terms',         to_jsonb(q.terms),
    'accepted_at',   q.accepted_at,
    'accepted_by',   q.accepted_by_name
  );
  return out;
end;
$$;

-- Customer accepts a quote with a typed name + timestamp.
create or replace function public.accept_quote_public(p_token text, p_name text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  updated int;
begin
  if p_name is null or length(trim(p_name)) < 2 then
    return false;
  end if;
  update public.quotes
     set status = 'accepted',
         accepted_at = now(),
         accepted_by_name = trim(p_name)
   where accept_token = p_token
     and status in ('draft', 'sent');
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

-- Customer-safe view of a change order.
create or replace function public.get_co_public(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  co record;
  jn text;
begin
  select * into co from public.change_orders where token = p_token;
  if not found then
    return null;
  end if;
  select name into jn from public.jobs where id = co.job_id;
  return jsonb_build_object(
    'job_name',    coalesce(jn, ''),
    'description', co.description,
    'price',       co.price,
    'status',      co.status,
    'approved_at', co.approved_at,
    'approved_by', co.approved_by_name
  );
end;
$$;

-- Customer approves a change order with a typed name + timestamp.
create or replace function public.approve_co_public(p_token text, p_name text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  updated int;
begin
  if p_name is null or length(trim(p_name)) < 2 then
    return false;
  end if;
  update public.change_orders
     set status = 'approved',
         approved_at = now(),
         approved_by_name = trim(p_name)
   where token = p_token
     and status = 'pending';
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

grant execute on function public.get_quote_public(text)  to anon, authenticated;
grant execute on function public.accept_quote_public(text, text) to anon, authenticated;
grant execute on function public.get_co_public(text)     to anon, authenticated;
grant execute on function public.approve_co_public(text, text) to anon, authenticated;
grant execute on function public.get_worker_jobs()       to authenticated;
grant execute on function public.next_quote_number()     to authenticated;
grant execute on function public.is_owner()              to authenticated;
grant execute on function public.is_assigned(uuid)       to authenticated;
grant execute on function public.set_my_display_name(text) to authenticated;

-- ============================================================================
-- STORAGE BUCKETS + POLICIES
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false),
       ('quote-pdfs', 'quote-pdfs', false)
on conflict (id) do nothing;

-- Path convention for photos:  {job_id}/{filename}
create policy "storage: photos owner full"
  on storage.objects for all
  using (bucket_id = 'job-photos' and public.is_owner())
  with check (bucket_id = 'job-photos' and public.is_owner());

create policy "storage: photos worker upload assigned"
  on storage.objects for insert
  with check (
    bucket_id = 'job-photos'
    and public.is_assigned(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "storage: photos worker read assigned"
  on storage.objects for select
  using (
    bucket_id = 'job-photos'
    and (
      public.is_owner()
      or public.is_assigned(((string_to_array(name, '/'))[1])::uuid)
    )
  );

create policy "storage: quotes owner full"
  on storage.objects for all
  using (bucket_id = 'quote-pdfs' and public.is_owner())
  with check (bucket_id = 'quote-pdfs' and public.is_owner());
