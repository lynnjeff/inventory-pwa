-- APPLY ONLY AFTER the client that (a) sends an idempotency key on every adjust, assigns one to legacy
-- queued adjusts, and (b) creates items with ON CONFLICT DO NOTHING (ignoreDuplicates) is deployed.

-- 1. Direct quantity/org_id changes now raise instead of being silently reverted.
create or replace function private.items_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id cannot be changed' using errcode = '42501';
  end if;
  if new.quantity is distinct from old.quantity and current_user in ('authenticated', 'anon') then
    raise exception 'quantity can only be changed through adjust_quantity' using errcode = '42501';
  end if;
  return new;
end $$;

-- 2. Column-level UPDATE: no quantity, org_id, id, created_at, updated_by from the client.
revoke update on public.items from authenticated;
grant update (barcode, part_number, brand, name, target_quantity, location, notes) on public.items to authenticated;

-- 3. adjust_quantity requires the idempotency key (same signature, key still defaults to null so a missing key is a clear error).
create or replace function public.adjust_quantity(
  p_item_id uuid, p_delta integer, p_reason text default null, p_note text default null,
  p_idempotency_key uuid default null
) returns public.items
language plpgsql security definer set search_path = '' as $$
declare v_item public.items; v_uid uuid := (select auth.uid());
begin
  if p_idempotency_key is null then
    raise exception 'idempotency key required' using errcode = '22004';
  end if;
  if p_delta is null or abs(p_delta) > 100000 then
    raise exception 'delta out of range (max 100000)' using errcode = '22003';
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found or not private.is_org_member(v_item.org_id) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.stock_events where user_id = v_uid and idempotency_key = p_idempotency_key) then
    return v_item;
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
