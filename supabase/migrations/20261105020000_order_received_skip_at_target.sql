-- Order received fills only items that are still short of target.
-- Same signature, grants, and membership check as the live function.
-- Not applied to the live project from this change.

create or replace function public.mark_order_received(p_org_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not private.is_org_member(p_org_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  with changed as (
    update public.items i set quantity = i.target_quantity
    from (
      select id, quantity as old_q from public.items
      where org_id = p_org_id and quantity < target_quantity
      for update
    ) o
    where i.id = o.id
    returning i.id, i.org_id, i.quantity, i.quantity - o.old_q as delta
  ), ev as (
    insert into public.stock_events (org_id, item_id, kind, delta, quantity_after, user_id, reason)
    select org_id, id, 'order_received', delta, quantity, (select auth.uid()), 'received'
    from changed
    returning 1
  )
  select count(*) into v_count from ev;
  return v_count;
end $$;

revoke all on function public.mark_order_received(uuid) from public, anon;
grant execute on function public.mark_order_received(uuid) to authenticated;
