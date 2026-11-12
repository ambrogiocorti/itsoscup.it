-- Notify only classes linked to one of the participating teams.
-- The notice is written inside the same transaction as the schedule change.
begin;
create or replace function public.notify_class_schedule_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 v_invites uuid[];
 v_notice bigint;
 v_title text;
 v_body text;
 v_team_a text;
 v_team_b text;
 v_when text;
begin
 if tg_op='UPDATE' and
   new.scheduled_start is not distinct from old.scheduled_start and
   new.scheduled_end is not distinct from old.scheduled_end and
   new.venue_id is not distinct from old.venue_id and
   new.operational_status is not distinct from old.operational_status and
   new.status is not distinct from old.status then
   return new;
 end if;

 if tg_op='UPDATE' and
   new.scheduled_start is not distinct from old.scheduled_start and
   new.scheduled_end is not distinct from old.scheduled_end and
   new.venue_id is not distinct from old.venue_id and
   (new.operational_status is distinct from old.operational_status
     or new.status is distinct from old.status) and
   new.operational_status not in ('cancelled','postponed') and
   new.status <> 'cancelled' then
   return new;
 end if;

 select array_agg(distinct r.invite_id) into v_invites
 from public.class_registrations r
 join public.class_invites i on i.id=r.invite_id
 where r.sport_id=new.sport_id
   and r.status='approved'
   and i.is_active=true
   and (i.expires_at is null or i.expires_at>now())
   and r.team_id in (new.home_team_id,new.away_team_id);
 if coalesce(array_length(v_invites,1),0)=0 then return new; end if;

 select name into v_team_a from public.teams where id=new.home_team_id;
 select name into v_team_b from public.teams where id=new.away_team_id;
 v_when:=case when new.scheduled_start is null then 'orario da definire'
  else to_char(new.scheduled_start at time zone 'Europe/Rome','DD/MM/YYYY HH24:MI') end;

 if new.operational_status in ('cancelled','postponed') or new.status='cancelled' then
   v_title:='Partita annullata o rinviata';
   v_body:='La partita '||coalesce(v_team_a,'Squadra A')||' - '||coalesce(v_team_b,'Squadra B')||
     ' richiede un aggiornamento del calendario. Consultare il programma ufficiale.';
 elsif tg_op='INSERT' then
   v_title:='Nuova partita in calendario';
   v_body:=coalesce(v_team_a,'Squadra A')||' - '||coalesce(v_team_b,'Squadra B')||
     ': '||v_when||'. Controllare campo e aggiornamenti sul calendario ufficiale.';
 else
   v_title:='Variazione calendario';
   v_body:='La partita '||coalesce(v_team_a,'Squadra A')||' - '||coalesce(v_team_b,'Squadra B')||
     ' è stata aggiornata. Nuovo orario: '||v_when||'. Consultare il calendario ufficiale.';
 end if;

 insert into public.class_notices(sport_id,title,body)
 values(new.sport_id,v_title,v_body) returning id into v_notice;
 insert into public.class_notice_recipients(notice_id,invite_id)
 select v_notice,unnest(v_invites);
 return new;
end $$;
revoke all on function public.notify_class_schedule_change() from public;
drop trigger if exists trg_class_schedule_notice on public.matches;
create trigger trg_class_schedule_notice
 after insert or update of scheduled_start,scheduled_end,venue_id,status,operational_status
 on public.matches for each row execute function public.notify_class_schedule_change();
commit;