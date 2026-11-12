-- Org cap counts organizations CREATED by the user (created_by defaults to auth.uid(), and clients
-- have no INSERT grant or UPDATE on created_by), so transferring ownership away does not reset it.
create or replace function public.create_organization(p_name text) returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.organizations where created_by = v_uid) >= 10 then
    raise exception 'organization limit reached (10)' using errcode = '54000';
  end if;
  insert into public.organizations (name, created_by) values (trim(p_name), v_uid) returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, v_uid, 'owner');
  return v_org;
end $$;
