-- 056: athlete/event registration is independent of results and attempts.
-- Existing results are preserved and remain visible even without an entry.
create table if not exists public.athletics_entries (
 id bigint generated always as identity primary key,
 sport_id bigint not null references public.sports(id) on delete cascade,
 event_id bigint not null references public.events(id) on delete cascade,
 player_id bigint not null references public.players(id) on delete cascade,
 status text not null default 'registered' check(status in ('registered','withdrawn')),
 created_by uuid default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(event_id,player_id)
);
create index if not exists athletics_entries_sport_idx on public.athletics_entries(sport_id,event_id,status);
alter table public.athletics_entries enable row level security;
revoke all on public.athletics_entries from public,anon;
grant select on public.athletics_entries to authenticated;
drop policy if exists athletics_entries_admin on public.athletics_entries;
create policy athletics_entries_admin on public.athletics_entries
 for select to authenticated using (public.current_admin_role() in ('super_admin','match_manager','report_viewer'));

create or replace function public.set_athletics_entry(p_sport_id bigint,p_event_id bigint,p_player_id bigint,p_registered boolean)
returns text language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.current_admin_role() not in ('super_admin','match_manager') then
  raise exception 'Ruolo non abilitato a gestire le iscrizioni atletica';
 end if;
 if not exists(select 1 from public.sports where id=p_sport_id and sport_type='atletica') then
  raise exception 'Il torneo selezionato non e di atletica';
 end if;
 if not exists(select 1 from public.events where id=p_event_id and sport_id=p_sport_id) then
  raise exception 'Evento non appartenente al torneo';
 end if;
 if not exists(select 1 from public.players p join public.teams t on t.id=p.team_id
  where p.id=p_player_id and t.sport_id=p_sport_id) then
  raise exception 'Atleta non appartenente al torneo';
 end if;
 if not p_registered and exists(select 1 from public.event_results where event_id=p_event_id and player_id=p_player_id) then
  raise exception 'Impossibile ritirare un atleta con risultati registrati: verificare e correggere prima';
 end if;
 insert into public.athletics_entries(sport_id,event_id,player_id,status,created_by)
 values (p_sport_id,p_event_id,p_player_id,case when p_registered then 'registered' else 'withdrawn' end,auth.uid())
 on conflict(event_id,player_id) do update
 set status=excluded.status,updated_at=now();
 return case when p_registered then 'Iscrizione registrata' else 'Partecipazione ritirata' end;
end $$;
revoke all on function public.set_athletics_entry(bigint,bigint,bigint,boolean) from PUBLIC,anon;
grant execute on function public.set_athletics_entry(bigint,bigint,bigint,boolean) to authenticated;
