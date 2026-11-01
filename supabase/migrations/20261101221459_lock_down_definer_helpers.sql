-- Move RLS helpers out of the exposed API schema, and index unindexed foreign keys.
-- The applied multi_org_inventory migration is left unchanged.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

alter default privileges in schema private revoke execute on functions from public;

create or replace function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = (select auth.uid()));
$$;

create or replace function private.has_org_role(p_org uuid, p_roles public.org_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any(p_roles));
$$;

revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated;

drop policy if exists orgs_select on public.organizations;
drop policy if exists orgs_update on public.organizations;
drop policy if exists orgs_delete on public.organizations;
create policy orgs_select on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));
create policy orgs_update on public.organizations for update to authenticated
  using ((select private.has_org_role(id, array['owner','admin']::public.org_role[])));
create policy orgs_delete on public.organizations for delete to authenticated
  using ((select private.has_org_role(id, array['owner']::public.org_role[])));

drop policy if exists members_select on public.org_members;
drop policy if exists members_update on public.org_members;
drop policy if exists members_delete on public.org_members;
create policy members_select on public.org_members for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy members_update on public.org_members for update to authenticated
  using ((select private.has_org_role(org_id, array['owner']::public.org_role[])))
  with check ((select private.has_org_role(org_id, array['owner']::public.org_role[])));
create policy members_delete on public.org_members for delete to authenticated
  using ((select private.has_org_role(org_id, array['owner','admin']::public.org_role[]))
         or user_id = (select auth.uid()));

drop policy if exists invites_select on public.org_invites;
drop policy if exists invites_insert on public.org_invites;
drop policy if exists invites_delete on public.org_invites;
create policy invites_select on public.org_invites for select to authenticated
  using ((select private.is_org_member(org_id)) or email = lower((select auth.jwt()) ->> 'email'));
create policy invites_insert on public.org_invites for insert to authenticated
  with check ((select private.has_org_role(org_id, array['owner','admin']::public.org_role[])));
create policy invites_delete on public.org_invites for delete to authenticated
  using ((select private.has_org_role(org_id, array['owner','admin']::public.org_role[])));

drop policy if exists items_select on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;
create policy items_select on public.items for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy items_insert on public.items for insert to authenticated
  with check ((select private.is_org_member(org_id)));
create policy items_update on public.items for update to authenticated
  using ((select private.is_org_member(org_id)))
  with check ((select private.is_org_member(org_id)));
create policy items_delete on public.items for delete to authenticated
  using ((select private.has_org_role(org_id, array['owner','admin']::public.org_role[])));

drop policy if exists events_select on public.stock_events;
drop policy if exists events_insert on public.stock_events;
create policy events_select on public.stock_events for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy events_insert on public.stock_events for insert to authenticated
  with check ((select private.is_org_member(org_id)) and user_id = (select auth.uid()));

create or replace function public.adjust_quantity(p_item_id uuid, p_delta integer) returns public.items
language plpgsql security definer set search_path = '' as $$
declare v_item public.items;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found or not private.is_org_member(v_item.org_id) then
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
  if not private.is_org_member(p_org_id) then
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

create or replace function public.org_member_list(p_org_id uuid)
returns table (user_id uuid, email text, role public.org_role, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.org_members m join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id and private.is_org_member(p_org_id)
  order by m.created_at;
$$;

drop function if exists public.is_org_member(uuid);
drop function if exists public.has_org_role(uuid, public.org_role[]);

revoke execute on function public.create_organization(text) from public, anon;
revoke execute on function public.accept_invites() from public, anon;
revoke execute on function public.adjust_quantity(uuid, integer) from public, anon;
revoke execute on function public.mark_order_received(uuid) from public, anon;
revoke execute on function public.org_member_list(uuid) from public, anon;

grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_invites() to authenticated;
grant execute on function public.adjust_quantity(uuid, integer) to authenticated;
grant execute on function public.mark_order_received(uuid) to authenticated;
grant execute on function public.org_member_list(uuid) to authenticated;

create index if not exists items_updated_by_idx on public.items (updated_by);
create index if not exists org_invites_invited_by_idx on public.org_invites (invited_by);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists stock_events_user_id_idx on public.stock_events (user_id);
