-- 004_fix_legacy_foreign_keys.sql
-- Correzione compatibilità per vecchi FK (schema legacy)
-- Risolve:
-- 1) errori relazione event_results -> events in schema cache
-- 2) delete sport bloccato da matches_sport_id_fkey con NO ACTION

begin;

-- Garantisce FK event_results.event_id -> events.id (ON DELETE CASCADE)
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'event_results'
      and c.contype = 'f'
      and c.confrelid = 'public.events'::regclass
  loop
    execute format('alter table public.event_results drop constraint %I', v_constraint_name);
  end loop;

  alter table public.event_results
    add constraint event_results_event_id_fkey
    foreign key (event_id)
    references public.events(id)
    on delete cascade;
exception
  when duplicate_object then null;
end $$;

-- Garantisce FK matches.sport_id -> sports.id (ON DELETE CASCADE)
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'matches'
      and c.contype = 'f'
      and c.confrelid = 'public.sports'::regclass
  loop
    execute format('alter table public.matches drop constraint %I', v_constraint_name);
  end loop;

  alter table public.matches
    add constraint matches_sport_id_fkey
    foreign key (sport_id)
    references public.sports(id)
    on delete cascade;
exception
  when duplicate_object then null;
end $$;

-- Forza refresh schema cache PostgREST (best effort)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then null;
end $$;

commit;
