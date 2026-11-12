-- Applied in production via Supabase migration itsoscup_tournament_registration_deadlines_051.
alter table public.sports add column if not exists registration_deadline timestamptz;
create or replace function public.set_tournament_registration_deadline(p_sport_id bigint,p_deadline timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 if public.current_admin_role()<>'super_admin' then raise exception 'Solo il Super Admin puo modificare la scadenza'; end if;
 update public.sports set registration_deadline=p_deadline where id=p_sport_id;
 if not found then raise exception 'Torneo non trovato';end if;
 return p_deadline;
end $$;
revoke all on function public.set_tournament_registration_deadline(bigint,timestamptz) from public,anon;
grant execute on function public.set_tournament_registration_deadline(bigint,timestamptz) to authenticated;
create or replace function public.class_registration_deadline(p_code text) returns timestamptz
language sql security definer set search_path='' as $$
 select s.registration_deadline from public.class_invites i join public.sports s on s.id=i.sport_id
 where i.access_code=lower(btrim(coalesce(p_code,''))) and i.is_active
 and (i.expires_at is null or i.expires_at>now()) limit 1 $$;
revoke all on function public.class_registration_deadline(text) from public;
grant execute on function public.class_registration_deadline(text) to anon,authenticated;
create or replace function public.enforce_tournament_registration_deadline()
returns trigger language plpgsql set search_path='' as $$
declare v_deadline timestamptz;
begin
 select registration_deadline into v_deadline from public.sports where id=new.sport_id;
 if v_deadline is not null and now()>=v_deadline then raise exception 'Iscrizioni chiuse: scadenza del torneo raggiunta'; end if;
 return new;
end $$;
drop trigger if exists trg_enforce_tournament_registration_deadline on public.class_registrations;
create trigger trg_enforce_tournament_registration_deadline
before insert or update of roster,captain_name on public.class_registrations
for each row execute function public.enforce_tournament_registration_deadline();