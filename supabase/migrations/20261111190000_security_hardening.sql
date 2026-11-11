-- Security hardening (Nov 11 audit). Additive / tightening only.

-- ---------------------------------------------------------------- grants
revoke all on public.items, public.org_invites, public.org_members, public.organizations, public.stock_events from anon;
revoke all on public.items, public.org_invites, public.org_members, public.organizations, public.stock_events from public;
revoke all on public.items, public.org_invites, public.org_members, public.organizations, public.stock_events from authenticated;

grant select, insert, update, delete on public.items to authenticated;
grant select on public.stock_events to authenticated;                      -- writes only via RPCs
grant select, delete on public.org_members to authenticated;
grant update (role) on public.org_members to authenticated;               -- inserts only via RPCs
grant select, delete on public.org_invites to authenticated;
grant insert (org_id, email, role) on public.org_invites to authenticated;
grant select, delete on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;             -- creation only via create_organization

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;

revoke all on function public.touch_updated_at() from public, anon, authenticated;

alter table public.items force row level security;
alter table public.stock_events force row level security;
alter table public.organizations force row level security;
alter table public.org_members force row level security;
alter table public.org_invites force row level security;

-- stock_events: no direct client writes at all
drop policy if exists events_insert on public.stock_events;

-- ---------------------------------------------------------------- items: org_id immutable, quantity only via RPCs
create or replace function private.items_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id cannot be changed' using errcode = '42501';
  end if;
  -- Direct client writes (role authenticated/anon) cannot change quantity; the
  -- SECURITY DEFINER RPCs (adjust_quantity, mark_order_received) run as owner.
  if new.quantity is distinct from old.quantity and current_user in ('authenticated', 'anon') then
    new.quantity := old.quantity;
  end if;
  return new;
end $$;
revoke all on function private.items_guard() from public, anon, authenticated;
drop trigger if exists items_guard on public.items;
create trigger items_guard before update on public.items
  for each row execute function private.items_guard();

-- ---------------------------------------------------------------- org_members: last owner + admin vs owner
create or replace function private.members_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_other int;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);          -- admin/service maintenance
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role is distinct from 'owner') then
    -- org itself being deleted (cascade): allow
    if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return old;
    end if;
    select count(*) into v_other from (
      select 1 from public.org_members m
      where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id
      for update) s;
    if v_other = 0 then
      raise exception 'cannot remove or demote the last owner' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.members_guard() from public, anon, authenticated;
drop trigger if exists members_guard on public.org_members;
create trigger members_guard before update or delete on public.org_members
  for each row execute function private.members_guard();

drop policy if exists members_delete on public.org_members;
create policy members_delete on public.org_members for delete to authenticated using (
  (select private.has_org_role(org_id, array['owner']::public.org_role[]))
  or user_id = (select auth.uid())
  or ((select private.has_org_role(org_id, array['admin']::public.org_role[])) and role <> 'owner')
);

-- ---------------------------------------------------------------- invites: expiry, only owners invite admins
alter table public.org_invites add column if not exists expires_at timestamptz not null default (now() + interval '14 days');

drop policy if exists invites_insert on public.org_invites;
create policy invites_insert on public.org_invites for insert to authenticated with check (
  (select private.has_org_role(org_id, array['owner']::public.org_role[]))
  or ((select private.has_org_role(org_id, array['admin']::public.org_role[])) and role = 'member')
);

create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
        v_email text := lower((select auth.jwt()) ->> 'email');
        v_count integer;
begin
  if v_uid is null or v_email is null then return 0; end if;
  insert into public.org_members (org_id, user_id, role)
    select i.org_id, v_uid, i.role from public.org_invites i
    where i.email = v_email and i.accepted_at is null and i.expires_at > now()
  on conflict (org_id, user_id) do nothing;
  update public.org_invites set accepted_at = now()
    where email = v_email and accepted_at is null and expires_at > now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------- cap orgs per user
create or replace function public.create_organization(p_name text) returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.org_members where user_id = v_uid and role = 'owner') >= 10 then
    raise exception 'organization limit reached (10)' using errcode = '54000';
  end if;
  insert into public.organizations (name, created_by) values (trim(p_name), v_uid) returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, v_uid, 'owner');
  return v_org;
end $$;

-- ---------------------------------------------------------------- adjust_quantity: idempotency key + delta cap
alter table public.stock_events add column if not exists idempotency_key uuid;
create unique index if not exists stock_events_user_idem_key on public.stock_events (user_id, idempotency_key) where idempotency_key is not null;

drop function if exists public.adjust_quantity(uuid, integer, text, text);
create or replace function public.adjust_quantity(
  p_item_id uuid, p_delta integer, p_reason text default null, p_note text default null,
  p_idempotency_key uuid default null
) returns public.items
language plpgsql security definer set search_path = '' as $$
declare v_item public.items; v_uid uuid := (select auth.uid());
begin
  if p_delta is null or abs(p_delta) > 100000 then
    raise exception 'delta out of range (max 100000)' using errcode = '22003';
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found or not private.is_org_member(v_item.org_id) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if p_idempotency_key is not null and exists (
    select 1 from public.stock_events where user_id = v_uid and idempotency_key = p_idempotency_key
  ) then
    return v_item;                      -- already applied; replay is a no-op
  end if;
  update public.items set quantity = greatest(0, quantity + p_delta)
    where id = p_item_id returning * into v_item;
  insert into public.stock_events (org_id, item_id, kind, delta, quantity_after, user_id, reason, note, idempotency_key)
    values (v_item.org_id, v_item.id, 'adjust', p_delta, v_item.quantity, v_uid,
            left(nullif(trim(p_reason), ''), 100), left(nullif(trim(p_note), ''), 1000), p_idempotency_key);
  return v_item;
end $$;
revoke all on function public.adjust_quantity(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.adjust_quantity(uuid, integer, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- text / numeric limits (NOT VALID, then validated)
alter table public.items
  add constraint items_len_chk check (length(name) <= 200 and length(coalesce(barcode,'')) <= 128
    and length(coalesce(part_number,'')) <= 100 and length(coalesce(brand,'')) <= 100
    and length(coalesce(location,'')) <= 200 and length(coalesce(notes,'')) <= 2000) not valid,
  add constraint items_qty_max_chk check (quantity <= 100000000 and target_quantity <= 100000000) not valid;
alter table public.organizations add constraint organizations_name_len_chk check (length(name) <= 100) not valid;
alter table public.org_invites add constraint org_invites_email_len_chk check (length(email) <= 254) not valid;
alter table public.stock_events add constraint stock_events_len_chk check (length(coalesce(reason,'')) <= 100 and length(coalesce(note,'')) <= 1000) not valid;
alter table public.items validate constraint items_len_chk;
alter table public.items validate constraint items_qty_max_chk;
alter table public.organizations validate constraint organizations_name_len_chk;
alter table public.org_invites validate constraint org_invites_email_len_chk;
alter table public.stock_events validate constraint stock_events_len_chk;
