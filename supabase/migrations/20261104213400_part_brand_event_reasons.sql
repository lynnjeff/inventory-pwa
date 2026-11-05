-- Additive: part # / brand on items, reason / note on stock events.
-- adjust_quantity keeps the old two-argument call working via defaults.
-- Not applied to the live project from this change.

alter table public.items add column if not exists part_number text;
alter table public.items add column if not exists brand text;
create index if not exists items_org_part_brand_idx on public.items (org_id, part_number, brand);

alter table public.stock_events add column if not exists reason text;
alter table public.stock_events add column if not exists note text;

drop function if exists public.adjust_quantity(uuid, integer);

create or replace function public.adjust_quantity(
  p_item_id uuid,
  p_delta integer,
  p_reason text default null,
  p_note text default null
) returns public.items
language plpgsql security definer set search_path = '' as $$
declare v_item public.items;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found or not private.is_org_member(v_item.org_id) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  update public.items set quantity = greatest(0, quantity + p_delta)
    where id = p_item_id returning * into v_item;
  insert into public.stock_events (org_id, item_id, kind, delta, quantity_after, user_id, reason, note)
    values (
      v_item.org_id, v_item.id, 'adjust', p_delta, v_item.quantity, (select auth.uid()),
      nullif(trim(p_reason), ''), nullif(trim(p_note), '')
    );
  return v_item;
end $$;

revoke all on function public.adjust_quantity(uuid, integer, text, text) from public, anon;
grant execute on function public.adjust_quantity(uuid, integer, text, text) to authenticated;

create or replace function public.item_stock_history(p_item_id uuid)
returns table (
  id bigint,
  created_at timestamptz,
  delta integer,
  quantity_after integer,
  kind text,
  reason text,
  note text,
  user_id uuid,
  email text
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.created_at, e.delta, e.quantity_after, e.kind, e.reason, e.note, e.user_id, u.email::text
  from public.stock_events e
  join public.items i on i.id = e.item_id
  left join auth.users u on u.id = e.user_id
  where e.item_id = p_item_id and private.is_org_member(i.org_id)
  order by e.created_at desc
  limit 200;
$$;

revoke all on function public.item_stock_history(uuid) from public, anon;
grant execute on function public.item_stock_history(uuid) to authenticated;
