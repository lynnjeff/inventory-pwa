
do $t$
declare
  ua1 uuid := gen_random_uuid(); ua2 uuid := gen_random_uuid(); ua3 uuid := gen_random_uuid(); ub1 uuid := gen_random_uuid();
  oa uuid := gen_random_uuid(); ob uuid := gen_random_uuid();
  ia uuid := gen_random_uuid(); ib uuid := gen_random_uuid(); ia2 uuid := gen_random_uuid();
  res text := ''; n int; q int; r record; k uuid := gen_random_uuid();
  procedure_dummy int;
begin
  insert into auth.users (id, email, aud, role) values
    (ua1,'a1@test.invalid','authenticated','authenticated'),(ua2,'a2@test.invalid','authenticated','authenticated'),
    (ua3,'a3@test.invalid','authenticated','authenticated'),(ub1,'b1@test.invalid','authenticated','authenticated');
  insert into public.organizations (id,name,created_by) values (oa,'TEST A',ua1),(ob,'TEST B',ub1);
  insert into public.org_members (org_id,user_id,role) values (oa,ua1,'owner'),(oa,ua2,'admin'),(oa,ua3,'member'),(ob,ub1,'owner');
  insert into public.items (id,org_id,name,quantity,target_quantity) values (ia,oa,'item a',3,10),(ib,ob,'item b',3,10),(ia2,oa,'item a2',20,10);

  -- T1 anon blocked
  set local role anon;
  begin perform 1 from public.items; res := res||'T1 FAIL anon can read;'; exception when insufficient_privilege then res := res||'T1 ok anon denied;'; end;
  reset role;

  -- as A3 (member of A)
  perform set_config('request.jwt.claims', json_build_object('sub',ua3,'email','a3@test.invalid','role','authenticated')::text, true);
  set local role authenticated;
  update public.items set quantity = 999 where id = ia;
  reset role; select quantity into q from public.items where id=ia;
  res := res || case when q=3 then 'T2 ok direct qty update ignored;' else 'T2 FAIL qty='||q||';' end;
  set local role authenticated;
  begin update public.items set org_id = ob where id = ia; res := res||'T3 FAIL org_id moved;'; exception when insufficient_privilege then res := res||'T3 ok org_id locked;'; end;
  update public.items set name='renamed', target_quantity=12 where id=ia; get diagnostics n = row_count;
  res := res || case when n=1 then 'T4 ok edit name/target works;' else 'T4 FAIL;' end;
  -- upsert like client insert
  insert into public.items (id,org_id,name,quantity,target_quantity) values (gen_random_uuid(),oa,'new via client',4,5);
  res := res||'T4b ok client insert;';
  -- adjust + idempotency + cap
  perform public.adjust_quantity(ia, 5, 'received', 'x', k);
  perform public.adjust_quantity(ia, 5, 'received', 'x', k);
  reset role; select quantity into q from public.items where id=ia;
  select count(*) into n from public.stock_events where item_id=ia;
  res := res || case when q=8 and n=1 then 'T5 ok adjust applied once with same key;' else 'T5 FAIL q='||q||' n='||n||';' end;
  set local role authenticated;
  perform public.adjust_quantity(ia, 1);   -- legacy 2-arg call
  begin perform public.adjust_quantity(ia, 100001); res := res||'T5b FAIL cap;'; exception when numeric_value_out_of_range then res := res||'T5b ok delta cap;'; end;
  -- mark_order_received
  select public.mark_order_received(oa) into n;
  reset role; select quantity into q from public.items where id=ia; select quantity into procedure_dummy from public.items where id=ia2;
  res := res || case when q=12 and procedure_dummy=20 then 'T6 ok mark_order_received fills below target, leaves over-target;' else 'T6 FAIL q='||q||' over='||procedure_dummy||';' end;
  -- cross-org isolation
  set local role authenticated;
  select count(*) into n from public.items where org_id=ob;
  res := res || case when n=0 then 'T7a ok A3 sees 0 of org B items;' else 'T7a FAIL;' end;
  update public.items set name='hacked' where id=ib; get diagnostics n = row_count;
  res := res || case when n=0 then 'T7b ok cannot update B item;' else 'T7b FAIL;' end;
  begin insert into public.items (org_id,name) values (ob,'x'); res := res||'T7c FAIL insert into B;'; exception when insufficient_privilege then res := res||'T7c ok cannot insert into B;'; end;
  begin perform public.adjust_quantity(ib, 1); res := res||'T7d FAIL adjust B item;'; exception when no_data_found or sqlstate 'P0002' then res := res||'T7d ok cannot adjust B item;'; end;
  begin perform public.mark_order_received(ob); res := res||'T7e FAIL mark B;'; exception when insufficient_privilege then res := res||'T7e ok cannot mark B received;'; end;
  select count(*) into n from public.org_members where org_id=ob;
  select count(*) into q from public.stock_events where org_id=ob;
  res := res || case when n=0 and q=0 then 'T7f ok no B members/events visible;' else 'T7f FAIL;' end;
  delete from public.items where id=ib; get diagnostics n = row_count;
  res := res || case when n=0 then 'T7g ok member cannot delete B item;' else 'T7g FAIL;' end;
  -- direct writes to audit / membership tables
  begin insert into public.stock_events (org_id,item_id,kind) values (oa,ia,'adjust'); res := res||'T10a FAIL;'; exception when insufficient_privilege then res := res||'T10a ok no direct stock_events insert;'; end;
  begin insert into public.org_members (org_id,user_id,role) values (oa,ua3,'owner'); res := res||'T10b FAIL;'; exception when insufficient_privilege then res := res||'T10b ok no direct org_members insert;'; end;
  begin insert into public.organizations (name) values ('x'); res := res||'T10c FAIL;'; exception when insufficient_privilege then res := res||'T10c ok no direct organizations insert;'; end;
  begin update public.stock_events set delta=0 where org_id=oa; res := res||'T10d FAIL;'; exception when insufficient_privilege then res := res||'T10d ok no stock_events update;'; end;
  begin insert into public.items (org_id,name) values (oa, repeat('x',201)); res := res||'T12 FAIL len;'; exception when check_violation then res := res||'T12 ok length limit;'; end;
  begin update public.org_members set role='owner' where org_id=oa and user_id=ua3; get diagnostics n=row_count; res := res||case when n=0 then 'T8z ok member cannot self-promote;' else 'T8z FAIL;' end; end;
  reset role;

  -- as A2 (admin)
  perform set_config('request.jwt.claims', json_build_object('sub',ua2,'email','a2@test.invalid','role','authenticated')::text, true);
  set local role authenticated;
  delete from public.org_members where org_id=oa and user_id=ua1; get diagnostics n=row_count;
  res := res || case when n=0 then 'T8a ok admin cannot delete owner;' else 'T8a FAIL;' end;
  begin insert into public.org_invites (org_id,email,role) values (oa,'x@test.invalid','admin'); res := res||'T9a FAIL admin invited admin;'; exception when insufficient_privilege then res := res||'T9a ok admin cannot invite admin;'; end;
  insert into public.org_invites (org_id,email,role) values (oa,'x@test.invalid','member'); res := res||'T9b ok admin can invite member;';
  begin insert into public.org_invites (org_id,email,role) values (oa,'y@test.invalid','owner'); res := res||'T9c FAIL;'; exception when others then res := res||'T9c ok no owner invite;'; end;
  reset role;

  -- as A1 (sole owner)
  perform set_config('request.jwt.claims', json_build_object('sub',ua1,'email','a1@test.invalid','role','authenticated')::text, true);
  set local role authenticated;
  insert into public.org_invites (org_id,email,role) values (oa,'z@test.invalid','admin'); res := res||'T9d ok owner can invite admin;';
  begin update public.org_members set role='admin' where org_id=oa and user_id=ua1; res := res||'T8b FAIL demoted last owner;'; exception when check_violation then res := res||'T8b ok last owner cannot demote;'; end;
  begin delete from public.org_members where org_id=oa and user_id=ua1; res := res||'T8c FAIL deleted last owner;'; exception when check_violation then res := res||'T8c ok last owner cannot leave;'; end;
  update public.org_members set role='owner' where org_id=oa and user_id=ua2;
  update public.org_members set role='admin' where org_id=oa and user_id=ua1; res := res||'T8d ok demote allowed once another owner exists;';
  reset role;
  update public.org_members set role='owner' where org_id=oa and user_id=ua1; update public.org_members set role='admin' where org_id=oa and user_id=ua2;
  -- org cascade delete by owner
  set local role authenticated;
  delete from public.organizations where id=oa; get diagnostics n=row_count;
  res := res || case when n=1 then 'T8e ok owner can delete org (cascade not blocked);' else 'T8e FAIL;' end;
  -- org cap
  for q in 1..10 loop begin perform public.create_organization('cap '||q); exception when others then null; end; end loop;
  begin perform public.create_organization('cap 11'); res := res||'T11 FAIL cap;'; exception when sqlstate '54000' then res := res||'T11 ok org cap;'; end;
  reset role;

  -- invite expiry
  insert into auth.users (id,email,aud,role) values (gen_random_uuid(),'late@test.invalid','authenticated','authenticated') returning id into k;
  insert into public.org_invites (org_id,email,role,expires_at) values (ob,'late@test.invalid','member', now() - interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub',k,'email','late@test.invalid','role','authenticated')::text, true);
  set local role authenticated;
  select public.accept_invites() into n;
  reset role;
  select count(*) into q from public.org_members where user_id=k;
  res := res || case when n=0 and q=0 then 'T9e ok expired invite not accepted;' else 'T9e FAIL;' end;
  update public.org_invites set expires_at = now() + interval '1 day' where email='late@test.invalid';
  set local role authenticated;
  select public.accept_invites() into n;
  reset role;
  select count(*) into q from public.org_members where user_id=k;
  res := res || case when n=1 and q=1 then 'T9f ok valid invite accepted;' else 'T9f FAIL;' end;
  raise exception 'RESULTS: %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  res := res || ' ERROR: '||sqlstate||' '||sqlerrm;
  raise exception 'RESULTS: %', res;
end $t$;
