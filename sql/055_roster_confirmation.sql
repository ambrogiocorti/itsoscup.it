-- 055: seal the school tournament roster after the coordinator approves it.
-- No existing squad/athlete is changed; seal requires an explicit Super Admin action.
alter table public.sports add column if not exists roster_confirmed_at timestamptz;
alter table public.sports add column if not exists roster_confirmed_by uuid references auth.users(id) on delete set null;
create table if not exists public.roster_confirmation_events(
 id bigint generated always as identity primary key,
 sport_id bigint not null references public.sports(id) on delete cascade,
 actor_id uuid not null,
 action text not null check(action in ('confirm','reopen')),
 reason text,
 created_at timestamptz not null default now()
);
alter table public.roster_confirmation_events enable row level security;
revoke all on public.roster_confirmation_events from anon,authenticated;
grant select on public.roster_confirmation_events to authenticated;
drop policy if exists roster_confirmation_events_admin on public.roster_confirmation_events;
create policy roster_confirmation_events_admin on public.roster_confirmation_events
 for select to authenticated using (public.current_admin_role()='super_admin');

create or replace function public.set_tournament_roster_confirmation(p_sport_id bigint,p_confirm boolean,p_reason text default null)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare s public.sports%rowtype; n integer;
begin
 if auth.uid() is null or public.current_admin_role()<>'super_admin' then
  raise exception 'Solo il Super Admin puo confermare o riaprire le rose';
 end if;
 select * into s from public.sports where id=p_sport_id for update;
 if not found then raise exception 'Torneo inesistente'; end if;
 if p_confirm then
  if s.roster_confirmed_at is not null then return s.roster_confirmed_at; end if;
  if s.registration_deadline is null then raise exception 'Imposta la scadenza delle iscrizioni prima di confermare le rose'; end if;
  select count(*) into n from public.teams where sport_id=p_sport_id;
  if n<1 then raise exception 'Non ci sono squadre nel torneo'; end if;
  if exists(select 1 from public.class_registrations where sport_id=p_sport_id and status<>'approved') then
    raise exception 'Esistono proposte non approvate: esaminale prima di confermare';
  end if;
  update public.sports set roster_confirmed_at=now(),roster_confirmed_by=auth.uid() where id=p_sport_id
    returning roster_confirmed_at into s.roster_confirmed_at;
  insert into public.roster_confirmation_events(sport_id,actor_id,action,reason)values(p_sport_id,auth.uid(),'confirm',null);
 else
  if char_length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Specificare il motivo della riapertura (almeno 10 caratteri)'; end if;
  if s.roster_confirmed_at is null then return null;end if;
  update public.sports set roster_confirmed_at=null,roster_confirmed_by=null where id=p_sport_id;
  insert into public.roster_confirmation_events(sport_id,actor_id,action,reason)values(p_sport_id,auth.uid(),'reopen',btrim(p_reason));
  return null;
 end if;
 return s.roster_confirmed_at;
end $$;
revoke all on function public.set_tournament_roster_confirmation(bigint,boolean,text) from public,anon;
grant execute on function public.set_tournament_roster_confirmation(bigint,boolean,text) to authenticated;

create or replace function public.guard_tournament_roster_lock()
returns trigger language plpgsql security invoker set search_path='' as $$
declare sport_a bigint; sport_b bigint; locked boolean;
begin
 if tg_table_name='teams' or tg_table_name='class_registrations' or tg_table_name='class_invites' then
  if tg_op='INSERT' then sport_a:=new.sport_id;
  elsif tg_op='DELETE' then sport_a:=old.sport_id;
  else sport_a:=old.sport_id;sport_b:=new.sport_id;end if;
 elsif tg_table_name='players' then
  if tg_op='INSERT' then select sport_id into sport_a from public.teams where id=new.team_id;
  elsif tg_op='DELETE' then select sport_id into sport_a from public.teams where id=old.team_id;
  else
    select sport_id into sport_a from public.teams where id=old.team_id;
    select sport_id into sport_b from public.teams where id=new.team_id;
  end if;
 else return coalesce(new,old);end if;
 select exists(select 1 from public.sports
  where roster_confirmed_at is not null and id in(sport_a,coalesce(sport_b,sport_a))) into locked;
 if locked then raise exception 'Rose confermate: chiedere al Super Admin la riapertura motivata prima di modificare squadre, atleti o iscrizioni'; end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
drop trigger if exists guard_roster_teams on public.teams;
create trigger guard_roster_teams before insert or update or delete on public.teams
 for each row execute function public.guard_tournament_roster_lock();
drop trigger if exists guard_roster_players on public.players;
create trigger guard_roster_players before insert or update or delete on public.players
 for each row execute function public.guard_tournament_roster_lock();
drop trigger if exists guard_roster_registrations on public.class_registrations;
create trigger guard_roster_registrations before insert or update of roster,captain_name,status,team_id or delete on public.class_registrations
 for each row execute function public.guard_tournament_roster_lock();
drop trigger if exists guard_roster_invites on public.class_invites;
create trigger guard_roster_invites before insert or update or delete on public.class_invites
 for each row execute function public.guard_tournament_roster_lock();
