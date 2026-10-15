-- ITSOSCup: per-match staffing and scoped writes (migration must run before new UI).
-- Reuses match_staff_assignments; all authorization derives from the trusted admins table.
create schema if not exists private;
create or replace function private.itsos_can_operate_match(p_match_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    (select a.ruolo = 'super_admin' from public.admins a where a.id = (select auth.uid())),
    false
  ) or exists (
    select 1 from public.match_staff_assignments staff
    join public.admins a on a.id=staff.admin_id
    where staff.match_id=p_match_id and staff.admin_id=(select auth.uid())
      and staff.role in ('scorekeeper','supervisor') and a.ruolo in ('match_manager','super_admin')
  );
$$;
revoke all on function private.itsos_can_operate_match(bigint) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.itsos_can_operate_match(bigint) to authenticated;

create or replace function public.itsos_my_assigned_matches()
returns table(match_id bigint, assignment_role text)
language sql stable security definer set search_path='' as $$
 select staff.match_id, staff.role
 from public.match_staff_assignments staff
 join public.admins a on a.id=staff.admin_id
 where staff.admin_id=(select auth.uid())
   and staff.role in ('scorekeeper','supervisor') and a.ruolo in ('match_manager','super_admin');
$$;
revoke all on function public.itsos_my_assigned_matches() from public, anon;
grant execute on function public.itsos_my_assigned_matches() to authenticated;

create or replace function public.itsos_assign_match_staff(p_match_id bigint, p_scorekeeper uuid, p_supervisor uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select a.ruolo from public.admins a where a.id=(select auth.uid())) is distinct from 'super_admin' then
   raise exception 'Solo Super Admin può assegnare gli operatori';
 end if;
 if not exists(select 1 from public.matches where id=p_match_id) then raise exception 'Partita non trovata'; end if;
 if p_scorekeeper is not null and not exists(select 1 from public.admins a where a.id=p_scorekeeper and a.ruolo in ('super_admin','match_manager')) then
   raise exception 'Segnapunti non autorizzato';
 end if;
 if p_supervisor is not null and not exists(select 1 from public.admins a where a.id=p_supervisor and a.ruolo in ('super_admin','match_manager')) then
   raise exception 'Supervisore non autorizzato';
 end if;
 delete from public.match_staff_assignments where match_id=p_match_id and role in ('scorekeeper','supervisor');
 insert into public.match_staff_assignments(match_id,role,name,admin_id)
 select p_match_id,'scorekeeper',a.nome,a.id from public.admins a where a.id=p_scorekeeper
 union all
 select p_match_id,'supervisor',a.nome,a.id from public.admins a where a.id=p_supervisor;
end;$$;
revoke all on function public.itsos_assign_match_staff(bigint,uuid,uuid) from public, anon;
grant execute on function public.itsos_assign_match_staff(bigint,uuid,uuid) to authenticated;

-- Guard ALL direct and SECURITY DEFINER SQL writes; RLS alone would not cover privileged RPCs.
create or replace function private.itsos_guard_match_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_role text;
begin
 if (select auth.uid()) is null then return coalesce(new,old); end if;
 select a.ruolo into v_role from public.admins a where a.id=(select auth.uid());
 if v_role = 'match_manager' then
   if TG_OP='INSERT' then raise exception 'Solo Super Admin può creare una partita'; end if;
   if not private.itsos_can_operate_match(old.id) then
     raise exception 'Partita non assegnata a questo account';
   end if;
 end if;
 return coalesce(new,old);
end;$$;
drop trigger if exists itsos_guard_matches on public.matches;
create trigger itsos_guard_matches before insert or update or delete on public.matches
for each row execute function private.itsos_guard_match_write();

-- Block reassignment of another user's match and unauthorized staff tampering.
create or replace function private.itsos_guard_staff_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text;v_match bigint;
begin
 if (select auth.uid()) is null then return coalesce(new,old); end if;
 select a.ruolo into v_role from public.admins a where a.id=(select auth.uid());
 if v_role='match_manager' then
   v_match:=coalesce(new.match_id,old.match_id);
   if not private.itsos_can_operate_match(v_match) then raise exception 'Partita non assegnata'; end if;
   if TG_OP='INSERT' and new.admin_id is not null then raise exception 'Assegnazioni riservate al Super Admin'; end if;
   if TG_OP='UPDATE' and new.admin_id is distinct from old.admin_id then raise exception 'Assegnazioni riservate al Super Admin'; end if;
 end if;
 return coalesce(new,old);
end;$$;
drop trigger if exists itsos_guard_match_staff on public.match_staff_assignments;
create trigger itsos_guard_match_staff before insert or update or delete on public.match_staff_assignments
for each row execute function private.itsos_guard_staff_write();

create index if not exists idx_itsos_match_staff_admin on public.match_staff_assignments(admin_id,match_id) where admin_id is not null;
