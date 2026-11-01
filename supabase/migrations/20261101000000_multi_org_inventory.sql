-- Multi-org inventory schema with RLS
create extension if not exists pgcrypto;

create type public.org_role as enum ('owner', 'admin', 'member');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.org_role not null default 'member' check (role <> 'owner'),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);
create index org_invites_org_id_idx on public.org_invites (org_id);
create index org_invites_email_idx on public.org_invites (email) where accepted_at is null;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  barcode text check (barcode is null or length(trim(barcode)) > 0),
  name text not null check (length(trim(name)) > 0),
  quantity integer not null default 0 check (quantity >= 0),
  target_quantity integer not null default 0 check (target_quantity >= 0),
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);
create index items_org_id_idx on public.items (org_id);
create index items_org_name_idx on public.items (org_id, name);
create index items_org_updated_idx on public.items (org_id, updated_at);
create unique index items_org_barcode_uniq on public.items (org_id, barcode) where barcode is not null;

create table public.stock_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  kind text not null check (kind in ('adjust', 'set', 'order_received', 'import', 'create', 'delete')),
  delta integer not null default 0,
  quantity_after integer,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_events_org_created_idx on public.stock_events (org_id, created_at desc);
create index stock_events_item_idx on public.stock_events (item_id);

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- Helper functions (security definer so policies don't recurse through org_members RLS)
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = (select auth.uid()));
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any(p_roles));
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.org_role[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to authenticated;

-- RLS
alter table public.organizations enable row level security;
alter table public.org_members  enable row level security;
alter table public.org_invites  enable row level security;
alter table public.items        enable row level security;
alter table public.stock_events enable row level security;

create policy orgs_select on public.organizations for select to authenticated
  using ((select public.is_org_member(id)));
create policy orgs_update on public.organizations for update to authenticated
  using ((select public.has_org_role(id, array['owner','admin']::public.org_role[])));
create policy orgs_delete on public.organizations for delete to authenticated
  using ((select public.has_org_role(id, array['owner']::public.org_role[])));
-- inserts go through create_organization()

create policy members_select on public.org_members for select to authenticated
  using ((select public.is_org_member(org_id)));
create policy members_update on public.org_members for update to authenticated
  using ((select public.has_org_role(org_id, array['owner']::public.org_role[])))
  with check ((select public.has_org_role(org_id, array['owner']::public.org_role[])));
create policy members_delete on public.org_members for delete to authenticated
  using ((select public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
         or user_id = (select auth.uid()));
-- inserts go through create_organization() / accept_invites()

create policy invites_select on public.org_invites for select to authenticated
  using ((select public.is_org_member(org_id)) or email = lower((select auth.jwt()) ->> 'email'));
create policy invites_insert on public.org_invites for insert to authenticated
  with check ((select public.has_org_role(org_id, array['owner','admin']::public.org_role[])));
create policy invites_delete on public.org_invites for delete to authenticated
  using ((select public.has_org_role(org_id, array['owner','admin']::public.org_role[])));

create policy items_select on public.items for select to authenticated
  using ((select public.is_org_member(org_id)));
create policy items_insert on public.items for insert to authenticated
  with check ((select public.is_org_member(org_id)));
create policy items_update on public.items for update to authenticated
  using ((select public.is_org_member(org_id)))
  with check ((select public.is_org_member(org_id)));
create policy items_delete on public.items for delete to authenticated
  using ((select public.has_org_role(org_id, array['owner','admin']::public.org_role[])));

create policy events_select on public.stock_events for select to authenticated
  using ((select public.is_org_member(org_id)));
create policy events_insert on public.stock_events for insert to authenticated
  with check ((select public.is_org_member(org_id)) and user_id = (select auth.uid()));

-- RPCs
create or replace function public.create_organization(p_name text) returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.organizations (name, created_by) values (trim(p_name), v_uid) returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, v_uid, 'owner');
  return v_org;
end $$;

create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
        v_email text := lower((select auth.jwt()) ->> 'email');
        v_count integer;
begin
  if v_uid is null or v_email is null then return 0; end if;
  insert into public.org_members (org_id, user_id, role)
    select i.org_id, v_uid, i.role from public.org_invites i
    where i.email = v_email and i.accepted_at is null
  on conflict (org_id, user_id) do nothing;
  update public.org_invites set accepted_at = now()
    where email = v_email and accepted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.adjust_quantity(p_item_id uuid, p_delta integer) returns public.items
language plpgsql security definer set search_path = '' as $$
declare v_item public.items;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found or not public.is_org_member(v_item.org_id) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  update public.items set quantity = greatest(0, quantity + p_delta)
    where id = p_item_id returning * into v_item;
  insert into public.stock_events (org_id, item_id, kind, delta, quantity_after, user_id)
    values (v_item.org_id, v_item.id, 'adjust', p_delta, v_item.quantity, (select auth.uid()));
  return v_item;
end $$;

create or replace function public.mark_order_received(p_org_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  with changed as (
    update public.items i set quantity = i.target_quantity
    from (select id, quantity as old_q from public.items
          where org_id = p_org_id and quantity <> target_quantity for update) o
    where i.id = o.id
    returning i.id, i.org_id, i.quantity, i.quantity - o.old_q as delta
  ), ev as (
    insert into public.stock_events (org_id, item_id, kind, delta, quantity_after, user_id)
    select org_id, id, 'order_received', delta, quantity, (select auth.uid()) from changed
    returning 1
  )
  select count(*) into v_count from ev;
  return v_count;
end $$;

revoke all on function public.create_organization(text) from public, anon;
revoke all on function public.accept_invites() from public, anon;
revoke all on function public.adjust_quantity(uuid, integer) from public, anon;
revoke all on function public.mark_order_received(uuid) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
grant execute on function public.adjust_quantity(uuid, integer) to authenticated;
grant execute on function public.mark_order_received(uuid) to authenticated;

-- Members screen needs emails; expose a safe view-like RPC
create or replace function public.org_member_list(p_org_id uuid)
returns table (user_id uuid, email text, role public.org_role, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.org_members m join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id and public.is_org_member(p_org_id)
  order by m.created_at;
$$;
revoke all on function public.org_member_list(uuid) from public, anon;
grant execute on function public.org_member_list(uuid) to authenticated;
