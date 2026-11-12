-- Limit staff directory reads to operational admins; report viewers keep own profile.
begin;
drop policy if exists "Admins can read" on public.admins;
drop policy if exists "Allow read admins" on public.admins;
drop policy if exists admins_read_authorized on public.admins;
create policy admins_read_authorized on public.admins
 for select to authenticated
 using (id=auth.uid() or public.current_admin_role() in ('super_admin','match_manager'));
commit;