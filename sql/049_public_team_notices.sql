-- Keep earlier class-only notices private. New public team-page notices require explicit publication.
begin;
alter table public.class_notices
  add column if not exists published_to_team boolean not null default false;
create index if not exists class_notices_team_public_idx
  on public.class_notices(sport_id,created_at desc,id desc)
  where published_to_team=true;

-- Reuse the existing audited notice sender. Publish on the team page only if requested.
create or replace function public.send_team_class_notice(
  p_sport_id bigint,p_title text,p_body text,p_invite_ids uuid[],p_publish_to_team boolean
)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_notice bigint;
begin
 if auth.uid() is null or public.current_admin_role() not in ('super_admin','match_manager') then
   raise exception 'Accesso non autorizzato';
 end if;
 v_notice:=public.send_class_notice(p_sport_id,p_title,p_body,p_invite_ids);
 update public.class_notices set published_to_team=coalesce(p_publish_to_team,false)
 where id=v_notice;
 return v_notice;
end $$;
revoke all on function public.send_team_class_notice(bigint,text,text,uuid[],boolean) from public,anon;
grant execute on function public.send_team_class_notice(bigint,text,text,uuid[],boolean) to authenticated;

-- Public team pages never expose roster, class tokens or private messages.
create or replace function public.public_team_notices(p_sport_id bigint,p_team_id bigint)
returns table (id bigint,title text,body text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select n.id,n.title,n.body,n.created_at
 from public.class_notices n
 where n.sport_id=p_sport_id and n.published_to_team=true
 and exists (
   select 1 from public.class_notice_recipients recipient
   join public.class_registrations registration
     on registration.invite_id=recipient.invite_id
   where recipient.notice_id=n.id
     and registration.sport_id=p_sport_id
     and registration.team_id=p_team_id
     and registration.status='approved'
 )
 and exists (select 1 from public.teams t where t.id=p_team_id and t.sport_id=p_sport_id)
 order by n.created_at desc,n.id desc
 limit 30;
$$;
revoke all on function public.public_team_notices(bigint,bigint) from public;
grant execute on function public.public_team_notices(bigint,bigint) to anon,authenticated;

-- Schedule changes contain only match schedule information, appropriate to publish on team pages.
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

 insert into public.class_notices(sport_id,title,body,published_to_team)
 values(new.sport_id,v_title,v_body,true) returning id into v_notice;
 insert into public.class_notice_recipients(notice_id,invite_id)
 select v_notice,unnest(v_invites);
 return new;
end $$;

commit;