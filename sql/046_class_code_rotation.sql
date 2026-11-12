-- Regenerate access codes server-side; old URLs immediately become invalid.
begin;
create or replace function public.rotate_class_invite(p_invite_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare new_code text;
begin
 if auth.uid() is null or public.current_admin_role() not in ('super_admin','match_manager') then
   raise exception 'Accesso non autorizzato';
 end if;
 update public.class_invites
 set access_code=encode(extensions.gen_random_bytes(24),'hex'),is_active=true
 where id=p_invite_id
 returning access_code into new_code;
 if not found then raise exception 'Classe non trovata'; end if;
 return new_code;
end $$;
revoke all on function public.rotate_class_invite(uuid) from public,anon;
grant execute on function public.rotate_class_invite(uuid) to authenticated;
commit;