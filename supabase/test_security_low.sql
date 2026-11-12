do $t$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  oa uuid := gen_random_uuid(); ob uuid := gen_random_uuid(); ia uuid := gen_random_uuid(); ib uuid := gen_random_uuid();
  res text := ''; n int; q int; k uuid := gen_random_uuid(); o public.organizations;
begin
  insert into auth.users (id,email,aud,role) values (ua,'a@test.invalid','authenticated','authenticated'),(ub,'b@test.invalid','authenticated','authenticated'),(uc,'c@test.invalid','authenticated','authenticated');
  insert into public.organizations (id,name,created_by) values (oa,'TEST A',ua),(ob,'TEST B',ub);
  insert into public.org_members (org_id,user_id,role) values (oa,ua,'owner'),(oa,uc,'member'),(ob,ub,'owner');
  insert into public.items (id,org_id,name,quantity,target_quantity) values (ia,oa,'a',3,10),(ib,ob,'b',3,10);

  perform set_config('request.jwt.claims', json_build_object('sub',ua,'email','a@test.invalid','role','authenticated')::text, true);
  set local role authenticated;
  -- new client: create is ON CONFLICT DO NOTHING
  insert into public.items (id,org_id,name,quantity,target_quantity) values (ia,oa,'a',99,10) on conflict (id) do nothing;
  insert into public.items (id,org_id,name,quantity,target_quantity) values (gen_random_uuid(),oa,'new',4,5) on conflict (id) do nothing;
  reset role; select quantity into q from public.items where id=ia;
  res := res || case when q=3 then 'L1a ok create retry is no-op, new insert works;' else 'L1a FAIL;' end;
  set local role authenticated;
  begin update public.items set quantity=50 where id=ia; res := res||'L1b FAIL qty update allowed;'; exception when insufficient_privilege then res := res||'L1b ok direct quantity update raises;'; end;
  begin update public.items set org_id=ob where id=ia; res := res||'L1c FAIL;'; exception when insufficient_privilege then res := res||'L1c ok org_id update raises;'; end;
  begin insert into public.items (id,org_id,name,quantity,target_quantity) values (ia,oa,'a',99,10) on conflict (id) do update set quantity=excluded.quantity; res := res||'L1d FAIL upsert-update allowed;'; exception when insufficient_privilege then res := res||'L1d ok upsert DO UPDATE on quantity denied;'; end;
  update public.items set name='renamed', target_quantity=12, barcode='b1', part_number='p', brand='br', location='l', notes='n' where id=ia; get diagnostics n=row_count;
  res := res || case when n=1 then 'L1e ok edit form columns still updatable;' else 'L1e FAIL;' end;
  -- adjust key
  begin perform public.adjust_quantity(ia, 1); res := res||'L3a FAIL no key accepted;'; exception when sqlstate '22004' then res := res||'L3a ok 2-arg call without key rejected;'; end;
  begin perform public.adjust_quantity(ia, 1, 'r', 'n'); res := res||'L3b FAIL;'; exception when sqlstate '22004' then res := res||'L3b ok 4-arg call without key rejected;'; end;
  perform public.adjust_quantity(ia, 2, 'r', 'n', k); perform public.adjust_quantity(ia, 2, 'r', 'n', k);
  reset role; select quantity into q from public.items where id=ia;
  res := res || case when q=5 then 'L3c ok keyed adjust applied once;' else 'L3c FAIL q='||q||';' end;
  set local role authenticated;
  select public.mark_order_received(oa) into n;
  reset role; select quantity into q from public.items where id=ia;
  res := res || case when q=12 then 'L3d ok mark_order_received still works;' else 'L3d FAIL q='||q||';' end;
  -- cross-org isolation
  set local role authenticated;
  select count(*) into n from public.items where org_id=ob; res := res||case when n=0 then 'X1 ok no read of org B;' else 'X1 FAIL;' end;
  update public.items set name='h' where id=ib; get diagnostics n=row_count; res := res||case when n=0 then 'X2 ok no update of org B;' else 'X2 FAIL;' end;
  begin perform public.adjust_quantity(ib, 1, null, null, gen_random_uuid()); res := res||'X3 FAIL;'; exception when sqlstate 'P0002' then res := res||'X3 ok cannot adjust org B;'; end;
  -- org cap by creator, not by ownership
  for q in 1..9 loop perform public.create_organization('cap '||q); end loop;   -- ua already created TEST A => 10
  begin perform public.create_organization('cap 10'); res := res||'L4a FAIL;'; exception when sqlstate '54000' then res := res||'L4a ok cap reached at 10 created;'; end;
  reset role;
  -- simulate ownership transfer away from ua in every org they created, then try again
  update public.org_members set role='member' where user_id=ua and role='owner';
  set local role authenticated;
  begin perform public.create_organization('after transfer'); res := res||'L4b FAIL cap reset by transfer;'; exception when sqlstate '54000' then res := res||'L4b ok transfer does not reset cap;'; end;
  reset role;
  raise exception 'RESULTS: %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS: % ERROR: % %', res, sqlstate, sqlerrm;
end $t$;
